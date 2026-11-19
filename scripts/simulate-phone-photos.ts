/**
 * scripts/simulate-phone-photos.ts
 *
 * Reading check on SIMULATED phone photos of the synthetic sample forms
 * (fixtures/documents/clean-en.png and clean-ms.png). Each variant applies one
 * typical phone problem to the clean page, then runs the same OCR settings and
 * value rules as the app and prints aggregate numbers only. The images are
 * made in memory and never written to disk.
 *
 *   npx tsx scripts/simulate-phone-photos.ts
 *
 * This is a stand-in for real phone photos (task 3.4), not a replacement: it
 * says how much each problem costs, not how a real camera behaves.
 */

import { createCanvas, loadImage, type Canvas } from '@napi-rs/canvas';
import { createWorker } from 'tesseract.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { OCR_MODEL_VARIANT, WORKING_LONG_EDGE, type OcrLanguage } from '../src/lib/document/limits.js';
import { buildCandidates, buildPage } from '../src/lib/document/model.js';
import { isLowQuality, mapTesseractBlocks } from '../src/lib/document/ocr-map.js';
import { workingImageSize } from '../src/lib/document/orientation.js';
import { classifyByValueRules, textRuleHits } from '../src/lib/document/value-rules.js';

type Img = Awaited<ReturnType<typeof loadImage>>;

