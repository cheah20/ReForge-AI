/**
 * tests/unit/document-model.test.ts
 *
 * Tier A pure logic of group 5 (formbridge-any-document tasks 5.1, 5.5, 5.9,
 * 5.10): orientation maths, reading order, OCR result mapping and the
 * Document_Model builder, with the mock OCR result of the real fixtures.
 * Validates: Requirements 3.4, 4.1, 4.2, 4.3, 4.6, 7.1, 7.2, 7.3, 9.4, 9.5, 10.3
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { groupIntoLines } from '../../src/lib/document/reading-order.js';
import { mapBoxToUpright, nextRotation, rotatedSize, uprightTransform, workingImageSize } from '../../src/lib/document/orientation.js';
import { isLowQuality, mapTesseractBlocks } from '../../src/lib/document/ocr-map.js';
import { appendPage, buildCandidates, buildPage, checkModel, createModel, labelIdOf, ocrLanguageTag, replacePage } from '../../src/lib/document/model.js';
import type { LabelClass, Page, Rotation } from '../../src/lib/document/types.js';

const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });

describe('orientation maths (5.1)', () => {
  it('applies the EXIF transform exactly once: not at all when the decoder already did', () => {
    for (let exif = 1; exif <= 8; exif++) expect(uprightTransform(exif, true)).toEqual({ mirror: false, rotation: 0 });
    expect(uprightTransform(6, false)).toEqual({ mirror: false, rotation: 90 });
    expect(uprightTransform(8, false)).toEqual({ mirror: false, rotation: 270 });
    expect(uprightTransform(3, false)).toEqual({ mirror: false, rotation: 180 });
    expect(uprightTransform(2, false)).toEqual({ mirror: true, rotation: 0 });
    expect(uprightTransform(1, false)).toEqual({ mirror: false, rotation: 0 });
    expect(uprightTransform(9, false)).toEqual({ mirror: false, rotation: 0 });
  });

  it('four presses of the rotate control return to the start, and 90 and 270 swap the size', () => {
    let r: Rotation = 0;
    const seen: Rotation[] = [];
    for (let i = 0; i < 4; i++) {
      r = nextRotation(r);
      seen.push(r);
    }
    expect(seen).toEqual([90, 180, 270, 0]);
    expect(rotatedSize(1556, 2200, 90)).toEqual({ width: 2200, height: 1556 });
    expect(rotatedSize(1556, 2200, 180)).toEqual({ width: 1556, height: 2200 });
  });

  it('maps a box into the turned picture, and four quarter turns give the box back', () => {
    // A 100 x 50 picture, a box in its top-left corner.
    expect(mapBoxToUpright(box(0, 0, 20, 10), 100, 50, 90)).toEqual(box(40, 0, 50, 20));
    expect(mapBoxToUpright(box(0, 0, 20, 10), 100, 50, 180)).toEqual(box(80, 40, 100, 50));
    expect(mapBoxToUpright(box(0, 0, 20, 10), 100, 50, 270)).toEqual(box(0, 80, 10, 100));
    let b = box(5, 7, 30, 19);
    let w = 100;
    let h = 50;
    for (let i = 0; i < 4; i++) {
      b = mapBoxToUpright(b, w, h, 90);
      [w, h] = [h, w];
    }
    expect(b).toEqual(box(5, 7, 30, 19));
  });

  it('scales to a long edge of 2,200 px up or down, keeping the aspect ratio within 1 px', () => {
    for (const [w, h] of [[4000, 3000], [1000, 600], [3024, 4032], [2200, 100]] as const) {
      const s = workingImageSize(w, h, 2200);
      expect(Math.max(s.width, s.height)).toBe(2200);
      expect(Math.abs(s.width / s.height - w / h) * Math.min(s.width, s.height)).toBeLessThan(1);
    }
  });
});

describe('line grouping and reading order (5.5)', () => {
  it('puts a two-column row left to right and rows top to bottom', () => {
    const f = [
      { id: 'c', box: box(300, 100, 400, 130) },
      { id: 'd', box: box(10, 160, 100, 190) },
      { id: 'a', box: box(10, 102, 100, 132) },
      { id: 'b', box: box(150, 98, 250, 128) },
    ];
    expect(groupIntoLines(f).map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps a skewed line together when its pieces drift by less than half a line', () => {
    const f = [
      { id: 'right', box: box(400, 112, 500, 142) },
      { id: 'left', box: box(10, 100, 100, 130) },
      { id: 'mid', box: box(200, 106, 300, 136) },
    ];
    expect(groupIntoLines(f).map((x) => x.id)).toEqual(['left', 'mid', 'right']);
  });

  it('is stable for equal boxes and does not change its input', () => {
    const f = [{ id: 1, box: box(0, 0, 10, 10) }, { id: 2, box: box(0, 0, 10, 10) }];
    const copy = JSON.stringify(f);
    expect(groupIntoLines(f).map((x) => x.id)).toEqual([1, 2]);
    expect(JSON.stringify(f)).toBe(copy);
  });
});

describe('OCR result mapping (5.9)', () => {
  const blocks = [
    {
      paragraphs: [
        {
          lines: [
            { text: ' Full  name: ', confidence: 91.5, bbox: { x0: 10, y0: 20, x1: 200, y1: 50 }, words: [
              { text: 'Full', confidence: 95, bbox: { x0: 10, y0: 20, x1: 80, y1: 50 } },
              { text: 'name:', confidence: 88, bbox: { x0: 90, y0: 20, x1: 200, y1: 50 } },
            ] },
            { text: '   ', confidence: 99, bbox: { x0: 0, y0: 0, x1: 1, y1: 1 }, words: [] },
            { text: 'Phone:', confidence: 40, bbox: { x0: 10, y0: 80, x1: 120, y1: 110 }, words: [{ text: 'Phone:', confidence: 40, bbox: { x0: 10, y0: 80, x1: 120, y1: 110 } }] },
            { text: 'no box', confidence: 90 },
          ],
        },
      ],
    },
  ];

  it('divides confidence by 100, collapses spaces, drops empty and malformed lines and keeps word boxes', () => {
    const r = mapTesseractBlocks(blocks);
    expect(r.lines.map((l) => l.text)).toEqual(['Full name:', 'Phone:']);
    expect(r.lines[0]!.confidence).toBeCloseTo(0.915);
    expect(r.lines[0]!.box).toEqual(box(10, 20, 200, 50));
    expect(r.lines[0]!.words.map((w) => w.text)).toEqual(['Full', 'name:']);
    expect(r.wordCount).toBe(3);
    expect(r.meanLineConfidence).toBeCloseTo((0.915 + 0.4) / 2);
  });

  it('an empty page, a missing structure and garbage give mean confidence 0 and no lines, without throwing', () => {
    for (const input of [[], null, undefined, 'x', 42, [{}], [{ paragraphs: 'x' }]]) {
      const r = mapTesseractBlocks(input);
      expect(r).toEqual({ lines: [], wordCount: 0, meanLineConfidence: 0 });
      expect(isLowQuality(r)).toBe(true);
    }
  });

  it('is low quality under 10 words or under 0.60 mean confidence, and not otherwise', () => {
    const ok = { lines: [], wordCount: 10, meanLineConfidence: 0.6 };
    expect(isLowQuality(ok)).toBe(false);
    expect(isLowQuality({ ...ok, wordCount: 9 })).toBe(true);
    expect(isLowQuality({ ...ok, meanLineConfidence: 0.599 })).toBe(true);
  });
});

describe('Document_Model builder (5.10)', () => {
  const expected = JSON.parse(readFileSync('fixtures/documents/expected.json', 'utf8')) as {
    fixtures: Array<{ file: string; pages?: Array<{ mock?: { width: number; height: number; lines: Array<{ text: string; box: ReturnType<typeof box>; confidence: number }> } }> }>;
  };
  const mock = expected.fixtures.find((f) => f.file === 'clean-en.png')!.pages![0]!.mock!;
  const input = (n: number) => ({ pageNumber: n, width: mock.width, height: mock.height, rotation: 0 as Rotation, textSource: 'ocr' as const, lines: [...mock.lines].reverse() });
  const everything = (): ReadonlyMap<number, LabelClass> => new Map();
  const asLabels = (page: Page) => new Map<number, LabelClass>(page.lines.map((l) => [l.index, 'ambiguous'] as const));

  it('sorts the shuffled lines into reading order, numbers them from 0 and keeps every printed line', () => {
    const page = buildPage(input(1));
    expect(page.lines.map((l) => l.text)).toEqual(mock.lines.map((l) => l.text));
    expect(page.lines.map((l) => l.index)).toEqual(page.lines.map((_, i) => i));
    expect(page.lines[0]!.text).toBe('Community Clinic Registration (sample form)');
  });

  it('clamps a box that leaves the page and drops a line with no text', () => {
    const page = buildPage({ pageNumber: 1, width: 100, height: 100, rotation: 0, textSource: 'ocr', lines: [
      { text: 'Name:', box: box(-5, 10, 150, 30), confidence: 0.9 },
      { text: '   ', box: box(0, 40, 10, 50) },
    ] });
    expect(page.lines).toHaveLength(1);
    expect(page.lines[0]!.box).toEqual(box(0, 10, 100, 30));
  });

  it('only OCR pages keep a line confidence', () => {
    const lines = [{ text: 'Name:', box: box(0, 0, 50, 10), confidence: 0.9 }];
    expect(buildPage({ pageNumber: 1, width: 100, height: 100, rotation: 0, textSource: 'ocr', lines }).lines[0]!.confidence).toBe(0.9);
    expect(buildPage({ pageNumber: 1, width: 100, height: 100, rotation: 0, textSource: 'text-layer', lines }).lines[0]!.confidence).toBeUndefined();
  });

  it('builds one candidate per classified line with stable ids, in order, none for a line the classifier does not mention', () => {
    const page = buildPage(input(1));
    const some = (p: Page) => new Map<number, LabelClass>([[0, 'ambiguous'], [2, 'likely-label'], [3, 'value-like']]);
    const c = buildCandidates([page], null, 'eng', some);
    expect(c.map((x) => x.labelId)).toEqual(['p1-l0', 'p1-l2']);
    expect(c[1]!.labelClass).toBe('likely-label');
    expect(buildCandidates([page], null, 'eng', everything)).toEqual([]);
    expect(buildCandidates([page], null, 'eng', asLabels).map((x) => x.labelId)).toEqual(page.lines.map((l) => labelIdOf(1, l.index)));
    // Same input, same ids.
    expect(buildCandidates([buildPage(input(1))], null, 'eng', asLabels)).toEqual(buildCandidates([page], null, 'eng', asLabels));
  });

  it('sets the language tag by text source and marks low confidence and low-quality pages (9.5, 10.3)', () => {
    const lines = [{ text: 'Nama:', box: box(0, 0, 50, 10), confidence: 0.9 }, { text: 'Poskod:', box: box(0, 20, 50, 30), confidence: 0.4 }];
    const ocr = buildPage({ pageNumber: 1, width: 100, height: 100, rotation: 0, textSource: 'ocr', lines });
    const c = buildCandidates([ocr], null, 'msa', asLabels);
    expect(c.map((x) => [x.textLang, x.checkYourself])).toEqual([['ms', false], ['ms', true]]);
    const poor = buildPage({ pageNumber: 1, width: 100, height: 100, rotation: 0, textSource: 'ocr', lines, status: 'low-quality' });
    expect(buildCandidates([poor], null, 'eng', asLabels).every((x) => x.checkYourself && x.textLang === 'en')).toBe(true);
    const text = buildPage({ pageNumber: 1, width: 100, height: 100, rotation: 0, textSource: 'text-layer', lines });
    expect(buildCandidates([text], null, 'eng', asLabels).map((x) => [x.textLang, x.checkYourself])).toEqual([['und', false], ['und', false]]);
    expect(buildCandidates([text], 'ms', 'eng', asLabels)[0]!.textLang).toBe('ms');
    expect(ocrLanguageTag('eng')).toBe('en');
  });

  it('a page whose classifier failed contributes no candidate (11.6)', () => {
    const page = buildPage({ ...input(1), status: 'classifier-failed' });
    expect(buildCandidates([page], null, 'eng', asLabels)).toEqual([]);
  });

  it('replacing a page discards only that page\'s candidates; appending numbers the page count + 1 and refuses at 5 pages', () => {
    const p1 = buildPage(input(1));
    let model = createModel('png', [p1], buildCandidates([p1], null, 'eng', asLabels));
    expect(checkModel(model)).toEqual([]);
    const replaced = replacePage(model, buildPage(input(1)));
    expect(replaced.candidates).toEqual([]);
    expect(replaced.pages).toHaveLength(1);
    for (let n = 2; n <= 5; n++) {
      const next = appendPage(model, buildPage(input(n)));
      expect('error' in next).toBe(false);
      model = next as typeof model;
    }
    expect(model.pages.map((p) => p.pageNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(appendPage(model, buildPage(input(6)))).toEqual({ error: 'page-limit' });
    expect(appendPage(createModel('png', [p1], []), buildPage(input(3)))).toEqual({ error: 'wrong-number' });
  });

  it('checkModel reports a gap in page numbers, a duplicate line index, a box outside the page and a wrong or repeated label id', () => {
    const good = buildPage(input(1));
    const gap = createModel('png', [{ ...good, pageNumber: 2 }], []);
    expect(checkModel(gap).map((i) => i.code)).toContain('page-number');
    const dup = createModel('png', [{ ...good, lines: [good.lines[0]!, { ...good.lines[1]!, index: 0 }] }], []);
    expect(checkModel(dup).map((i) => i.code)).toContain('line-index');
    const out = createModel('png', [{ ...good, lines: [{ ...good.lines[0]!, box: box(0, 0, good.width + 1, 5) }] }], []);
    expect(checkModel(out).map((i) => i.code)).toContain('box-outside');
    const c = buildCandidates([good], null, 'eng', asLabels);
    const badId = createModel('png', [good], [{ ...c[0]!, labelId: 'p1-l9' }]);
    expect(checkModel(badId).map((i) => i.code)).toContain('label-id');
    const twice = createModel('png', [good], [c[0]!, c[0]!]);
    expect(checkModel(twice).map((i) => i.code)).toEqual(expect.arrayContaining(['label-id', 'candidate-order']));
  });
});
