/**
 * tests/unit/document-pipeline.test.ts
 *
 * The photo pipeline (formbridge-any-document task 9.2) with fake decoding
 * and the mock OCR results of the real fixtures: the Working_Image is always
 * released, a page over the pixel limit is skipped, a poor reading marks the
 * page low-quality, and the slow-page notice fires without stopping anything.
 * Validates: Requirements 3.3, 3.5, 3.8, 9.4
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { modelFromPhoto, readPhotoPage, type PipelineDeps } from '../../src/frontend/document/pipeline.js';
import type { CanvasLike, DecodeOutcome } from '../../src/frontend/document/decode.js';
import { OcrError } from '../../src/frontend/document/ocr.js';
import { mapTesseractBlocks, type OcrPageResult } from '../../src/lib/document/ocr-map.js';
import { checkModel } from '../../src/lib/document/model.js';

interface MockFixture {
  width: number;
  height: number;
  lines: Array<{ text: string; box: { left: number; top: number; right: number; bottom: number }; confidence: number }>;
}
const expected = JSON.parse(readFileSync('fixtures/documents/expected.json', 'utf8')) as { fixtures: Array<{ file: string; pages?: Array<{ mock?: MockFixture }> }> };
const mockOf = (file: string) => expected.fixtures.find((f) => f.file === file)!.pages![0]!.mock!;

/** The OCR result a perfect reader would return for a fixture, in the shape the OCR service returns. */
function resultOf(m: MockFixture): OcrPageResult {
  const lines = m.lines.map((l) => ({ ...l, words: l.text.split(' ').map((w) => ({ text: w, box: l.box, confidence: l.confidence })) }));
  return { lines, wordCount: lines.reduce((n, l) => n + l.words.length, 0), meanLineConfidence: lines.reduce((s, l) => s + l.confidence, 0) / Math.max(1, lines.length) };
}

function canvas(width: number, height: number): CanvasLike {
  return { width, height, getContext: () => null, toBlob: () => {} };
}

function setup(m: MockFixture, over: { skip?: boolean; ocr?: () => Promise<OcrPageResult> } = {}) {
  const state = { canvas: canvas(m.width, m.height), decoded: 0, recognised: 0, cleared: [] as unknown[], timers: [] as Array<{ fn: () => void; ms: number }> };
  const deps: PipelineDeps = {
    async decode(): Promise<DecodeOutcome> {
      state.decoded++;
      if (over.skip) return { kind: 'skipped-too-large', pixels: 22_500_000, width: 5000, height: 4500 };
      return { kind: 'ok', photo: { canvas: state.canvas, width: m.width, height: m.height, preview: { url: 'blob:p', scale: 0.5 }, exifOrientation: 1 } };
    },
    ocr: {
      recognize: over.ocr ?? (async () => (state.recognised++, resultOf(m))),
    },
    setTimeout: (fn, ms) => (state.timers.push({ fn, ms }), state.timers.length),
    clearTimeout: (h) => void state.cleared.push(h),
  };
  const opts = { file: new Blob(['x']), pageNumber: 1, rotation: 0 as const, ocrLanguage: 'eng' as const, signal: new AbortController().signal };
  return { deps, state, opts };
}

describe('readPhotoPage (9.2)', () => {
  it('reads the clean fixture into a ready page with its lines, preview and EXIF value, and releases the Working_Image', async () => {
    const m = mockOf('clean-en.png');
    const { deps, state, opts } = setup(m);
    const page = await readPhotoPage(deps, opts);
    expect(page.status).toBe('ready');
    expect(page.textSource).toBe('ocr');
    expect(page.lines.map((l) => l.text)).toEqual(m.lines.map((l) => l.text));
    expect(page.preview).toEqual({ url: 'blob:p', scale: 0.5 });
    expect(page.exifOrientation).toBe(1);
    expect(state.canvas.width).toBe(0);
    expect(state.canvas.height).toBe(0);
  });

  it('releases the Working_Image even when recognition fails, and passes the failure on', async () => {
    const m = mockOf('clean-en.png');
    const { deps, state, opts } = setup(m, { ocr: async () => Promise.reject(new OcrError('cancelled')) });
    await expect(readPhotoPage(deps, opts)).rejects.toMatchObject({ code: 'cancelled' });
    expect(state.canvas.width).toBe(0);
  });

  it('a page over the pixel limit is skipped with no recognition and keeps its page number and size', async () => {
    const { deps, state, opts } = setup(mockOf('clean-en.png'), { skip: true });
    const page = await readPhotoPage(deps, { ...opts, pageNumber: 2 });
    expect(page).toMatchObject({ pageNumber: 2, status: 'skipped-too-large', lines: [], width: 5000, height: 4500 });
    expect(state.recognised).toBe(0);
  });

  it('a poor reading of the glary photo marks the page low-quality; the clean reading does not', async () => {
    const glary = mockOf('glary.jpg');
    const poor = await readPhotoPage(setup(glary).deps, setup(glary).opts);
    expect(poor.status).toBe('low-quality');
    const clean = await readPhotoPage(setup(mockOf('clean-en.jpg')).deps, setup(mockOf('clean-en.jpg')).opts);
    expect(clean.status).toBe('ready');
  });

  it('an empty page (no words) is low-quality', async () => {
    const m = mockOf('clean-en.png');
    const { deps, opts } = setup(m, { ocr: async () => mapTesseractBlocks([]) });
    const page = await readPhotoPage(deps, opts);
    expect(page).toMatchObject({ status: 'low-quality', lines: [] });
  });

  it('starts a 60-second slow-page timer, clears it when the page is done, and the notice does not stop the reading', async () => {
    const m = mockOf('clean-en.png');
    const onSlow = vi.fn();
    let release: (r: OcrPageResult) => void = () => {};
    const { deps, state, opts } = setup(m, { ocr: () => new Promise<OcrPageResult>((r) => (release = r)) });
    const running = readPhotoPage(deps, { ...opts, onSlow });
    await new Promise((r) => setTimeout(r, 5));
    expect(state.timers.map((t) => t.ms)).toEqual([60_000]);
    state.timers[0]!.fn(); // 60 seconds pass
    expect(onSlow).toHaveBeenCalledTimes(1);
    release(resultOf(m));
    const page = await running;
    expect(page.status).toBe('ready');
    expect(state.cleared).toEqual([1]);
  });

  it('starts no timer when nobody listens for the notice', async () => {
    const { deps, state, opts } = setup(mockOf('clean-en.png'));
    await readPhotoPage(deps, opts);
    expect(state.timers).toEqual([]);
  });
});

describe('modelFromPhoto', () => {
  it('builds a valid one-page model whose candidates are all unselected-class and carry no value', async () => {
    const m = mockOf('prefilled-sensitive.png');
    const { deps, opts } = setup(m);
    const page = await readPhotoPage(deps, opts);
    const model = modelFromPhoto('png', page, 'eng', null);
    expect(checkModel(model)).toEqual([]);
    expect(model.candidates.length).toBeGreaterThan(5);
    expect(model.candidates.every((c) => c.labelClass === 'ambiguous')).toBe(true);
    const offered = model.candidates.map((c) => c.text).join('\n');
    for (const secret of ['900101-14-5678', '012-555 0142', 'canary.zqx@example.invalid', 'ZQXCOLON']) expect(offered).not.toContain(secret);
  });
});