/** A small deterministic generator, so every run sees the same noise. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function fresh(w: number, h: number): Canvas {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e9e6df'; // table top around the paper
  ctx.fillRect(0, 0, w, h);
  return c;
}

const VARIANTS: Array<{ name: string; make: (img: Img) => Canvas }> = [
  { name: 'straight', make: (img) => { const c = fresh(img.width, img.height); c.getContext('2d').drawImage(img, 0, 0); return c; } },
  {
    name: 'tilted 4 deg',
    make: (img) => {
      const c = fresh(Math.round(img.width * 1.1), Math.round(img.height * 1.1));
      const x = c.getContext('2d');
      x.translate(c.width / 2, c.height / 2);
      x.rotate((4 * Math.PI) / 180);
      x.drawImage(img, -img.width / 2, -img.height / 2);
      return c;
    },
  },
  {
    name: 'angled (perspective-like squeeze)',
    make: (img) => {
      // Squeeze the right edge: a cheap stand-in for holding the phone at an angle.
      const c = fresh(img.width, img.height);
      const x = c.getContext('2d');
      const strips = 200;
      for (let i = 0; i < strips; i++) {
        const sx = (img.width / strips) * i;
        const k = 1 - 0.18 * (i / strips);
        const dh = img.height * k;
        x.drawImage(img, sx, 0, img.width / strips + 1, img.height, sx, (img.height - dh) / 2, img.width / strips + 1, dh);
      }
      return c;
    },
  },
  {
    name: 'shadow across the page',
    make: (img) => {
      const c = fresh(img.width, img.height);
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0);
      const g = x.createLinearGradient(0, 0, img.width, img.height * 0.6);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.5, 'rgba(0,0,0,0.25)');
      g.addColorStop(1, 'rgba(0,0,0,0.55)');
      x.fillStyle = g;
      x.fillRect(0, 0, img.width, img.height);
      return c;
    },
  },
  {
    name: 'glare patch',
    make: (img) => {
      const c = fresh(img.width, img.height);
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0);
      const g = x.createRadialGradient(img.width * 0.65, img.height * 0.35, 10, img.width * 0.65, img.height * 0.35, img.width * 0.3);
      g.addColorStop(0, 'rgba(255,255,255,0.97)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, img.width, img.height);
      return c;
    },
  },
  {
    name: 'blurry (hand shake)',
    make: (img) => {
      const c = fresh(img.width, img.height);
      const x = c.getContext('2d');
      x.globalAlpha = 0.34;
      for (const [dx, dy] of [[0, 0], [2, 1], [-2, -1]] as const) x.drawImage(img, dx, dy);
      return c;
    },
  },
  {
    name: 'dim and noisy',
    make: (img) => {
      const c = fresh(img.width, img.height);
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height);
      const r = rng(7);
      for (let i = 0; i < d.data.length; i += 4) {
        const n = (r() - 0.5) * 60;
        for (let k = 0; k < 3; k++) d.data[i + k] = Math.max(0, Math.min(255, d.data[i + k]! * 0.55 + n));
      }
      x.putImageData(d, 0, 0);
      return c;
    },
  },
  {
    name: 'far away (page is a quarter of the picture)',
    make: (img) => {
      const c = fresh(img.width, img.height);
      c.getContext('2d').drawImage(img, img.width * 0.25, img.height * 0.25, img.width * 0.5, img.height * 0.5);
      return c;
    },
  },
  {
    name: 'chat-app compressed (long edge 1000 px, JPEG 55)',
    make: (img) => {
      const small = workingImageSize(img.width, img.height, 1000);
      const c = createCanvas(small.width, small.height);
      c.getContext('2d').drawImage(img, 0, 0, small.width, small.height);
      return c;
    },
  },
];

async function working(c: Canvas, jpegQuality?: number): Promise<{ png: Buffer; width: number; height: number }> {
  // The app enlarges nothing today; this mirrors that, so the numbers match the app.
  let canvas = c;
  if (jpegQuality !== undefined) {
    const img = await loadImage(c.toBuffer('image/jpeg', jpegQuality));
    canvas = createCanvas(img.width, img.height);
    canvas.getContext('2d').drawImage(img, 0, 0);
  }
  const longEdge = Math.max(canvas.width, canvas.height);
  if (longEdge <= WORKING_LONG_EDGE) return { png: canvas.toBuffer('image/png'), width: canvas.width, height: canvas.height };
  const s = workingImageSize(canvas.width, canvas.height, WORKING_LONG_EDGE);
  const out = createCanvas(s.width, s.height);
  out.getContext('2d').drawImage(canvas, 0, 0, s.width, s.height);
  return { png: out.toBuffer('image/png'), width: s.width, height: s.height };
}

async function main() {
  const current = JSON.parse(readFileSync('public/ocr/current.json', 'utf8')) as { version: string };
  const base = path.resolve('public/ocr', current.version);
  const forms: Array<{ file: string; lang: OcrLanguage }> = [
    { file: 'fixtures/documents/clean-en.png', lang: 'eng' },
    { file: 'fixtures/documents/clean-ms.png', lang: 'msa' },
  ];

  console.log('form lang variant                                            secs lines conf  low  offered  value-hits');
  const totals: Record<string, { lines: number; conf: number; n: number; low: number }> = {};
  for (const { file, lang } of forms) {
    const img = await loadImage(readFileSync(file));
    const worker = await createWorker(lang, 1, { langPath: path.join(base, 'lang', OCR_MODEL_VARIANT), cacheMethod: 'none', gzip: true });
    try {
      for (const v of VARIANTS) {
        const canvas = v.make(img);
        const { png, width, height } = await working(canvas, v.name.startsWith('chat-app') ? 55 : undefined);
        const started = Date.now();
        const out = await worker.recognize(png, {}, { blocks: true, text: false });
        const ms = Date.now() - started;
        const result = mapTesseractBlocks((out.data as { blocks?: unknown }).blocks);
        const page = buildPage({ pageNumber: 1, width, height, rotation: 0, textSource: 'ocr', lines: result.lines, status: isLowQuality(result) ? 'low-quality' : 'ready' });
        const candidates = buildCandidates([page], null, lang, classifyByValueRules(page).size ? () => classifyByValueRules(page) : () => new Map());
        const hits = candidates.filter((c) => textRuleHits(c.text).length > 0).length;
        console.log(
          [path.basename(file, '.png').slice(6).padEnd(4), lang.padEnd(4), v.name.padEnd(51), (ms / 1000).toFixed(1).padStart(4), String(page.lines.length).padStart(5), result.meanLineConfidence.toFixed(2).padStart(5), (isLowQuality(result) ? 'yes' : 'no').padStart(4), String(candidates.length).padStart(7), String(hits).padStart(10)].join(' '),
        );
        const t = (totals[v.name] ??= { lines: 0, conf: 0, n: 0, low: 0 });
        t.lines += page.lines.length;
        t.conf += result.meanLineConfidence;
        t.n += 1;
        t.low += isLowQuality(result) ? 1 : 0;
      }
    } finally {
      await worker.terminate();
    }
  }
  console.log('\nper variant (both forms): mean lines, mean confidence, low-quality count');
  for (const [name, t] of Object.entries(totals)) console.log(`${name.padEnd(51)} ${(t.lines / t.n).toFixed(0).padStart(4)} lines  ${(t.conf / t.n).toFixed(2)}  low ${t.low}/${t.n}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
