/**
 * src/lib/pdf-fill/cjk-prototype.ts
 *
 * Spike 2 (task 14): can the real fill pipeline write Chinese into a PDF form?
 * A standalone script, not part of the app or the test suite.
 *
 *   CJK_FONT_PATH=<NotoSansSC-Regular.otf> npx tsx src/lib/pdf-fill/cjk-prototype.ts
 *
 * The Noto Sans SC file (SIL OFL 1.1) is not in the repo; pass its path.
 * Steps, each reported as PASS or FAIL:
 *  1. fillPdf writes two Simplified Chinese characters into `student.name` of
 *     fixtures/school-enrolment.pdf, with the font map [Noto Sans, Noto Sans SC
 *     subsetted] (Option A: runtime subsetting), saving with
 *     updateFieldAppearances: false (inside fillPdf).
 *  2. The value reads back exactly.
 *  3. The embedded font in the saved PDF has a glyph for every character
 *     (fontkit hasGlyphForCodePoint on the embedded bytes).
 *  4. pdf.js, reading the field appearance drawn onto the page, extracts the
 *     same characters (a .notdef box would extract as nothing or U+FFFD).
 *  5. Chrome renders the page with pdf.js; the field region is saved as a PNG
 *     for a visual check (SPIKE_PNG, default in the system temp folder).
 * The characters are written as \u escapes so no Chinese text is in repo files.
 */

import fontkit from '@pdf-lib/fontkit';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  concatTransformationMatrix,
  drawObject,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
  popGraphicsState,
  pushGraphicsState,
} from 'pdf-lib';
import { fillPdf } from './index.js';

const NAME = '\u6797\u5c0f'; // two Simplified Chinese characters (a synthetic test name)
const FIELD = 'student.name';

interface Step {
  name: string;
  pass: boolean;
  detail: string;
}

/** Font files embedded in the document (FontFile2 / FontFile3 streams), decoded. */
function embeddedFontFiles(doc: PDFDocument): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict) || obj.get(PDFName.of('Type'))?.toString() !== '/FontDescriptor') continue;
    for (const key of ['FontFile', 'FontFile2', 'FontFile3']) {
      const stream = obj.lookup(PDFName.of(key));
      if (stream instanceof PDFRawStream) out.push(decodePDFRawStream(stream).decode());
    }
  }
  return out;
}

/** Draw the field's appearance onto the page (as a viewer shows it), then extract text with pdf.js. */
async function extractedFieldText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const widget = doc.getForm().getTextField(FIELD).acroField.getWidgets()[0]!;
  const ap = widget.dict.lookup(PDFName.of('AP'), PDFDict);
  const normal = ap.get(PDFName.of('N'));
  if (!(normal instanceof PDFRef)) throw new Error('no appearance stream');
  const r = widget.getRectangle();
  const xo = page.node.newXObject('SpikeAp', normal);
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(1, 0, 0, 1, r.x, r.y), drawObject(xo), popGraphicsState());
  page.node.delete(PDFName.of('Annots'));
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: await doc.save(), useSystemFonts: false });
  const pdf = await task.promise;
  const content = await (await pdf.getPage(1)).getTextContent();
  const text = content.items
    .filter((i) => 'str' in i && i.transform[4] >= r.x - 1 && i.transform[4] <= r.x + r.width && i.transform[5] >= r.y - 1 && i.transform[5] <= r.y + r.height)
    .map((i) => ('str' in i ? i.str : ''))
    .join('');
  await task.destroy();
  return text;
}

/** Render page 1 in Chrome with pdf.js and save the field region as a PNG. */
async function renderInChrome(bytes: Uint8Array, out: string): Promise<string> {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ channel: process.env['PW_CHANNEL'] ?? 'chrome' });
  try {
    const page = await browser.newPage();
    const root = path.resolve('node_modules/pdfjs-dist/build');
    await page.route('https://spike.invalid/**', (route) => {
      const name = new URL(route.request().url()).pathname.slice(1);
      if (name === '') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
      return route.fulfill({ contentType: 'text/javascript', body: readFileSync(path.join(root, name)) });
    });
    await page.goto('https://spike.invalid/');
    const rect: { x: number; y: number; w: number; h: number } = await page.evaluate(async (b64) => {
      const pdfjs = (await import('https://spike.invalid/pdf.mjs' as string)) as typeof import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = 'https://spike.invalid/pdf.worker.mjs';
      const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const doc = await pdfjs.getDocument({ data }).promise;
      const p = await doc.getPage(1);
      const viewport = p.getViewport({ scale: 3 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      document.body.appendChild(canvas);
      await p.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport, annotationMode: pdfjs.AnnotationMode.ENABLE }).promise;
      // student.name rectangle, top-origin [36,140,559,164] from the fixture spec.
      return { x: 36 * 3, y: 140 * 3, w: (559 - 36) * 3, h: (164 - 140) * 3 };
    }, Buffer.from(bytes).toString('base64'));
    const box = (await page.locator('canvas').boundingBox())!;
    await page.setViewportSize({ width: Math.ceil(box.width), height: Math.ceil(box.height) });
    await page.screenshot({ path: out, clip: { x: box.x + rect.x, y: box.y + rect.y, width: rect.w, height: rect.h }, fullPage: true });
    return out;
  } finally {
    await browser.close();
  }
}

