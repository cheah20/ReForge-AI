/**
 * tests/ocr/ocr-spike.spec.ts
 *
 * Desktop OCR spike (formbridge-any-document task 3.3), run by hand with
 * playwright.ocr.config.ts. It loads Tesseract.js in the browser from the
 * app's own origin and records, for both model variants and both languages:
 * bytes served per asset, whether any request left the origin, worker start
 * time, recognition time per clean fixture, the OCR_Validation_Bar result,
 * word count and mean line confidence for the clean and the glary photo, and
 * the EXIF probe result.
 *
 * Only a summary is written (test-results/ocr-spike-summary.json, ignored by
 * git) and printed. No raw OCR output is committed.
 */

import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { validationBar } from './cer.js';

const ORIGIN = 'https://app.ocr-spike.test';
const ROOT = process.cwd();
const VERSION = (JSON.parse(readFileSync(path.join(ROOT, 'node_modules', 'tesseract.js', 'package.json'), 'utf8')) as { version: string }).version;
const OCR_DIR = path.join(ROOT, 'public', 'ocr', VERSION);
const VARIANTS = ['4.0.0_best_int', '4.0.0'] as const;

interface ExpectedFile {
  file: string;
  lines?: Array<{ text: string; expect: string }>;
}
const EXPECTED = (JSON.parse(readFileSync(path.join(ROOT, 'fixtures', 'documents', 'expected.json'), 'utf8')) as { fixtures: ExpectedFile[] }).fixtures;
const labelsOf = (file: string) => EXPECTED.find((f) => f.file === file)!.lines!.filter((l) => l.expect === 'selected').map((l) => l.text);

const TYPES: Record<string, string> = { '.js': 'text/javascript', '.json': 'application/json', '.gz': 'application/gzip', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm' };

interface Served {
  path: string;
  bytes: number;
}

async function serve(page: Page, served: Served[], foreign: string[]) {
  const ctx = page.context();
  await ctx.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) {
      foreign.push(url.origin);
      return route.abort();
    }
    let file: string | null = null;
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body>spike</body></html>' });
    if (url.pathname === '/tesseract.esm.min.js') file = path.join(ROOT, 'node_modules', 'tesseract.js', 'dist', 'tesseract.esm.min.js');
    else if (url.pathname.startsWith(`/ocr/${VERSION}/`)) file = path.join(OCR_DIR, ...url.pathname.slice(`/ocr/${VERSION}/`.length).split('/'));
    else if (url.pathname.startsWith('/fixtures/')) file = path.join(ROOT, 'fixtures', 'documents', path.basename(url.pathname));
    if (!file) return route.fulfill({ status: 404, body: '' });
    let body: Buffer;
    try {
      body = readFileSync(file);
    } catch {
      return route.fulfill({ status: 404, body: '' });
    }
    served.push({ path: url.pathname, bytes: body.byteLength });
    return route.fulfill({ body, contentType: TYPES[path.extname(file)] ?? 'application/octet-stream' });
  });
  await page.goto(`${ORIGIN}/`);
}

interface RunResult {
  initMs: number;
  pages: Array<{ fixture: string; ms: number; words: number; meanLineConfidence: number; lines: string[] }>;
}

