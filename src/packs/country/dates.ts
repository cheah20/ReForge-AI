/**
 * src/packs/country/dates.ts
 *
 * Date answers, shared by every country pack (requirement 7.5, decision 9,
 * review 1 item 19, task 24.4).
 *
 * - The output format comes from the user's explicit choice, or from a pattern
 *   printed on the form (tooltip or the text beside the field). If neither
 *   exists, the answer cannot be checked yet: the result asks the user to
 *   choose the format (`needs: 'format'`). Nothing is guessed: 03/04/2026 is
 *   never read as 3 April or 4 March on its own.
 * - Accepted input: YYYY-MM-DD (unambiguous) or the form's own slash layout.
 *   Day and month are never swapped: 31/12/2026 on an MM/DD/YYYY form is an
 *   invalid date, not 12/31/2026.
 * - Days, months and years are zero-padded; years run from 0001 to 9999; the
 *   date must exist (leap years follow the Gregorian rule). A future date is
 *   not a format error.
 */

import type { ValidationResult } from './interface.js';

export type DateFormat = 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
export const DATE_FORMATS: readonly DateFormat[] = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'];

/** The separator characters used by `DATE_FORMATS`, in first-seen order (the Document_Path date rule reads them). */
export const DATE_FORMAT_SEPARATORS: readonly string[] = [
  ...new Set(DATE_FORMATS.flatMap((f) => f.replace(/[DMY]/g, '').split(''))),
];

/** 17 November 2026 in each format, for messages. */
export const DATE_EXAMPLES: Readonly<Record<DateFormat, string>> = {
  'DD/MM/YYYY': '17/11/2026',
  'MM/DD/YYYY': '11/17/2026',
  'YYYY-MM-DD': '2026-11-17',
};

const PATTERNS: Array<[DateFormat, RegExp]> = [
  ['DD/MM/YYYY', /\bDD\/MM\/YYYY\b/],
  ['MM/DD/YYYY', /\bMM\/DD\/YYYY\b/],
  ['YYYY-MM-DD', /\bYYYY-MM-DD\b/],
];

/**
 * The date format printed in `text` (case-insensitive). Undefined when there is
 * none, or when two different formats are printed (the field is ambiguous).
 */
export function detectDateFormat(text: string | undefined): DateFormat | undefined {
  if (!text) return undefined;
  const t = text.toUpperCase();
  const found = PATTERNS.filter(([, re]) => re.test(t)).map(([f]) => f);
  return found.length === 1 ? found[0] : undefined;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(month: number, year: number): number {
  const days = [0, 31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return days[month] ?? 0;
}

/** True iff day/month/year is a real Gregorian date with a year from 1 to 9999. */
export function isValidCalendarDate(day: number, month: number, year: number): boolean {
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return false;
  if (year < 1 || year > 9999 || month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(month, year);
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const SLASH = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const pad = (n: number, w: number) => String(n).padStart(w, '0');

/** Write a real date in `format`. */
export function formatDate(day: number, month: number, year: number, format: DateFormat): string {
  const dd = pad(day, 2);
  const mm = pad(month, 2);
  const yyyy = pad(year, 4);
  if (format === 'DD/MM/YYYY') return `${dd}/${mm}/${yyyy}`;
  if (format === 'MM/DD/YYYY') return `${mm}/${dd}/${yyyy}`;
  return `${yyyy}-${mm}-${dd}`;
}

/** Validate a date answer for a field whose output format is `format` (undefined = not known yet). */
export function validateDateAnswer(value: string, format: DateFormat | undefined): ValidationResult {
  if (!format) return { valid: false, needs: 'format', messageKey: 'validation.date.chooseFormat' };

  const v = value.trim();
  let parts: { day: number; month: number; year: number } | undefined;
  const iso = v.match(ISO);
  const slash = v.match(SLASH);
  if (iso) {
    parts = { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
  } else if (slash && format === 'DD/MM/YYYY') {
    parts = { day: Number(slash[1]), month: Number(slash[2]), year: Number(slash[3]) };
  } else if (slash && format === 'MM/DD/YYYY') {
    parts = { month: Number(slash[1]), day: Number(slash[2]), year: Number(slash[3]) };
  }

  if (!parts) {
    return { valid: false, messageKey: 'validation.date.wrongFormat', messageParams: { format, example: DATE_EXAMPLES[format] } };
  }
  if (!isValidCalendarDate(parts.day, parts.month, parts.year)) {
    return { valid: false, messageKey: 'validation.date.invalid' };
  }
  return { valid: true, normalizedValue: formatDate(parts.day, parts.month, parts.year, format) };
}
