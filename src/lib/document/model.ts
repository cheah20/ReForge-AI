/**
 * src/lib/document/model.ts
 *
 * Document_Model builder and invariants (formbridge-any-document Requirement
 * 4, design Q3). Pure. One model per Input_File: pages in document order from
 * 1 with no gaps, text lines in reading order with unique indexes and boxes
 * inside the page, Label_Ids derived from page number and line index only.
 */

import { MAX_DOCUMENT_PAGES, OCR_LOW_LINE_CONFIDENCE, type OcrLanguage } from './limits.js';
import { groupIntoLines } from './reading-order.js';
import type { Box, DocumentModel, DocumentSourceKind, LabelCandidate, LabelClass, Page, PageStatus, PageTextSource, Rotation, TextLine } from './types.js';

export interface PageInput {
  pageNumber: number;
  width: number;
  height: number;
  rotation: Rotation;
  textSource: PageTextSource;
  lines: ReadonlyArray<{ text: string; box: Box; confidence?: number }>;
  status?: PageStatus;
  preview?: Page['preview'];
  exifOrientation?: number;
}

export function labelIdOf(pageNumber: number, lineIndex: number): string {
  return `p${pageNumber}-l${lineIndex}`;
}

/** The BCP 47 tag of an OCR_Language, for the `lang` attribute (Requirement 10.3). */
export function ocrLanguageTag(lang: OcrLanguage): string {
  return lang === 'msa' ? 'ms' : 'en';
}

function clampBox(box: Box, width: number, height: number): Box {
  const x = (v: number) => Math.min(width, Math.max(0, v));
  const y = (v: number) => Math.min(height, Math.max(0, v));
  const left = x(Math.min(box.left, box.right));
  const right = x(Math.max(box.left, box.right));
  const top = y(Math.min(box.top, box.bottom));
  const bottom = y(Math.max(box.top, box.bottom));
  return { left, top, right, bottom };
}

/** Sorts the lines in reading order, drops empty ones, clamps boxes into the page and numbers them from 0. */
export function buildPage(input: PageInput): Page {
  const clean = input.lines
    .map((l) => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim(), box: clampBox(l.box, input.width, input.height) }))
    .filter((l) => l.text.length > 0);
  const lines: TextLine[] = groupIntoLines(clean).map((l, index) => ({
    index,
    text: l.text,
    box: l.box,
    ...(l.confidence !== undefined && input.textSource === 'ocr' ? { confidence: l.confidence } : {}),
  }));
  return {
    pageNumber: input.pageNumber,
    width: input.width,
    height: input.height,
    rotation: input.rotation,
    textSource: input.textSource,
    lines,
    answerAreas: [],
    status: input.status ?? 'ready',
    preview: input.preview ?? null,
    ...(input.exifOrientation !== undefined ? { exifOrientation: input.exifOrientation } : {}),
  };
}

/**
 * One Label_Candidate per Text_Line that the classifier does not call
 * `value-like`, in page and reading order. `classify` gives the class of each
 * line of a page by line index; a line it does not mention counts as
 * `value-like`, so nothing unclassified can be offered (fail closed).
 * A page with status `classifier-failed` contributes no candidate (11.6).
 */
export function buildCandidates(
  pages: readonly Page[],
  formLanguage: string | null,
  ocrLanguage: OcrLanguage,
  classify: (page: Page) => ReadonlyMap<number, LabelClass>,
): LabelCandidate[] {
  const out: LabelCandidate[] = [];
  for (const page of [...pages].sort((a, b) => a.pageNumber - b.pageNumber)) {
    if (page.status === 'classifier-failed' || page.status === 'failed' || page.status === 'skipped-too-large') continue;
    const classes = classify(page);
    for (const line of page.lines) {
      const cls = classes.get(line.index) ?? 'value-like';
      if (cls === 'value-like') continue;
      out.push({
        labelId: labelIdOf(page.pageNumber, line.index),
        pageNumber: page.pageNumber,
        lineIndex: line.index,
        text: line.text,
        labelClass: cls,
        textLang: page.textSource === 'ocr' ? ocrLanguageTag(ocrLanguage) : (formLanguage ?? 'und'),
        checkYourself: page.textSource === 'ocr' && (page.status === 'low-quality' || (line.confidence ?? 1) < OCR_LOW_LINE_CONFIDENCE),
      });
    }
  }
  return out;
}

export function createModel(sourceKind: DocumentSourceKind, pages: Page[], candidates: LabelCandidate[]): DocumentModel {
  return { sourceKind, pages: [...pages].sort((a, b) => a.pageNumber - b.pageNumber), candidates };
}

/** Rotate or retake: the page is replaced; its OCR result and candidates are discarded, other pages stay (7.3). */
export function replacePage(model: DocumentModel, page: Page): DocumentModel {
  return {
    ...model,
    pages: model.pages.map((p) => (p.pageNumber === page.pageNumber ? page : p)),
    candidates: model.candidates.filter((c) => c.pageNumber !== page.pageNumber),
  };
}

/** "Add another page": the new page is number count + 1; refused at the page limit; existing pages unchanged (7.5, 7.6). */
export function appendPage(model: DocumentModel, page: Page): DocumentModel | { error: 'page-limit' | 'wrong-number' } {
  if (model.pages.length >= MAX_DOCUMENT_PAGES) return { error: 'page-limit' };
  if (page.pageNumber !== model.pages.length + 1) return { error: 'wrong-number' };
  return { ...model, pages: [...model.pages, page] };
}

export interface ModelIssue {
  code: 'page-number' | 'line-index' | 'box-outside' | 'label-id' | 'candidate-order' | 'candidate-line';
  pageNumber?: number;
}

/** The invariants of Requirement 4. Issues name no document text. */
export function checkModel(model: DocumentModel): ModelIssue[] {
  const issues: ModelIssue[] = [];
  model.pages.forEach((p, i) => {
    if (p.pageNumber !== i + 1) issues.push({ code: 'page-number', pageNumber: p.pageNumber });
    const seen = new Set<number>();
    for (const l of p.lines) {
      if (!Number.isInteger(l.index) || l.index < 0 || seen.has(l.index)) issues.push({ code: 'line-index', pageNumber: p.pageNumber });
      seen.add(l.index);
      const b = l.box;
      if (b.left < 0 || b.top < 0 || b.right > p.width || b.bottom > p.height || b.left > b.right || b.top > b.bottom) {
        issues.push({ code: 'box-outside', pageNumber: p.pageNumber });
      }
    }
  });
  const ids = new Set<string>();
  let last = -1;
  for (const c of model.candidates) {
    if (c.labelId !== labelIdOf(c.pageNumber, c.lineIndex) || ids.has(c.labelId)) issues.push({ code: 'label-id', pageNumber: c.pageNumber });
    ids.add(c.labelId);
    const key = c.pageNumber * 100_000 + c.lineIndex;
    if (key <= last) issues.push({ code: 'candidate-order', pageNumber: c.pageNumber });
    last = key;
    const page = model.pages.find((p) => p.pageNumber === c.pageNumber);
    if (!page || !page.lines.some((l) => l.index === c.lineIndex)) issues.push({ code: 'candidate-line', pageNumber: c.pageNumber });
  }
  return issues;
}
