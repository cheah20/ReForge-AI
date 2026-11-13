/**
 * src/lib/accessforge/transformations.ts
 *
 * accessforge-skeleton task 10.1 (design "Transformations" and Question 8,
 * Requirements 9.5, 9.7, 9.9, 9.10, 9.11, 9.14, 15.4). Turns a Mirror answer
 * into the Intended_Value the Executor writes.
 *
 * Every validation rule comes from the shared country-pack code: text, IC,
 * phone, postcode and email through `validateAnswer` with `myPack`; dates
 * through `isValidCalendarDate` and `formatDate`. This module adds only the
 * legacy length rule, counted in UTF-16 code units as the browser counts
 * `maxlength` (decision I); the shared `checkMaxLength` counts code points, so
 * `maxLength` is never passed to `validateAnswer`. An answer is never cut short.
 *
 * Documented_Transformations: trim, ic-separators, my-phone-grouping,
 * date-format, none.
 */

import type { AnswerType } from '../../shared/types.js';
import type { PageEntry } from '../../shared/page-schemas.js';
import { validateAnswer } from '../../packs/country/validate.js';
import { myPack } from '../../packs/country/my.js';
import { detectDateFormat, formatDate, isValidCalendarDate, type DateFormat } from '../../packs/country/dates.js';

export type TransformationName = 'trim' | 'ic-separators' | 'my-phone-grouping' | 'date-format' | 'none';

export type DateParts = { day: string; month: string; year: string };
export type MirrorAnswer =
  | { kind: 'text'; value: string }
  | { kind: 'date'; parts: DateParts }
  | { kind: 'option'; value: string }
  | { kind: 'consent'; checked: boolean };

export type IntendedResult =
  | { ok: true; intended: string | boolean; transformation: TransformationName }
  | { ok: false; messageKey: string; messageParams?: Record<string, string | number>; needs?: 'format' };

export interface TransformContext {
  /** The format the user chose when the page states none or several. */
  dateFormat?: DateFormat;
  /** "Today" for the IC century rule; defaults to the real date. */
  today?: Date;
}

/** Shown when the consent box is left unticked (Requirement 9.8). The string is added with the Mirror strings (task 15). */
export const CONSENT_REQUIRED_KEY = 'accessforge.consent.required';

const TEXT_TYPES: ReadonlySet<AnswerType> = new Set(['text', 'ic', 'phone', 'postcode', 'email', 'description']);

const TRANSFORMATION: Partial<Record<AnswerType, TransformationName>> = {
  ic: 'ic-separators',
  phone: 'my-phone-grouping',
};

/** Length as the browser counts `maxlength`: UTF-16 code units. */
export function legacyLength(value: string): number {
  return value.length;
}

function fits(entry: PageEntry, intended: string): IntendedResult | null {
  if (entry.maxLength !== null && legacyLength(intended) > entry.maxLength) {
    return { ok: false, messageKey: 'validation.maxLength', messageParams: { max: entry.maxLength } };
  }
  return null;
}

/**
 * The Malay abbreviation for day, month and year on the legacy form
 * (design Question 8): HH/BB/TTTT means DD/MM/YYYY.
 */
const MALAY_DMY = /\bHH\/BB\/TTTT\b/i;

/**
 * The date format the page states near the field: the shared detector over
 * the label, neighbouring-cell and nearby text, plus the Malay abbreviation.
 * `ambiguous` when two different formats are found, undefined when none is.
 */
export function detectLegacyDateFormat(entry: PageEntry): DateFormat | 'ambiguous' | undefined {
  const found = new Set<DateFormat>();
  for (const text of [entry.labelText, entry.neighbourText, entry.nearbyText]) {
    const f = detectDateFormat(text);
    if (f) found.add(f);
    if (MALAY_DMY.test(text)) found.add('DD/MM/YYYY');
  }
  if (found.size === 0) return undefined;
  if (found.size > 1) return 'ambiguous';
  return [...found][0];
}

