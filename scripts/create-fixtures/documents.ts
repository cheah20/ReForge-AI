/**
 * scripts/create-fixtures/documents.ts
 *
 * Writes the synthetic photo, scan and file fixtures of formbridge-any-document
 * (Requirement 25.1, task 3.1) into fixtures/documents/.
 *
 *   PW_CHANNEL=chrome npx tsx scripts/create-fixtures/documents.ts            write the fixtures
 *   PW_CHANNEL=chrome npx tsx scripts/create-fixtures/documents.ts --check    render into a temp folder and
 *                                                                              compare byte by byte
 *
 * Images are rendered by Chromium (Playwright) from the form data in
 * document-forms.ts with open-licensed Noto fonts, so the printed text is
 * exactly known. The renderer also measures every printed line and word, and
 * writes that as the mock OCR result of the fixture: the text and boxes an
 * ideal reader would return. Tests use it instead of the real OCR engine.
 *
 * Fonts: Noto Sans comes from public/fonts. The Chinese and Tamil samples need
 * Noto Sans SC, Noto Sans TC and Noto Sans Tamil (SIL OFL 1.1), which are not
 * in the repository; they are read from FIXTURE_FONT_DIR (default: the OS temp
 * folder, `reforge-fonts`) and checked against the SHA-256 values below.
 *
 * Not written to disk: the file one byte over the 15 MB limit. Tests build it
 * in memory with `oversizeBytes()`, so the repository does not hold 15 MB of zeros.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { withSeededRandom } from './create-fixtures.js';
import {
  CLEAN_EN,
  CLEAN_MS,
  IMAGE_FORMS,
  MIXED_PDF_PAGES,
  printedLines,
  type FormSpec,
  type Item,
} from './document-forms.js';

const ROOT = process.cwd();
export const DOCUMENT_FIXTURES_DIR = path.join(ROOT, 'fixtures', 'documents');

/** Requirement 3.1: 15,728,640 bytes is the limit. */
export const SIZE_LIMIT_BYTES = 15_728_640;
export function oversizeBytes(): Uint8Array {
  const bytes = new Uint8Array(SIZE_LIMIT_BYTES + 1);
  // A JPEG signature, so the size check (not the sniffer) is what refuses it.
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  return bytes;
}

const PAGE = { a4: { width: 1556, height: 2200 }, half: { width: 1556, height: 1100 } } as const;

interface FontFile {
  family: string;
  file: string;
  sha256?: string;
}

