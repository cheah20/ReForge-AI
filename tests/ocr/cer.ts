/**
 * tests/ocr/cer.ts
 *
 * Character error rate and the OCR_Validation_Bar (formbridge-any-document
 * Requirement 9.1, design spike plan step 4).
 *
 * CER = Levenshtein distance / length of the expected text, both after NFKC
 * and whitespace collapsing, counted in Unicode code points. The bar is passed
 * when at least 90% of the expected labels each match one recognised line at a
 * CER of 10% or less. No rounding: 89.9% fails.
 */

export const BAR_LABEL_SHARE = 0.9;
export const BAR_MAX_CER = 0.1;

export function normalizeForCer(s: string): string {
  return s.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

export function levenshtein(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  if (x.length === 0) return y.length;
  if (y.length === 0) return x.length;
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length]!;
}

/** CER of `actual` against `expected`. An empty expected text has CER 0 only when the actual text is empty too. */
export function cer(expected: string, actual: string): number {
  const e = normalizeForCer(expected);
  const a = normalizeForCer(actual);
  const n = [...e].length;
  if (n === 0) return a.length === 0 ? 0 : 1;
  return levenshtein(e, a) / n;
}

export interface LabelResult {
  label: string;
  /** The recognised line closest to the label, or null when nothing was recognised. */
  bestLine: string | null;
  cer: number;
  passed: boolean;
}

export interface BarResult {
  labels: LabelResult[];
  passedCount: number;
  share: number;
  passed: boolean;
}

/**
 * Each expected label is compared with every recognised line; a label may also
 * match the start of a longer line (a label followed by its fill-in leader).
 */
export function validationBar(expectedLabels: readonly string[], recognisedLines: readonly string[]): BarResult {
  const labels = expectedLabels.map((label) => {
    let best: { line: string | null; cer: number } = { line: null, cer: 1 };
    for (const line of recognisedLines) {
      const whole = cer(label, line);
      const prefix = cer(label, [...normalizeForCer(line)].slice(0, [...normalizeForCer(label)].length).join(''));
      const score = Math.min(whole, prefix);
      if (score < best.cer) best = { line, cer: score };
    }
    return { label, bestLine: best.line, cer: best.cer, passed: best.cer <= BAR_MAX_CER };
  });
  const passedCount = labels.filter((l) => l.passed).length;
  const share = expectedLabels.length === 0 ? 0 : passedCount / expectedLabels.length;
  return { labels, passedCount, share, passed: expectedLabels.length > 0 && share >= BAR_LABEL_SHARE };
}