/** Digits only, parsed; null for anything else. Parsing the three inputs, not a date rule. */
function digits(s: string, minLen: number, maxLen: number): number | null {
  if (s.length < minLen || s.length > maxLen) return null;
  for (const c of s) if (c < '0' || c > '9') return null;
  return Number(s);
}

function dateIntended(entry: PageEntry, parts: DateParts, ctx: TransformContext): IntendedResult {
  const day = parts.day.trim();
  const month = parts.month.trim();
  const year = parts.year.trim();
  if (day === '' && month === '' && year === '') {
    return entry.required ? { ok: false, messageKey: 'validation.required' } : { ok: true, intended: '', transformation: 'none' };
  }
  const detected = detectLegacyDateFormat(entry);
  const format = ctx.dateFormat ?? (detected === 'ambiguous' ? undefined : detected);
  if (!format) return { ok: false, needs: 'format', messageKey: 'validation.date.chooseFormat' };
  const d = digits(day, 1, 2);
  const m = digits(month, 1, 2);
  const y = digits(year, 4, 4);
  if (d === null || m === null || y === null || !isValidCalendarDate(d, m, y)) {
    return { ok: false, messageKey: 'validation.date.invalid' };
  }
  const intended = formatDate(d, m, y, format);
  return fits(entry, intended) ?? { ok: true, intended, transformation: 'date-format' };
}

function optionIntended(entry: PageEntry, value: string): IntendedResult {
  if (value === '') {
    return entry.required ? { ok: false, messageKey: 'validation.required' } : { ok: true, intended: '', transformation: 'none' };
  }
  if (!entry.options.some((o) => o.value === value)) {
    return { ok: false, messageKey: entry.control === 'radio' ? 'validation.radio.invalid' : 'validation.dropdown.invalid' };
  }
  return { ok: true, intended: value, transformation: 'none' };
}

export function toIntendedValue(entry: PageEntry, answerType: AnswerType, answer: MirrorAnswer, ctx: TransformContext = {}): IntendedResult {
  switch (answer.kind) {
    case 'text': {
      if (entry.control !== 'text' || !TEXT_TYPES.has(answerType)) throw new TypeError(`a text answer does not fit a ${entry.control} field of type ${answerType}`);
      const r = validateAnswer(myPack, answerType, answer.value, { required: entry.required }, { country: 'MY', ...(ctx.today ? { today: ctx.today } : {}) });
      if (r.valid && r.normalizedValue === undefined) throw new Error('validateAnswer accepted an answer without a normalized value');
      if (!r.valid || r.normalizedValue === undefined) {
        if (r.messageKey === undefined) throw new Error('validateAnswer rejected an answer without a message key');
        return {
          ok: false,
          messageKey: r.messageKey,
          ...(r.messageParams ? { messageParams: r.messageParams } : {}),
          ...(r.needs === 'format' ? { needs: 'format' as const } : {}),
        };
      }
      const intended = r.normalizedValue;
      return fits(entry, intended) ?? { ok: true, intended, transformation: TRANSFORMATION[answerType] ?? 'trim' };
    }
    case 'date':
      if (entry.control !== 'text' || answerType !== 'date') throw new TypeError(`a date answer does not fit a ${entry.control} field of type ${answerType}`);
      return dateIntended(entry, answer.parts, ctx);
    case 'option':
      if ((entry.control !== 'select' || answerType !== 'dropdown') && (entry.control !== 'radio' || answerType !== 'radio')) {
        throw new TypeError(`an option answer does not fit a ${entry.control} field of type ${answerType}`);
      }
      return optionIntended(entry, answer.value);
    case 'consent':
      if (entry.control !== 'checkbox' || answerType !== 'checkbox') throw new TypeError(`a consent answer does not fit a ${entry.control} field of type ${answerType}`);
      if (!answer.checked && entry.required) return { ok: false, messageKey: CONSENT_REQUIRED_KEY };
      return { ok: true, intended: answer.checked, transformation: 'none' };
  }
}