const FONT_DIR = process.env['FIXTURE_FONT_DIR'] ?? path.join(tmpdir(), 'reforge-fonts');
const FONTS: Record<FormSpec['font'], FontFile[]> = {
  latin: [{ family: 'Noto Sans', file: path.join(ROOT, 'public', 'fonts', 'NotoSans-Regular.ttf') }],
  sc: [{ family: 'Noto Sans SC', file: path.join(FONT_DIR, 'NotoSansSC-Regular.otf'), sha256: 'faa6c9df652116dde789d351359f3d7e5d2285a2b2a1f04a2d7244df706d5ea9' }],
  tc: [{ family: 'Noto Sans TC', file: path.join(FONT_DIR, 'NotoSansTC-Regular.otf'), sha256: '5bab0cb3c1cf89dde07c4a95a4054b195afbcfe784d69d75c340780712237537' }],
  tamil: [{ family: 'Noto Sans Tamil', file: path.join(FONT_DIR, 'NotoSansTamil-Regular.ttf'), sha256: '3c0a186feb3c63c7f6d63e1511dcdc144e745ae09b98e217c83f3e317974f6f9' }],
};

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function fontsFor(form: FormSpec): FontFile[] {
  const list = [...FONTS[form.font], ...FONTS.latin];
  // The split fixture prints an SSN in CJK numerals inside a Latin form.
  if (form.name === 'prefilled-split') list.push(...FONTS.sc);
  for (const f of list) {
    if (!existsSync(f.file)) throw new Error(`Font missing for ${form.name}: ${f.file} (set FIXTURE_FONT_DIR)`);
    if (f.sha256 && sha256(readFileSync(f.file)) !== f.sha256) throw new Error(`Font checksum differs: ${f.file}`);
  }
  return list;
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const line = (text: string) => `<span class="ln">${esc(text)}</span>`;

function itemHtml(item: Item): string {
  switch (item.t) {
    case 'title':
      return `<div class="title">${line(item.text)}</div>`;
    case 'note':
      return `<div class="note">${line(item.text)}</div>`;
    case 'gap':
      return '<div class="gap"></div>';
    case 'line':
      return `<div class="row">${line(item.text)}</div>`;
    case 'inline':
      return `<div class="row">${line(`${item.label} ${item.value}`)}</div>`;
    case 'pair':
      return `<div class="row flex">${line(item.label)}<span class="spacer"></span>${line(item.right)}</div>`;
    case 'field':
      if (item.area === 'underline') {
        return `<div class="row flex">${line(item.label)}<span class="fill area" data-kind="underline">${item.value ? line(item.value) : ''}</span></div>`;
      }
      return `<div class="row">${line(item.label)}<div class="box area" data-kind="box">${item.value ? line(item.value) : ''}</div></div>`;
    case 'table':
      return `<table class="area" data-kind="table">${item.rows
        .map((r) => `<tr>${r.map((c) => `<td>${c.lines.map((l) => `<div>${line(l)}</div>`).join('')}</td>`).join('')}</tr>`)
        .join('')}</table>`;
  }
}

export type Variant = 'plain' | 'rotated' | 'glary';

function formHtml(form: FormSpec, variant: Variant): string {
  const size = PAGE[form.size];
  const fonts = fontsFor(form);
  const faces = fonts.map((f) => `@font-face { font-family: '${f.family}'; src: url('${pathToFileURL(f.file).href}'); }`).join('\n');
  const family = fonts.map((f) => `'${f.family}'`).join(', ');
  const vw = variant === 'rotated' ? size.height : size.width;
  const vh = variant === 'rotated' ? size.width : size.height;
  const pageTransform = variant === 'rotated' ? `transform-origin: 0 0; transform: translate(0px, ${size.width}px) rotate(-90deg);` : '';
  const pageFilter = variant === 'glary' ? 'filter: blur(5px) contrast(0.55) brightness(1.12);' : '';
  const glare =
    variant === 'glary'
      ? `<div style="position:absolute;inset:0;background:radial-gradient(circle at 58% 34%, rgba(255,255,255,0.97) 0, rgba(255,255,255,0.88) 22%, rgba(255,255,255,0) 52%);"></div>`
      : '';
  return `<!doctype html><html lang="${form.lang}"><head><meta charset="utf-8"><style>
${faces}
html, body { margin: 0; width: ${vw}px; height: ${vh}px; overflow: hidden; background: #fff; }
.page { position: absolute; left: 0; top: 0; width: ${size.width}px; height: ${size.height}px; box-sizing: border-box;
  padding: 120px 120px; background: #fff; color: #1a1a1a; font-family: ${family}; font-size: 34px; line-height: 1.3;
  font-kerning: none; font-variant-ligatures: none; ${pageTransform} ${pageFilter} }
.title { font-size: 48px; margin-bottom: 24px; }
.note { margin: 12px 0; }
.gap { height: 40px; }
.row { margin-top: 44px; }
.flex { display: flex; align-items: flex-end; }
.fill { flex: 1; margin-left: 24px; border-bottom: 4px solid #1a1a1a; min-height: 1.2em; padding-left: 12px; }
.box { margin-top: 16px; height: 170px; border: 4px solid #1a1a1a; padding: 16px 20px; box-sizing: border-box; }
.spacer { width: 420px; }
table { margin-top: 44px; border-collapse: collapse; }
td { border: 4px solid #1a1a1a; padding: 18px 28px; vertical-align: top; min-width: 360px; }
td div + div { margin-top: 12px; }
</style></head><body><div class="page">${form.items.map(itemHtml).join('\n')}</div>${glare}</body></html>`;
}

// ---------------------------------------------------------------------------
// Measuring: the mock OCR result
// ---------------------------------------------------------------------------

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface MockLine {
  text: string;
  box: Box;
  confidence: number;
  words: Array<{ text: string; box: Box }>;
}

export interface MockPage {
  width: number;
  height: number;
  lines: MockLine[];
  answerAreas: Array<{ kind: string; box: Box }>;
  /** True when the result is an invented poor reading, not a measurement. */
  simulated?: boolean;
}

async function measure(page: Page): Promise<Omit<MockPage, 'width' | 'height'>> {
  return page.evaluate(() => {
    const round = (r: DOMRect) => ({ left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) });
    const lines = [...document.querySelectorAll<HTMLElement>('.ln')].map((el) => {
      const node = el.firstChild as Text;
      const text = node.data;
      const words: Array<{ text: string; box: ReturnType<typeof round> }> = [];
      const re = /\S+/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const range = document.createRange();
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        words.push({ text: m[0], box: round(range.getBoundingClientRect()) });
      }
      return { text, box: round(el.getBoundingClientRect()), confidence: 0.95, words };
    });
    const answerAreas = [...document.querySelectorAll<HTMLElement>('.area')].map((el) => ({ kind: el.dataset['kind']!, box: round(el.getBoundingClientRect()) }));
    return { lines, answerAreas };
  });
}

