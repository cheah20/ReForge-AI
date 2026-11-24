/**
 * tests/ocr/real-ocr.spec.ts
 *
 * Real OCR tests (formbridge-any-document task 14.1), run by hand with
 * `npm run test:ocr` and kept out of `npm test` and `npm run test:e2e`.
 * Real Tesseract.js runs in the browser from the app's own `/ocr/` folder (a
 * fake origin served by Playwright routes, so a request to any other origin
 * is aborted and counted) on:
 *
 *  - the clean English photo, which must pass the OCR_Validation_Bar,
 *  - the EXIF-tagged rotated photo, after the orientation is applied once,
 *  - the untagged rotated photo, after one rotate press,
 *  - the glary and blurred photo, which must be a Low_Quality_Page,
 *  - the clean Malay photo, only while `msa` is in VALIDATED_OCR_LANGUAGES.
 *
 * Timings are printed. Nothing recognised is written to a file or committed.
 */

import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { OCR_MIN_MEAN_CONFIDENCE, OCR_MIN_WORDS, OCR_MODEL_VARIANT, VALIDATED_OCR_LANGUAGES } from '../../src/lib/document/limits.js';
import { validationBar } from './cer.js';

const ORIGIN = 'https://app.real-ocr.test';
const ROOT = process.cwd();
const VERSION = (JSON.parse(readFileSync(path.join(ROOT, 'node_modules', 'tesseract.js', 'package.json'), 'utf8')) as { version: string }).version;
const OCR_DIR = path.join(ROOT, 'public', 'ocr', VERSION);

interface ExpectedFile {
  file: string;
  lines?: Array<{ text: string; expect: string }>;
}
const EXPECTED = (JSON.parse(readFileSync(path.join(ROOT, 'fixtures', 'documents', 'expected.json'), 'utf8')) as { fixtures: ExpectedFile[] }).fixtures;
const labelsOf = (file: string) => EXPECTED.find((f) => f.file === file)!.lines!.filter((l) => l.expect === 'selected').map((l) => l.text);

const TYPES: Record<string, string> = { '.js': 'text/javascript', '.json': 'application/json', '.gz': 'application/gzip', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm' };

/** One Working_Image to read: the fixture, whether to apply its EXIF orientation, and the clockwise turns of the rotate control. */
interface Job {
  fixture: string;
  turns: 0 | 1 | 2 | 3;
}

interface Read {
  fixture: string;
  turns: number;
  ms: number;
  words: number;
  meanLineConfidence: number;
  lines: string[];
}

async function serve(page: Page, foreign: string[]) {
  await page.context().route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) {
      foreign.push(url.origin);
      return route.abort();
    }
    let file: string | null = null;
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body>real ocr</body></html>' });
    if (url.pathname === '/tesseract.esm.min.js') file = path.join(ROOT, 'node_modules', 'tesseract.js', 'dist', 'tesseract.esm.min.js');
    else if (url.pathname.startsWith(`/ocr/${VERSION}/`)) file = path.join(OCR_DIR, ...url.pathname.slice(`/ocr/${VERSION}/`.length).split('/'));
    else if (url.pathname.startsWith('/fixtures/')) file = path.join(ROOT, 'fixtures', 'documents', path.basename(url.pathname));
    if (!file) return route.fulfill({ status: 404, body: '' });
    try {
      return route.fulfill({ body: readFileSync(file), contentType: TYPES[path.extname(file)] ?? 'application/octet-stream' });
    } catch {
      return route.fulfill({ status: 404, body: '' });
    }
  });
  await page.goto(`${ORIGIN}/`);
}

