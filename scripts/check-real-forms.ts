/**
 * scripts/check-real-forms.ts
 *
 * Local-only reading check on a private folder of real forms (default
 * `.local/real-form-samples/`, which is git-ignored). It runs the same OCR
 * settings, line grouping and value rules as the app and prints AGGREGATE
 * numbers only: lines read, mean confidence, how many lines were offered as
 * label candidates, and how many of those still trip a value rule (should be 0).
 *
 *   npx tsx scripts/check-real-forms.ts [--dir <folder>] [--lang eng|msa|both] [--only 01,03]
 *
 * It never prints, saves or sends any recognised text, label list or image.
 * Files are identified only by their two-digit prefix. Nothing leaves this
 * machine: the OCR engine and language data are read from public/ocr.
 */

import { createCanvas, loadImage } from '@napi-rs/canvas';
import { createWorker } from 'tesseract.js';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { OCR_MODEL_VARIANT, WORKING_LONG_EDGE, type OcrLanguage } from '../src/lib/document/limits.js';
import { buildCandidates, buildPage } from '../src/lib/document/model.js';
import { isLowQuality, mapTesseractBlocks } from '../src/lib/document/ocr-map.js';
import { nextLineValues } from '../src/lib/document/next-line-values.js';
import { isPromptShaped } from '../src/lib/document/review-order.js';
import { workingImageSize } from '../src/lib/document/orientation.js';
import { classifyByValueRules, textRuleHits } from '../src/lib/document/value-rules.js';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

interface Row {
  file: string;
  lang: OcrLanguage;
  ms: number;
  lines: number;
  words: number;
  conf: number;
  low: boolean;
  candidates: number;
  likely: number;
  promptShaped: number;
  nextLine: number;
  valueLikeHidden: number;
  candidatesWithValueHit: number;
}

function localVersionDir(): string {
  const current = JSON.parse(readFileSync('public/ocr/current.json', 'utf8')) as { version: string };
  return path.resolve('public/ocr', current.version);
}

async function workingPng(file: string): Promise<{ png: Buffer; width: number; height: number }> {
  const img = await loadImage(readFileSync(file));
  const longEdge = Math.max(img.width, img.height);
  // Experiment only: --upscale enlarges small images to the working size (the app itself never enlarges).
  const resize = longEdge > WORKING_LONG_EDGE || (process.argv.includes('--upscale') && longEdge < WORKING_LONG_EDGE);
  const size = resize ? workingImageSize(img.width, img.height, WORKING_LONG_EDGE) : { width: img.width, height: img.height };
  const canvas = createCanvas(size.width, size.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.drawImage(img, 0, 0, size.width, size.height);
  return { png: canvas.toBuffer('image/png'), width: size.width, height: size.height };
}

async function main() {
  const dir = arg('--dir', '.local/real-form-samples');
  const langArg = arg('--lang', 'both');
  const only = arg('--only', '').split(',').filter(Boolean);
  const langs: OcrLanguage[] = langArg === 'both' ? ['eng', 'msa'] : [langArg as OcrLanguage];
  if (!existsSync(dir)) throw new Error(`folder not found: ${dir}`);

  const files = readdirSync(dir)
    .filter((f) => /\.(png|jpe?g)$/i.test(f))
    .filter((f) => only.length === 0 || only.includes(f.slice(0, 2)))
    .sort();
  if (files.length === 0) throw new Error('no images found');

  const base = localVersionDir();
  const rows: Row[] = [];
  for (const lang of langs) {
    const worker = await createWorker(lang, 1, {
      langPath: path.join(base, 'lang', OCR_MODEL_VARIANT),
      cacheMethod: 'none',
      gzip: true,
    });
    try {
      for (const f of files) {
        const { png, width, height } = await workingPng(path.join(dir, f));
        const started = Date.now();
        const out = await worker.recognize(png, {}, { blocks: true, text: false });
        const ms = Date.now() - started;
        const result = mapTesseractBlocks((out.data as { blocks?: unknown }).blocks);
        const page = buildPage({
          pageNumber: 1,
          width,
          height,
          rotation: 0,
          textSource: 'ocr',
          lines: result.lines,
          status: isLowQuality(result) ? 'low-quality' : 'ready',
        });
        const classes = classifyByValueRules(page);
        const candidates = buildCandidates([page], null, lang, () => classes);
        let valueLikeHidden = 0;
        for (const cls of classes.values()) if (cls === 'value-like') valueLikeHidden++;
        rows.push({
          file: f.slice(0, 2),
          lang,
          ms,
          lines: page.lines.length,
          words: result.wordCount,
          conf: result.meanLineConfidence,
          low: isLowQuality(result),
          candidates: candidates.length,
          likely: candidates.filter((c) => c.labelClass === 'likely-label').length,
          nextLine: nextLineValues(page).size,
          promptShaped: candidates.filter((c) => isPromptShaped(c.text)).length,
          valueLikeHidden,
          // A candidate text that still trips a value rule would be a leak into the review list.
          candidatesWithValueHit: candidates.filter((c) => textRuleHits(c.text).length > 0).length,
        });
      }
    } finally {
      await worker.terminate();
    }
  }

  console.log('file lang  secs lines words conf  low  offered likely prompts hidden(value-like) offered-with-value-hit');
  for (const r of rows) {
    console.log(
      [
        r.file.padEnd(4),
        r.lang.padEnd(4),
        (r.ms / 1000).toFixed(1).padStart(5),
        String(r.lines).padStart(5),
        String(r.words).padStart(5),
        r.conf.toFixed(2).padStart(5),
        (r.low ? 'yes' : 'no').padStart(4),
        String(r.candidates).padStart(7),
        String(r.likely).padStart(6),
        String(r.promptShaped).padStart(7),
        String(r.valueLikeHidden).padStart(16),
        String(r.candidatesWithValueHit).padStart(24),
      ].join(' '),
    );
  }
  for (const lang of langs) {
    const own = rows.filter((r) => r.lang === lang);
    const sum = (k: keyof Row) => own.reduce((s, r) => s + (r[k] as number), 0);
    const lowCount = own.filter((r) => r.low).length;
    console.log(
      `\n${lang}: ${own.length} images, ${sum('lines')} lines, mean confidence ${(sum('conf') / own.length).toFixed(2)}, low-quality ${lowCount}/${own.length}, ` +
        `offered ${sum('candidates')} (${((sum('candidates') / Math.max(1, sum('lines'))) * 100).toFixed(0)}% of lines), ` +
        `question-like ${sum('promptShaped')}, hidden as the line below a question ${sum('nextLine')}, offered with a value hit ${sum('candidatesWithValueHit')}, mean time ${(sum('ms') / own.length / 1000).toFixed(1)} s`,
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