/** Reading order: rows from top to bottom (lines whose vertical centres are within half a line), then left to right. */
export function readingOrder<T extends { box: Box }>(lines: T[]): T[] {
  const sorted = [...lines].sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left);
  const rows: T[][] = [];
  for (const l of sorted) {
    const centre = (l.box.top + l.box.bottom) / 2;
    const row = rows.find((r) => Math.abs((r[0]!.box.top + r[0]!.box.bottom) / 2 - centre) < (l.box.bottom - l.box.top) / 2);
    if (row) row.push(l);
    else rows.push([l]);
  }
  return rows.flatMap((r) => r.sort((a, b) => a.box.left - b.box.left));
}

/** A poor reading of a glary photo: a third of the lines, garbled, at low confidence. */
function simulatePoorReading(clean: MockPage): MockPage {
  const lines = clean.lines
    .filter((_, i) => i % 3 === 0)
    .map((l) => ({ ...l, text: l.text.replace(/[aeiou]/g, '.'), confidence: 0.32, words: l.words.map((w) => ({ ...w, text: w.text.replace(/[aeiou]/g, '.') })) }));
  return { ...clean, lines, simulated: true };
}

// ---------------------------------------------------------------------------
// Image files
// ---------------------------------------------------------------------------

/** An APP1 Exif segment holding only the Orientation tag (TIFF little-endian). */
export function exifOrientationSegment(orientation: number): Uint8Array {
  const tiff = [0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
  const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
  const length = payload.length + 2;
  return new Uint8Array([0xff, 0xe1, length >> 8, length & 0xff, ...payload]);
}

export function withExifOrientation(jpeg: Uint8Array, orientation: number): Uint8Array {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('not a JPEG');
  const seg = exifOrientationSegment(orientation);
  const out = new Uint8Array(jpeg.length + seg.length);
  out.set(jpeg.subarray(0, 2));
  out.set(seg, 2);
  out.set(jpeg.subarray(2), 2 + seg.length);
  return out;
}

async function render(browser: Browser, form: FormSpec, variant: Variant, type: 'png' | 'jpeg', quality?: number): Promise<{ bytes: Uint8Array; mock: MockPage }> {
  const size = PAGE[form.size];
  const viewport = variant === 'rotated' ? { width: size.height, height: size.width } : { ...size };
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  // tsx (esbuild) wraps named functions in a `__name` helper; functions passed to
  // page.evaluate run in the page, where that helper does not exist. Define it there.
  // Passed as a string so the bundler does not rewrite it.
  await page.addInitScript({ content: 'window.__name = (f) => f;' });
  const dir = mkdtempSync(path.join(tmpdir(), 'reforge-fixture-'));
  try {
    const file = path.join(dir, 'form.html');
    writeFileSync(file, formHtml(form, variant));
    await page.goto(pathToFileURL(file).href);
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    const bytes = new Uint8Array(await page.screenshot({ type, ...(type === 'jpeg' ? { quality: quality ?? 90 } : {}), animations: 'disabled', caret: 'hide' }));
    // Boxes are measured on the upright layout, which is what the Document_Path recognises after rotation.
    let measured = await measure(page);
    if (variant === 'rotated') {
      await page.evaluate(() => {
        document.querySelector<HTMLElement>('.page')!.style.transform = 'none';
      });
      measured = await measure(page);
    }
    return { bytes, mock: { width: size.width, height: size.height, lines: readingOrder(measured.lines), answerAreas: measured.answerAreas } };
  } finally {
    await ctx.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

async function probeJpeg(browser: Browser): Promise<Uint8Array> {
  const ctx = await browser.newContext({ viewport: { width: 2, height: 1 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.setContent('<html><body style="margin:0"><div style="display:flex;width:2px;height:1px"><div style="width:1px;background:#fff"></div><div style="width:1px;background:#000"></div></div></body></html>');
  const jpeg = new Uint8Array(await page.screenshot({ type: 'jpeg', quality: 90 }));
  await ctx.close();
  return withExifOrientation(jpeg, 6);
}

// ---------------------------------------------------------------------------
// PDFs without fields
// ---------------------------------------------------------------------------

const PX_TO_PT = 595.28 / 1556;

function drawTextPage(doc: PDFDocument, font: PDFFont, mock: MockPage, footer?: string): PDFPage {
  const page = doc.addPage([595.28, 841.89]);
  const h = 841.89;
  for (const l of mock.lines) {
    const size = (l.box.bottom - l.box.top) * PX_TO_PT * 0.75;
    page.drawText(l.text, { x: l.box.left * PX_TO_PT, y: h - l.box.bottom * PX_TO_PT + size * 0.3, size, font, color: rgb(0.1, 0.1, 0.1) });
  }
  for (const a of mock.answerAreas) {
    const x = a.box.left * PX_TO_PT;
    const w = (a.box.right - a.box.left) * PX_TO_PT;
    if (a.kind === 'underline') page.drawLine({ start: { x, y: h - a.box.bottom * PX_TO_PT }, end: { x: x + w, y: h - a.box.bottom * PX_TO_PT }, thickness: 1.5 });
    else page.drawRectangle({ x, y: h - a.box.bottom * PX_TO_PT, width: w, height: (a.box.bottom - a.box.top) * PX_TO_PT, borderWidth: 1.5, borderColor: rgb(0.1, 0.1, 0.1) });
  }
  if (footer) page.drawText(footer, { x: 46, y: 30, size: 10, font });
  return page;
}

async function newPdf(): Promise<{ doc: PDFDocument; font: PDFFont }> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(readFileSync(path.join(ROOT, 'public', 'fonts', 'NotoSans-Regular.ttf')), { subset: false });
  return { doc, font };
}

// ---------------------------------------------------------------------------
// Other files
// ---------------------------------------------------------------------------

const RTF = '{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Arial;}}\\f0\\fs24 Community Clinic Registration (sample form)\\par Full name:\\par}\n';

/** A minimal legacy Word compound file: the OLE signature, a header and a directory naming a WordDocument stream. */
function legacyDoc(): Uint8Array {
  const bytes = new Uint8Array(1536);
  bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  const view = new DataView(bytes.buffer);
  view.setUint16(0x18, 0x003e, true); // minor version
  view.setUint16(0x1a, 0x0003, true); // major version 3
  view.setUint16(0x1c, 0xfffe, true); // little-endian
  view.setUint16(0x1e, 0x0009, true); // 512-byte sectors
  view.setUint16(0x20, 0x0006, true); // 64-byte mini sectors
  view.setUint32(0x2c, 1, true); // one FAT sector
  view.setUint32(0x30, 1, true); // directory starts at sector 1
  view.setUint32(0x38, 0x1000, true); // mini stream cutoff
  view.setUint32(0x3c, 0xfffffffe, true);
  view.setUint32(0x44, 0xfffffffe, true);
  for (let i = 0; i < 109; i++) view.setUint32(0x4c + i * 4, i === 0 ? 0 : 0xffffffff, true);
  const fat = 512;
  view.setUint32(fat, 0xfffffffd, true);
  view.setUint32(fat + 4, 0xfffffffe, true);
  for (let i = 2; i < 128; i++) view.setUint32(fat + i * 4, 0xffffffff, true);
  const dir = 1024;
  const entry = (offset: number, name: string, type: number) => {
    for (let i = 0; i < name.length; i++) view.setUint16(offset + i * 2, name.charCodeAt(i), true);
    view.setUint16(offset + 0x40, (name.length + 1) * 2, true);
    bytes[offset + 0x42] = type;
    view.setUint32(offset + 0x44, 0xffffffff, true);
    view.setUint32(offset + 0x48, 0xffffffff, true);
    view.setUint32(offset + 0x4c, type === 5 ? 1 : 0xffffffff, true);
  };
  entry(dir, 'Root Entry', 5);
  entry(dir + 128, 'WordDocument', 2);
  return bytes;
}

// ---------------------------------------------------------------------------
// Build everything
// ---------------------------------------------------------------------------

export interface FixtureExpectation {
  file: string;
  kind: 'jpeg' | 'png' | 'pdf-without-fields' | 'fillable-pdf' | 'refused' | 'unknown' | 'probe';
  lang?: string;
  exifOrientation?: number;
  pages?: Array<{ textSource: 'text-layer' | 'ocr'; mock?: MockPage }>;
  /** Printed lines with what the Default_Selection should do with each. */
  lines?: Array<{ page: number; text: string; expect: string }>;
  canaries?: Array<{ value: string; where: string; state: string }>;
  note?: string;
}

/** JSON with every non-ASCII character written as a \u escape, so the files hold ASCII only. */
export function asciiJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2).replace(/[\u0080-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}\n`;
}

function linesOf(form: FormSpec, page = 1) {
  return printedLines(form).map((l) => ({ page, text: l.text, expect: l.expect }));
}

export async function buildDocumentFixtures(): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  const expected: FixtureExpectation[] = [];
  const text = (s: string) => new TextEncoder().encode(s);
  const channel = process.env['PW_CHANNEL'];
  const browser = await chromium.launch(channel ? { channel } : {});
  try {
    const mocks = new Map<string, MockPage>();
    for (const form of IMAGE_FORMS) {
      const png = await render(browser, form, 'plain', 'png');
      mocks.set(form.name, png.mock);
      files.set(`${form.name}.png`, png.bytes);
      expected.push({ file: `${form.name}.png`, kind: 'png', lang: form.lang, pages: [{ textSource: 'ocr', mock: png.mock }], lines: linesOf(form), canaries: form.canaries });
    }
    for (const form of [CLEAN_EN, CLEAN_MS]) {
      const jpg = await render(browser, form, 'plain', 'jpeg', 90);
      files.set(`${form.name}.jpg`, jpg.bytes);
      expected.push({ file: `${form.name}.jpg`, kind: 'jpeg', lang: form.lang, pages: [{ textSource: 'ocr', mock: jpg.mock }], lines: linesOf(form), canaries: [] });
    }

    const rotated = await render(browser, CLEAN_EN, 'rotated', 'jpeg', 90);
    files.set('rotated-exif6.jpg', withExifOrientation(rotated.bytes, 6));
    files.set('rotated-untagged.jpg', rotated.bytes);
    expected.push(
      { file: 'rotated-exif6.jpg', kind: 'jpeg', lang: 'en', exifOrientation: 6, pages: [{ textSource: 'ocr', mock: rotated.mock }], lines: linesOf(CLEAN_EN), note: 'Pixels turned 90 degrees anticlockwise; EXIF orientation 6 turns them upright. The mock is the upright reading.' },
      { file: 'rotated-untagged.jpg', kind: 'jpeg', lang: 'en', exifOrientation: 1, pages: [{ textSource: 'ocr', mock: rotated.mock }], lines: linesOf(CLEAN_EN), note: 'Same pixels, no EXIF tag: one rotate press turns it upright. The mock is the reading after that press.' },
    );

    const glary = await render(browser, CLEAN_EN, 'glary', 'jpeg', 55);
    files.set('glary.jpg', glary.bytes);
    expected.push({ file: 'glary.jpg', kind: 'jpeg', lang: 'en', pages: [{ textSource: 'ocr', mock: simulatePoorReading(glary.mock) }], lines: linesOf(CLEAN_EN), note: 'Blurred, low contrast, with a glare patch. The mock is an invented poor reading for the Retake_Advice tests; the real reading is measured by the OCR spike.' });

    files.set('exif-probe.jpg', await probeJpeg(browser));
    expected.push({ file: 'exif-probe.jpg', kind: 'probe', exifOrientation: 6, note: '2 x 1 px; a decoder that applies EXIF orientation returns 1 x 2.' });

    // PDFs without fields.
    const page3 = MIXED_PDF_PAGES[2]!.form;
    const page3Mock = (await render(browser, page3, 'plain', 'png')).mock;
    const msJpeg = files.get('clean-ms.jpg')!;
    const mixed = await withSeededRandom(20261112, async () => {
      const { doc, font } = await newPdf();
      drawTextPage(doc, font, mocks.get('clean-en')!);
      const img = await doc.embedJpg(msJpeg);
      doc.addPage([595.28, 841.89]).drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
      drawTextPage(doc, font, page3Mock);
      return doc.save();
    });
    files.set('mixed-text-and-scan.pdf', mixed);
    expected.push({
      file: 'mixed-text-and-scan.pdf',
      kind: 'pdf-without-fields',
      pages: [{ textSource: 'text-layer' }, { textSource: 'ocr', mock: mocks.get('clean-ms')! }, { textSource: 'text-layer' }],
      lines: [...linesOf(CLEAN_EN, 1), ...linesOf(CLEAN_MS, 2), ...linesOf(page3, 3)],
      note: 'Pages 1 and 3 carry a text layer; page 2 is a scanned image of the Malay form.',
    });

    const six = await withSeededRandom(20261113, async () => {
      const { doc, font } = await newPdf();
      for (let n = 1; n <= 6; n++) drawTextPage(doc, font, mocks.get('clean-en')!, `Page ${n} of 6`);
      return doc.save();
    });
    files.set('six-pages.pdf', six);
    expected.push({ file: 'six-pages.pdf', kind: 'pdf-without-fields', pages: Array.from({ length: 6 }, () => ({ textSource: 'text-layer' as const })), note: 'One page over the 5-page limit.' });

    const buttons = await withSeededRandom(20261114, async () => {
      const { doc, font } = await newPdf();
      const page = drawTextPage(doc, font, mocks.get('clean-en')!);
      const button = doc.getForm().createButton('print');
      button.addToPage('Print', page, { x: 420, y: 40, width: 120, height: 30, font });
      return doc.save({ updateFieldAppearances: false });
    });
    files.set('push-button-only.pdf', buttons);
    expected.push({ file: 'push-button-only.pdf', kind: 'pdf-without-fields', pages: [{ textSource: 'text-layer' }], note: 'Its only form field is a push button, so it has no answer field (Requirement 2.2).' });
  } finally {
    await browser.close();
  }

  // Refused and malformed files.
  files.set('form.rtf', text(RTF));
  files.set('form.doc', legacyDoc());
  const mixedPdf = files.get('mixed-text-and-scan.pdf')!;
  const enJpg = files.get('clean-en.jpg')!;
  const enPng = files.get('clean-en.png')!;
  files.set('truncated.pdf', mixedPdf.slice(0, Math.floor(mixedPdf.length * 0.4)));
  files.set('broken.pdf', text('%PDF-1.7\n%\u00e2\u00e3\u00cf\u00d3\nthis is not a PDF body\n'));
  files.set('truncated.jpg', enJpg.slice(0, Math.floor(enJpg.length * 0.3)));
  files.set('truncated.png', enPng.slice(0, Math.floor(enPng.length * 0.3)));
  const badCrc = enPng.slice();
  badCrc[29] = badCrc[29]! ^ 0xff; // inside the IHDR CRC
  files.set('bad-crc.png', badCrc);
  files.set('empty.bin', new Uint8Array(0));
  expected.push(
    { file: 'form.rtf', kind: 'refused', note: 'RTF: recognised and refused.' },
    { file: 'form.doc', kind: 'refused', note: 'Legacy Word compound file: recognised and refused.' },
    { file: 'truncated.pdf', kind: 'pdf-without-fields', note: 'The first 40% of the mixed PDF; decoding must fail with a plain message.' },
    { file: 'broken.pdf', kind: 'pdf-without-fields', note: 'A PDF header with no PDF body; decoding must fail with a plain message.' },
    { file: 'truncated.jpg', kind: 'jpeg', note: 'The first 30% of clean-en.jpg.' },
    { file: 'truncated.png', kind: 'png', note: 'The first 30% of clean-en.png.' },
    { file: 'bad-crc.png', kind: 'png', note: 'clean-en.png with a broken IHDR checksum.' },
    { file: 'empty.bin', kind: 'unknown', note: 'An empty file.' },
  );

  expected.sort((a, b) => a.file.localeCompare(b.file));
  files.set('expected.json', text(asciiJson({ generatedBy: 'scripts/create-fixtures/documents.ts', oversize: `oversizeBytes(): ${SIZE_LIMIT_BYTES + 1} bytes, built in memory by the tests`, fixtures: expected })));
  return files;
}

function writeAll(files: Map<string, Uint8Array>, dir: string) {
  mkdirSync(dir, { recursive: true });
  for (const [name, bytes] of files) writeFileSync(path.join(dir, name), bytes);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = await buildDocumentFixtures();
  if (process.argv.includes('--check')) {
    const committed = existsSync(DOCUMENT_FIXTURES_DIR) ? readdirSync(DOCUMENT_FIXTURES_DIR) : [];
    const diffs: string[] = [];
    for (const [name, bytes] of files) {
      const file = path.join(DOCUMENT_FIXTURES_DIR, name);
      if (!existsSync(file) || sha256(readFileSync(file)) !== sha256(bytes)) diffs.push(name);
    }
    for (const name of committed) if (!files.has(name)) diffs.push(`${name} (not generated)`);
    if (diffs.length > 0) {
      console.error(`Differs from the generator output: ${diffs.join(', ')}`);
      process.exit(1);
    }
    console.log(`All ${files.size} document fixtures match the generator output.`);
  } else {
    writeAll(files, DOCUMENT_FIXTURES_DIR);
    console.log(`Wrote ${files.size} files to ${path.relative(ROOT, DOCUMENT_FIXTURES_DIR)}`);
  }
}
