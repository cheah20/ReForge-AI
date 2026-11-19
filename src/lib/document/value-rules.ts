/**
 * src/lib/document/value-rules.ts
 *
 * The value rules V1 to V9 (formbridge-any-document Requirement 11.2, design
 * Q1) and the label colon split. Text that matches a value rule is never
 * offered as a label: names of numbers, emails, dates, text after a colon and
 * text inside an answer area stay on the device. The merged-fragment rule V10
 * is added with the Numeric_Fragment finder.
 *
 * The ID, phone, email and date patterns come from the country packs
 * (`MY_IC_SEARCH`, `US_SSN_SEARCH`, `EMAIL_SEARCH`), so no validation pattern
 * is defined here (Requirement 16.5).
 */

import { EMAIL_SEARCH } from '../../packs/country/universal.js';
import { MY_IC_SEARCH } from '../../packs/country/my.js';
import { US_SSN_SEARCH } from '../../packs/country/us.js';
import { digitView, matchText } from './digit-view.js';
import type { AnswerArea, Box, LabelClass, Page } from './types.js';
import { nextLineValues } from './next-line-values.js';

export type ValueRuleId = 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6' | 'V7' | 'V8' | 'V9';

const PHONE_SUPERSET = /\+?\d[\d\s().-]{5,}\d/g;
const DATE_SLASH = /(?<!\d)\d{1,2}\s?[/.-]\s?\d{1,2}\s?[/.-]\s?\d{2,4}(?!\d)/;
const DATE_ISO = /(?<!\d)\d{4}-\d{1,2}-\d{1,2}(?!\d)/;
const DIGITS = /\d/g;

/** Rules that look at the text alone: V1 to V6 and V9. */
export function textRuleHits(text: string): ValueRuleId[] {
  const match = matchText(text);
  const view = digitView(match);
  const hits: ValueRuleId[] = [];
  if (/\d{4,}/.test(view)) hits.push('V1');
  if ((view.match(DIGITS) ?? []).length >= 6) hits.push('V2');
  if (match.includes('@') || EMAIL_SEARCH.test(match)) hits.push('V3');
  if ((view.match(PHONE_SUPERSET) ?? []).some((m) => (m.match(DIGITS) ?? []).length >= 7)) hits.push('V4');
  if (MY_IC_SEARCH.test(view) || US_SSN_SEARCH.test(view)) hits.push('V5');
  if (DATE_SLASH.test(view) || DATE_ISO.test(view)) hits.push('V6');
  if (/^[\s\p{P}\p{S}]*$/u.test(match)) hits.push('V9');
  return hits;
}

/** V7: at least half of the text part's box lies inside a fill-in or ruled answer area. */
export function insideAnswerArea(box: Box, areas: readonly AnswerArea[]): boolean {
  const area = (b: Box) => Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top);
  const own = area(box);
  if (own === 0) return false;
  return areas.some((a) => {
    if (a.kind === 'after-colon') return false; // handled by V8 on the text
    const overlap = area({
      left: Math.max(box.left, a.box.left),
      top: Math.max(box.top, a.box.top),
      right: Math.min(box.right, a.box.right),
      bottom: Math.min(box.bottom, a.box.bottom),
    });
    return overlap / own >= 0.5;
  });
}

export interface LabelSplit {
  /** The text up to and including the label-ending colon, or the whole trimmed text when there is none. */
  label: string;
  /** True when a label-ending colon exists. */
  hasColon: boolean;
  /** V8: text after the colon, with leader runs and whitespace removed, is not empty. */
  hasTextAfterColon: boolean;
}

const LEADER_RUNS = /_{3,}|\.{4,}|\u2026{2,}/gu;

/**
 * The label-ending colon is the first ":" (full-width colon included) that has
 * a letter before it and is not directly between two digits ("10:30").
 */
export function splitAtLabelColon(text: string): LabelSplit {
  const chars = [...text];
  let seenLetter = false;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!;
    if (c.normalize('NFKC') === ':') {
      const before = chars[i - 1];
      const after = chars[i + 1];
      const betweenDigits = before !== undefined && after !== undefined && /\p{Nd}/u.test(before) && /\p{Nd}/u.test(after);
      if (seenLetter && !betweenDigits) {
        const rest = chars.slice(i + 1).join('').replace(LEADER_RUNS, '').replace(/\s+/g, '');
        return { label: chars.slice(0, i + 1).join('').trim(), hasColon: true, hasTextAfterColon: rest.length > 0 };
      }
    }
    if (/\p{L}/u.test(c)) seenLetter = true;
  }
  return { label: text.trim(), hasColon: false, hasTextAfterColon: false };
}

/**
 * Whether edited text is value-like (Requirement 12.5): any text rule on the
 * whole text, or any text after a label-ending colon.
 */
export function isValueLikeText(text: string): boolean {
  return textRuleHits(text).length > 0 || splitAtLabelColon(text).hasTextAfterColon;
}

/**
 * The value rules applied to one printed line. A value part before the colon
 * (or in a line with no colon) makes the whole line value-like (Requirement
 * 11.9); a value part only after the colon leaves the label part, which is
 * `ambiguous` and never preselected. A line inside an answer area is value-like.
 */
export function classifyLineByValueRules(text: string, box: Box, areas: readonly AnswerArea[]): LabelClass {
  if (insideAnswerArea(box, areas)) return 'value-like';
  const { label } = splitAtLabelColon(text);
  if (textRuleHits(label).length > 0) return 'value-like';
  return 'ambiguous';
}

/**
 * Tier A classification: the value rules decide what is never offered, and
 * nothing is `likely-label`, so nothing is preselected. A line the page does
 * not hold gets no entry and so counts as value-like in `buildCandidates`.
 */
export function classifyByValueRules(page: Page): ReadonlyMap<number, LabelClass> {
  // A line directly below a question is the answer someone already wrote: never offered (next-line-values.ts).
  const nextLine = nextLineValues(page);
  return new Map(
    page.lines.map((l) => [l.index, nextLine.has(l.index) ? 'value-like' : classifyLineByValueRules(l.text, l.box, page.answerAreas)] as const),
  );
}