export async function runSpike(fontPath: string): Promise<Step[]> {
  const steps: Step[] = [];
  const record = (name: string, pass: boolean, detail: string) => {
    steps.push({ name, pass, detail });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
  };

  const cjkBytes = new Uint8Array(readFileSync(fontPath));
  const latin = { id: 'noto-latin', bytes: new Uint8Array(readFileSync('public/fonts/NotoSans-Regular.ttf')) };
  const cjk = { id: 'noto-sc', bytes: cjkBytes, subset: true };
  const pdf = new Uint8Array(readFileSync('fixtures/school-enrolment.pdf'));

  let filled: Uint8Array | undefined;
  const t0 = performance.now();
  try {
    filled = await fillPdf(pdf, new Map([[FIELD, { kind: 'text', value: NAME }]]), [latin, cjk]);
    record('1 fill with subsetted Noto Sans SC', true, `${Math.round(performance.now() - t0)} ms; PDF ${pdf.byteLength} -> ${filled.byteLength} bytes (+${filled.byteLength - pdf.byteLength})`);
  } catch (err) {
    record('1 fill with subsetted Noto Sans SC', false, err instanceof Error ? err.message : String(err));
    return steps;
  }

  const doc = await PDFDocument.load(filled);
  const value = doc.getForm().getTextField(FIELD).getText();
  record('2 value reads back', value === NAME, `got ${JSON.stringify(value)}`);

  // The CJK subset is embedded as bare CFF (FontFile3 /CIDFontType0C), which has no
  // cmap to query. Instead: the glyph ids the appearance draws must not include
  // glyph 0 (.notdef, the empty box), and there must be one per character.
  const fonts = embeddedFontFiles(doc);
  const sizes = fonts.map((b) => b.byteLength).join(', ');
  const widget = doc.getForm().getTextField(FIELD).acroField.getWidgets()[0]!;
  const apStream = widget.dict.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N'));
  const content = apStream instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(apStream).decode()).toString('latin1') : '';
  const hex = content.match(/<([0-9A-Fa-f]+)>\s*Tj/)?.[1] ?? '';
  const gids = (hex.match(/.{4}/g) ?? []).map((h: string) => parseInt(h, 16));
  const ok = gids.length === [...NAME].length && gids.every((g: number) => g !== 0);
  record('3 no .notdef glyph drawn', ok, `glyph ids ${JSON.stringify(gids)}; embedded font files ${sizes} bytes`);
  void fontkit;

  try {
    const text = await extractedFieldText(filled);
    record('4 pdf.js extracts the same characters', text === NAME, `extracted ${JSON.stringify(text)}`);
  } catch (err) {
    record('4 pdf.js extracts the same characters', false, err instanceof Error ? err.message : String(err));
  }

  try {
    const png = await renderInChrome(filled, process.env['SPIKE_PNG'] ?? path.join(os.tmpdir(), 'reforge-spike2-field.png'));
    record('5 Chrome render saved', existsSync(png), png);
  } catch (err) {
    record('5 Chrome render saved', false, err instanceof Error ? err.message.split('\n')[0]! : String(err));
  }

  if (process.env['SPIKE_PDF']) writeFileSync(process.env['SPIKE_PDF'], filled);
  return steps;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  const fontPath = process.env['CJK_FONT_PATH'] ?? path.join(os.tmpdir(), 'reforge-spike2', 'NotoSansSC-Regular.otf');
  if (!existsSync(fontPath)) {
    console.error(`No CJK font at ${fontPath}. Set CJK_FONT_PATH.`);
    process.exit(2);
  }
  runSpike(fontPath).then((steps) => {
    process.exitCode = steps.every((s) => s.pass) ? 0 : 1;
  });
}