/** Runs in the page: one worker, then each fixture in turn. */
async function runOcr(page: Page, lang: string, variant: string, fixtures: string[]): Promise<RunResult> {
  return page.evaluate(
    async ({ lang, variant, fixtures, version }) => {
      // Loaded from a URL computed at run time, so the bundler leaves the import alone.
      const url = '/tesseract.esm.min.js';
      const loaded = (await import(url)) as { createWorker?: (...a: unknown[]) => Promise<any>; default?: { createWorker: (...a: unknown[]) => Promise<any> } };
      // The ESM build exports the API as its default export.
      const mod = { createWorker: loaded.createWorker ?? loaded.default!.createWorker };
      const t0 = performance.now();
      const worker = await mod.createWorker(lang, 1, {
        workerPath: `/ocr/${version}/worker.min.js`,
        corePath: `/ocr/${version}/core`,
        langPath: `/ocr/${version}/lang/${variant}`,
        cacheMethod: 'none',
        workerBlobURL: false,
        gzip: true,
      });
      const initMs = performance.now() - t0;
      const pages = [];
      for (const fixture of fixtures) {
        const t1 = performance.now();
        const { data } = await worker.recognize(`/fixtures/${fixture}`, {}, { blocks: true, text: false });
        const ms = performance.now() - t1;
        const lines: Array<{ text: string; confidence: number }> = [];
        let words = 0;
        for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) {
          lines.push({ text: l.text.trim(), confidence: l.confidence / 100 });
          words += l.words.length;
        }
        const nonEmpty = lines.filter((l) => l.text.length > 0);
        const mean = nonEmpty.length === 0 ? 0 : nonEmpty.reduce((s, l) => s + l.confidence, 0) / nonEmpty.length;
        pages.push({ fixture, ms, words, meanLineConfidence: mean, lines: nonEmpty.map((l) => l.text) });
      }
      await worker.terminate();
      return { initMs, pages };
    },
    { lang, variant, fixtures, version: VERSION },
  );
}

const summary: Record<string, unknown> = { tesseractVersion: VERSION, date: new Date().toISOString().slice(0, 10) };

test.afterAll(({ browserName }) => {
  const out = path.join(ROOT, 'test-results');
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, `ocr-spike-summary-${browserName}.json`), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
});

test('EXIF probe: does the decoder apply the orientation itself', async ({ page, browserName }) => {
  await serve(page, [], []);
  const size = await page.evaluate(async () => {
    const blob = await (await fetch('/fixtures/exif-probe.jpg')).blob();
    const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    return { width: bmp.width, height: bmp.height };
  });
  summary[`exifProbe.${browserName}`] = { ...size, decoderApplies: size.width === 1 && size.height === 2 };
  expect(size.width * size.height).toBe(2);
});

for (const variant of VARIANTS) {
  for (const [lang, fixtures] of [
    ['eng', ['clean-en.png', 'clean-en.jpg', 'glary.jpg']],
    ['msa', ['clean-ms.png', 'clean-ms.jpg']],
  ] as const) {
    test(`${lang} ${variant}`, async ({ page }) => {
      const served: Served[] = [];
      const foreign: string[] = [];
      await serve(page, served, foreign);
      const run = await runOcr(page, lang, variant, [...fixtures]);

      const engine = served.filter((s) => s.path.startsWith('/ocr/') || s.path === '/tesseract.esm.min.js');
      const pages = run.pages.map((p) => {
        const clean = !p.fixture.startsWith('glary');
        const bar = clean ? validationBar(labelsOf(p.fixture), p.lines) : null;
        return {
          fixture: p.fixture,
          recognitionMs: Math.round(p.ms),
          words: p.words,
          meanLineConfidence: Number(p.meanLineConfidence.toFixed(3)),
          ...(bar
            ? {
                bar: { passed: bar.passed, share: Number(bar.share.toFixed(3)), passedCount: bar.passedCount, labels: bar.labels.length },
                failedLabels: bar.labels.filter((l) => !l.passed).map((l) => ({ label: l.label, cer: Number(l.cer.toFixed(3)) })),
              }
            : {}),
        };
      });
      summary[`${lang}.${variant}`] = {
        initMs: Math.round(run.initMs),
        assetsServed: engine.map((s) => `${s.path} ${s.bytes}`),
        assetBytesTotal: engine.reduce((n, s) => n + s.bytes, 0),
        foreignOrigins: [...new Set(foreign)],
        pages,
      };
      // The engine never reaches another origin.
      expect(foreign).toEqual([]);
      expect(run.pages.every((p) => p.words >= 0)).toBe(true);
    });
  }
}