/** Runs in the page: one worker, then each job in turn, through a canvas so the EXIF orientation is applied once. */
async function readAll(page: Page, lang: string, jobs: Job[]): Promise<{ initMs: number; reads: Read[] }> {
  return page.evaluate(
    async ({ lang, jobs, version, variant }) => {
      const url = '/tesseract.esm.min.js';
      const loaded = (await import(url)) as { createWorker?: (...a: unknown[]) => Promise<any>; default?: { createWorker: (...a: unknown[]) => Promise<any> } };
      const createWorker = loaded.createWorker ?? loaded.default!.createWorker;
      const t0 = performance.now();
      const worker = await createWorker(lang, 1, {
        workerPath: `/ocr/${version}/worker.min.js`,
        corePath: `/ocr/${version}/core`,
        langPath: `/ocr/${version}/lang/${variant}`,
        cacheMethod: 'none',
        workerBlobURL: false,
        gzip: true,
      });
      const initMs = performance.now() - t0;
      const reads = [];
      for (const job of jobs) {
        const blob = await (await fetch(`/fixtures/${job.fixture}`)).blob();
        // 'from-image' applies the EXIF tag once; an untagged photo is turned by the rotate control.
        const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
        const swap = job.turns % 2 === 1;
        const canvas = document.createElement('canvas');
        canvas.width = swap ? bmp.height : bmp.width;
        canvas.height = swap ? bmp.width : bmp.height;
        const ctx = canvas.getContext('2d')!;
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((job.turns * Math.PI) / 2);
        ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
        const t1 = performance.now();
        const { data } = await worker.recognize(canvas, {}, { blocks: true, text: false });
        const ms = performance.now() - t1;
        const lines: Array<{ text: string; confidence: number }> = [];
        let words = 0;
        for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) {
          lines.push({ text: l.text.trim(), confidence: l.confidence / 100 });
          words += l.words.length;
        }
        const nonEmpty = lines.filter((l) => l.text.length > 0);
        const mean = nonEmpty.length === 0 ? 0 : nonEmpty.reduce((s, l) => s + l.confidence, 0) / nonEmpty.length;
        reads.push({ fixture: job.fixture, turns: job.turns, ms, words, meanLineConfidence: mean, lines: nonEmpty.map((l) => l.text) });
      }
      await worker.terminate();
      return { initMs, reads };
    },
    { lang, jobs, version: VERSION, variant: OCR_MODEL_VARIANT },
  );
}

/** Requirement 9.4: too few words, or a mean line confidence under the threshold. */
const isLowQuality = (r: Read) => r.words < OCR_MIN_WORDS || r.meanLineConfidence < OCR_MIN_MEAN_CONFIDENCE;

const timings: Record<string, unknown> = { tesseractVersion: VERSION, modelVariant: OCR_MODEL_VARIANT, date: new Date().toISOString().slice(0, 10) };

test.afterAll(() => {
  // Counts and times only: no recognised text.
  console.log(JSON.stringify(timings, null, 2));
});

test('English: the clean photo passes the validation bar, both rotated photos pass once upright, the glary photo is a low-quality page', async ({ page, browserName }) => {
  const foreign: string[] = [];
  await serve(page, foreign);
  const { initMs, reads } = await readAll(page, 'eng', [
    { fixture: 'clean-en.png', turns: 0 },
    { fixture: 'clean-en.jpg', turns: 0 },
    { fixture: 'rotated-exif6.jpg', turns: 0 },
    // The untagged photo has its pixels turned 90 degrees anticlockwise; one rotate press (a clockwise turn) makes it upright.
    { fixture: 'rotated-untagged.jpg', turns: 1 },
    { fixture: 'glary.jpg', turns: 0 },
  ]);
  const byFile = (f: string) => reads.find((r) => r.fixture === f)!;
  timings[`eng.${browserName}`] = {
    initMs: Math.round(initMs),
    pages: reads.map((r) => ({ fixture: r.fixture, turns: r.turns, recognitionMs: Math.round(r.ms), words: r.words, meanLineConfidence: Number(r.meanLineConfidence.toFixed(3)), lowQuality: isLowQuality(r) })),
  };

  for (const f of ['clean-en.png', 'clean-en.jpg', 'rotated-exif6.jpg', 'rotated-untagged.jpg']) {
    const bar = validationBar(labelsOf(f), byFile(f).lines);
    expect(bar.passed, `${f}: ${bar.passedCount} of ${bar.labels.length} labels within 10% CER`).toBe(true);
    expect(isLowQuality(byFile(f)), `${f} must not be a low-quality page`).toBe(false);
  }
  expect(isLowQuality(byFile('glary.jpg')), 'the glary photo must be a Low_Quality_Page').toBe(true);
  // The engine never reaches another origin.
  expect(foreign).toEqual([]);
});

test('Malay: the clean photo passes the validation bar while Malay is validated', async ({ page, browserName }) => {
  test.skip(!VALIDATED_OCR_LANGUAGES.includes('msa'), 'Malay is not in VALIDATED_OCR_LANGUAGES');
  const foreign: string[] = [];
  await serve(page, foreign);
  const { initMs, reads } = await readAll(page, 'msa', [
    { fixture: 'clean-ms.png', turns: 0 },
    { fixture: 'clean-ms.jpg', turns: 0 },
  ]);
  timings[`msa.${browserName}`] = {
    initMs: Math.round(initMs),
    pages: reads.map((r) => ({ fixture: r.fixture, recognitionMs: Math.round(r.ms), words: r.words, meanLineConfidence: Number(r.meanLineConfidence.toFixed(3)) })),
  };
  for (const r of reads) {
    const bar = validationBar(labelsOf(r.fixture), r.lines);
    expect(bar.passed, `${r.fixture}: ${bar.passedCount} of ${bar.labels.length} labels within 10% CER`).toBe(true);
  }
  expect(foreign).toEqual([]);
});
