/**
 * src/lib/document/review-order.ts
 *
 * Splits the Label_Review candidates into "looks like a question" lines and
 * the rest, so a person facing 40 lines sees the likely labels first
 * (formbridge-any-document Requirement 12, display only). Pure.
 *
 * This never selects anything and never changes a candidate: nothing is
 * preselected, only the user's own tap selects (12.3, 12.16). It only decides
 * which list a line is shown in; page and reading order stay inside each list,
 * and the Kept_Labels of the wizard and the Answer_Sheet keep page and reading
 * order whatever the display grouping (4.6).
 */

import type { LabelCandidate } from './types.js';
import { isValueLikeText } from './value-rules.js';

/** A short line ending in a label colon (half or full width) or in a fill-in line. */
const ENDS_LIKE_A_PROMPT = /(?:[:：]|_{3,}|\.{4,}|…{2,})\s*$/u;
/** Longer lines are paragraphs or instructions, not field names. */
export const PROMPT_MAX_CODE_POINTS = 80;
const MIN_LETTERS = 2;

export function isPromptShaped(text: string): boolean {
  const t = text.trim();
  if ([...t].length > PROMPT_MAX_CODE_POINTS) return false;
  if (!ENDS_LIKE_A_PROMPT.test(t)) return false;
  if ((t.match(/\p{L}/gu) ?? []).length < MIN_LETTERS) return false;
  // Never promote anything that trips a value rule: such text stays in the second list.
  return !isValueLikeText(t);
}

export interface ReviewGroups {
  /** Shown first, as "These look like questions". Each keeps page and reading order. */
  prompts: LabelCandidate[];
  /** Shown after, collapsed. Each keeps page and reading order. */
  others: LabelCandidate[];
}

export function groupForReview(candidates: readonly LabelCandidate[]): ReviewGroups {
  const prompts: LabelCandidate[] = [];
  const others: LabelCandidate[] = [];
  for (const c of candidates) (isPromptShaped(c.text) ? prompts : others).push(c);
  return { prompts, others };
}
