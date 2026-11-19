/**
 * src/lib/document/ocr-map.ts
 *
 * Maps the `blocks` output of Tesseract.js (confidence 0..100, boxes as
 * x0/y0/x1/y1) to the Document_Path's own shape (confidence 0..1, boxes as
 * left/top/right/bottom), and decides whether a page was read badly
 * (formbridge-any-document Requirements 9.4 and 9.5, design Q4).
 *
 * Total: the input is an unvalidated value from another library, so every
 * entry that does not have the expected shape is dropped; the function never
 * throws. Empty lines are dropped, word boxes are kept for leader and colon
 * placement.
 */

import { OCR_MIN_MEAN_CONFIDENCE, OCR_MIN_WORDS } from './limits.js';
import type { Box } from './types.js';

export interface OcrWord {
  text: string;
  box: Box;
  /** 0..1 */
  confidence: number;
}

export interface OcrLine {
  text: string;
  box: Box;
  /** 0..1 */
  confidence: number;
  words: OcrWord[];
}

export interface OcrPageResult {
  lines: OcrLine[];
  wordCount: number;
  meanLineConfidence: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const arrayOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function boxOf(v: unknown): Box | null {
  if (!isRecord(v) || !finite(v['x0']) || !finite(v['y0']) || !finite(v['x1']) || !finite(v['y1'])) return null;
  return { left: Math.min(v['x0'], v['x1']), top: Math.min(v['y0'], v['y1']), right: Math.max(v['x0'], v['x1']), bottom: Math.max(v['y0'], v['y1']) };
}

function wordOf(v: unknown): OcrWord | null {
  if (!isRecord(v) || typeof v['text'] !== 'string') return null;
  const text = v['text'].trim();
  const box = boxOf(v['bbox']);
  if (text.length === 0 || !box) return null;
  return { text, box, confidence: clamp01((finite(v['confidence']) ? v['confidence'] : 0) / 100) };
}

export function mapTesseractBlocks(blocks: unknown): OcrPageResult {
  const lines: OcrLine[] = [];
  for (const block of arrayOf(blocks)) {
    if (!isRecord(block)) continue;
    for (const paragraph of arrayOf(block['paragraphs'])) {
      if (!isRecord(paragraph)) continue;
      for (const line of arrayOf(paragraph['lines'])) {
        if (!isRecord(line) || typeof line['text'] !== 'string') continue;
        const text = line['text'].replace(/\s+/g, ' ').trim();
        const box = boxOf(line['bbox']);
        if (text.length === 0 || !box) continue;
        const words = arrayOf(line['words']).map(wordOf).filter((w): w is OcrWord => w !== null);
        lines.push({ text, box, confidence: clamp01((finite(line['confidence']) ? line['confidence'] : 0) / 100), words });
      }
    }
  }
  const wordCount = lines.reduce((n, l) => n + (l.words.length > 0 ? l.words.length : l.text.split(' ').length), 0);
  const meanLineConfidence = lines.length === 0 ? 0 : lines.reduce((s, l) => s + l.confidence, 0) / lines.length;
  return { lines, wordCount, meanLineConfidence };
}

/** Requirement 9.4: too few words, or a mean line confidence under the threshold. */
export function isLowQuality(r: OcrPageResult): boolean {
  return r.wordCount < OCR_MIN_WORDS || r.meanLineConfidence < OCR_MIN_MEAN_CONFIDENCE;
}
