/**
 * src/lib/document/review.ts
 *
 * The reducer behind the Label_Review screen (formbridge-any-document
 * Requirement 12, design "Label review and request builder"). Pure.
 *
 * Only a `toggle` can set `selected` to true. An `edit` can only clear it:
 * a value-like edit (a number, an email, text after a colon) clears the
 * selection and blocks the item, empty text clears it and keeps the row, and
 * any other edit leaves the selection as it was, so an unselected item stays
 * unselected (12.5, 12.12, 12.16). Nothing here sends anything.
 */

import { KEPT_LABEL_MAX_CHARS } from './limits.js';
import type { LabelCandidate } from './types.js';
import { isValueLikeText } from './value-rules.js';

export interface ReviewItem {
  labelId: string;
  pageNumber: number;
  lineIndex: number;
  originalText: string;
  /** Current text, possibly edited. */
  text: string;
  selected: boolean;
  /** The edited text is value-like: the item cannot be selected (12.5). */
  blockedValueLike: boolean;
  checkYourself: boolean;
  /** Whether the item started selected, for `reset`. */
  initialSelected: boolean;
}

export type ReviewAction =
  | { type: 'toggle'; labelId: string }
  | { type: 'edit'; labelId: string; text: string }
  | { type: 'reset' };

export interface KeptLabelItem {
  labelId: string;
  text: string;
  pageNumber: number;
  readingOrder: number;
}

/** Default_Selection: `selected` is true exactly for `likely-label` candidates (12.3). */
export function initialReview(candidates: readonly LabelCandidate[]): ReviewItem[] {
  return candidates.map((c) => {
    const selected = c.labelClass === 'likely-label';
    return {
      labelId: c.labelId,
      pageNumber: c.pageNumber,
      lineIndex: c.lineIndex,
      originalText: c.text,
      text: c.text,
      selected,
      blockedValueLike: false,
      checkYourself: c.checkYourself,
      initialSelected: selected,
    };
  });
}

const clip = (s: string) => [...s].slice(0, KEPT_LABEL_MAX_CHARS).join('');

export function reduceReview(items: readonly ReviewItem[], action: ReviewAction): ReviewItem[] {
  switch (action.type) {
    case 'toggle':
      return items.map((i) => {
        if (i.labelId !== action.labelId) return i;
        // A blocked or empty item cannot be added back (12.5).
        if (i.blockedValueLike || i.text.trim().length === 0) return i;
        return { ...i, selected: !i.selected };
      });
    case 'edit':
      return items.map((i) => {
        if (i.labelId !== action.labelId) return i;
        const text = clip(action.text);
        if (text.trim().length === 0) return { ...i, text, selected: false, blockedValueLike: false };
        if (isValueLikeText(text)) return { ...i, text, selected: false, blockedValueLike: true };
        return { ...i, text, blockedValueLike: false };
      });
    case 'reset':
      return items.map((i) => ({ ...i, text: i.originalText, selected: i.initialSelected, blockedValueLike: false }));
  }
}

/** Drives the count line and the send button label, so they always agree (12.6, 12.15). */
export function selectedCount(items: readonly ReviewItem[]): number {
  return items.filter((i) => i.selected).length;
}

/** The send list: selected, not empty, not value-like, in page and reading order (12.9). */
export function keptLabels(items: readonly ReviewItem[]): KeptLabelItem[] {
  return items
    .filter((i) => i.selected && !i.blockedValueLike && i.text.trim().length > 0 && !isValueLikeText(i.text))
    .map((i) => ({ labelId: i.labelId, text: i.text.trim(), pageNumber: i.pageNumber, readingOrder: i.lineIndex }))
    .sort((a, b) => a.pageNumber - b.pageNumber || a.readingOrder - b.readingOrder);
}
