/**
 * tests/unit/page-text.test.ts
 *
 * Review item 3: snippet privacy geometry. Text that touches a widget (even
 * only through its descender), text that is not axis-aligned and text with
 * uncertain bounds never enters a snippet.
 * Validates: Requirements 4.5, 11.1
 */

import { describe, it, expect } from 'vitest';
import {
  computeOptionLabels,
  computePageSnippets,
  rectDistance,
  textItemBox,
  WIDGET_MARGIN,
  type TextItem,
} from '../../src/lib/pdf-extract/page-text.js';
import type { PdfRect } from '../../src/lib/pdf-extract/pdf-objects.js';

/** Widget at bottom 700, top 726 (native PDF space). */
const WIDGET: PdfRect = { left: 36, bottom: 700, right: 300, top: 726 };

const item = (str: string, x: number, baseline: number, size = 10, width = 60): TextItem => ({
  str,
  transform: [size, 0, 0, size, x, baseline],
  width,
  height: size,
});

const LABEL = item('Full name', 36, 740);

describe('computePageSnippets privacy', () => {
  it('keeps a label clearly above the widget', () => {
    expect(computePageSnippets([LABEL], [WIDGET])[0]).toBe('Full name');
  });

  it('drops text whose baseline is above the widget but whose descender reaches into it', () => {
    // Baseline 1pt above the widget top: the glyph body is outside, the descent (3pt) is inside.
    const sentinel = item('DESCENDER_SENTINEL', 36, 727);
    expect(textItemBox(sentinel)!.bottom).toBeLessThan(WIDGET.top);
    expect(computePageSnippets([LABEL, sentinel], [WIDGET])[0]).toBe('Full name');
  });

  it('drops text within the 2pt margin around a widget', () => {
    const nearRight = item('MARGIN_SENTINEL', WIDGET.right + WIDGET_MARGIN - 0.5, 710);
    expect(computePageSnippets([LABEL, nearRight], [WIDGET])[0]).toBe('Full name');
  });

  it('drops rotated text even when its unrotated box would miss the widget', () => {
    const rotated: TextItem = { str: 'ROTATED_SENTINEL', transform: [0, 10, -10, 0, 320, 650], width: 60, height: 10 };
    expect(computePageSnippets([LABEL, rotated], [WIDGET])[0]).toBe('Full name');
  });

  it('drops mirrored text and text with missing or non-finite bounds', () => {
    const mirrored: TextItem = { ...item('MIRRORED', 400, 740), transform: [-10, 0, 0, 10, 400, 740] };
    const noHeight: TextItem = { ...item('NO_HEIGHT', 400, 760), height: 0 };
    const nanWidth: TextItem = { ...item('NAN_WIDTH', 400, 780), width: Number.NaN };
    const shortTransform: TextItem = { ...item('SHORT', 400, 800), transform: [10, 0, 0, 10] };
    const snippet = computePageSnippets([LABEL, mirrored, noHeight, nanWidth, shortTransform], [WIDGET])[0];
    expect(snippet).toBe('Full name');
  });

  it('text inside one widget is excluded from the snippets of every widget on the page', () => {
    const other: PdfRect = { left: 36, bottom: 600, right: 300, top: 626 };
    const insideOther = item('OTHER_VALUE', 40, 608);
    const snippets = computePageSnippets([LABEL, insideOther], [WIDGET, other]);
    expect(snippets.join(' ')).not.toContain('OTHER_VALUE');
  });
});

describe('snippet ranking', () => {
  it('ranks a wide field’s own left-aligned label ahead of a label from another row', () => {
    const wide: PdfRect = { left: 36, bottom: 466, right: 559, top: 488 };
    const own = item('E-mel', 36, 494, 10, 26);
    const otherRow = item('Telefon rumah', 310, 548, 10, 60);
    const [snippet] = computePageSnippets([otherRow, own], [wide]);
    expect(snippet!.startsWith('E-mel')).toBe(true);
  });

  it('rectDistance is 0 for overlapping rectangles and the gap otherwise', () => {
    expect(rectDistance(WIDGET, WIDGET)).toBe(0);
    expect(rectDistance({ left: 0, bottom: 0, right: 10, top: 10 }, { left: 13, bottom: 14, right: 20, top: 20 })).toBe(5);
  });
});

describe('computeOptionLabels (radio buttons show their printed label)', () => {
  const button = (left: number): PdfRect => ({ left, bottom: 700, right: left + 14, top: 714 });
  const F = button(220);
  const M = button(320);

  it('takes the nearest text directly to the right of each small button, on the same line', () => {
    const items = [item('Jantina', 36, 720), item('Perempuan', 238, 703, 10, 50), item('Lelaki', 338, 703, 10, 30)];
    expect(computeOptionLabels(items, [F, M])).toEqual(['Perempuan', 'Lelaki']);
  });

  it('gives no label when nothing is printed beside the button, or when it is too far away', () => {
    const far = item('Far away', 220 + 14 + 41, 703);
    expect(computeOptionLabels([far], [F])).toEqual([undefined]);
    expect(computeOptionLabels([item('Above', 220, 720)], [F])).toEqual([undefined]);
  });

  it('never labels wide widgets', () => {
    expect(computeOptionLabels([item('Beside', 305, 710)], [WIDGET])).toEqual([undefined]);
  });

  it('uses the same privacy filter as snippets: text touching any widget is never a label', () => {
    // A value drawn inside a neighbouring text field that starts right of the button.
    const valueField: PdfRect = { left: 236, bottom: 698, right: 400, top: 716 };
    const value = item('PRIVATE_VALUE', 238, 703);
    expect(computeOptionLabels([value], [F], [valueField])).toEqual([undefined]);
  });
});
