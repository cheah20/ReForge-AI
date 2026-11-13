/**
 * src/packs/country/my.ts
 *
 * Malaysia country pack (requirements 7.1 to 7.3). Every check here is a format
 * check: passing does not mean an IC number was issued, a phone number is in
 * service or a postcode exists.
 */

import type { CountryPack, ValidationContext, ValidationResult } from './interface.js';
import { isValidCalendarDate, validateDateAnswer } from './dates.js';

// ---------------------------------------------------------------------------
// IC number (MyKad): YYMMDD-PB-###G, 12 digits
// ---------------------------------------------------------------------------

/**
 * Birthplace codes (digits 7 and 8) published by JPN (Jabatan Pendaftaran Negara):
 * state codes https://www.jpn.gov.my/informasi/kod-negeri/ and country codes
 * https://www.jpn.gov.my/informasi/kod-negara/ (checked 2026-11-09).
 *   01-16 states and federal territories, 21-59 additional state codes,
 *   60-68 neighbouring countries, 71-72 overseas, 74-79 Asian countries,
 *   82 state unknown, 83-93 regions and countries, 98 stateless, 99 special.
 * Not listed: 00, 17-20, 69, 70, 73, 80, 81, 94-97. Absence from these lists is
 * not proof that a code can never appear, so the message says "not recognised",
 * never "this identity is invalid".
 */
export const MY_IC_BIRTHPLACE_CODES: ReadonlySet<string> = new Set(
  [range(1, 16), range(21, 59), range(60, 68), [71, 72], range(74, 79), range(82, 93), [98, 99]]
    .flat()
    .map((n) => String(n).padStart(2, '0')),
);

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** 12 digits, optionally written with a hyphen or space after digits 6 and 8. */
const IC_PATTERN = /^(\d{6})[- ]?(\d{2})[- ]?(\d{4})$/;

/** The anchored IC pattern used by `validateIc` and `normalizeIc`, for the Document_Path value rules. */
export const MY_IC_PATTERN: RegExp = IC_PATTERN;

/**
 * Unanchored search form of `MY_IC_PATTERN`: finds an IC number inside longer
 * text, but not inside a longer run of digits.
 */
export const MY_IC_SEARCH: RegExp = new RegExp(`(?<!\\d)${IC_PATTERN.source.slice(1, -1)}(?!\\d)`);

/**
 * The 12-digit form of an IC number: separators between the three groups are
 * removed, nothing else is changed. Idempotent.
 */
export function normalizeIc(value: string): string {
  const m = value.trim().match(IC_PATTERN);
  return m ? `${m[1]}${m[2]}${m[3]}` : value.trim();
}

const atMidnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * Requirement 7.1 century rule: 20YY if that is a real date not later than
 * today, otherwise 19YY if that is a real date, otherwise invalid. The year is
 * used only for this check; the app never shows or infers an age.
 */
export function icDateIsValid(yymmdd: string, today: Date = new Date()): boolean {
  const yy = Number(yymmdd.slice(0, 2));
  const mm = Number(yymmdd.slice(2, 4));
  const dd = Number(yymmdd.slice(4, 6));
  const limit = atMidnight(today).getTime();
  if (isValidCalendarDate(dd, mm, 2000 + yy) && new Date(2000 + yy, mm - 1, dd).getTime() <= limit) return true;
  return isValidCalendarDate(dd, mm, 1900 + yy);
}

/** IC validation (requirement 7.1, decisions 1 and 2). There is no checksum to test. */
export function validateIc(value: string, context: ValidationContext = {}): ValidationResult {
  const m = value.trim().match(IC_PATTERN);
  if (!m) return { valid: false, messageKey: 'validation.ic.wrongLength' };
  if (!icDateIsValid(m[1]!, context.today)) return { valid: false, messageKey: 'validation.ic.invalidDate' };
  if (!MY_IC_BIRTHPLACE_CODES.has(m[2]!)) return { valid: false, messageKey: 'validation.ic.invalidBirthplace' };
  return { valid: true, normalizedValue: `${m[1]}${m[2]}${m[3]}` };
}

// ---------------------------------------------------------------------------
// Phone numbers
// ---------------------------------------------------------------------------

/**
 * National prefixes (without the trunk 0) and the digits that follow them.
 * Mobile: MCMC Annual Report 2011, numbering section
 * https://mcmc.gov.my/skmmgovmy/media/General/pdf/SKMM_11eng.pdf (checked 2026-11-09).
 * Landline area codes: the conventional schedule. The current MCMC Numbering and
 * Electronic Addressing Plan could not be retrieved, so landline lengths and
 * 015 are provisional (decision 3).
 */
export const MY_PHONE_PLAN: Readonly<Record<string, { digits: number; kind: 'mobile' | 'landline'; provisional?: true }>> = {
  '10': { digits: 7, kind: 'mobile' },
  '11': { digits: 8, kind: 'mobile' },
  '12': { digits: 7, kind: 'mobile' },
  '13': { digits: 7, kind: 'mobile' },
  '14': { digits: 7, kind: 'mobile' },
  // 015 is associated with IP telephony; 8 digits after it, accepted provisionally.
  '15': { digits: 8, kind: 'mobile', provisional: true },
  '16': { digits: 7, kind: 'mobile' },
  '17': { digits: 7, kind: 'mobile' },
  '18': { digits: 7, kind: 'mobile' },
  '19': { digits: 7, kind: 'mobile' },
  '3': { digits: 8, kind: 'landline', provisional: true },
  '4': { digits: 7, kind: 'landline', provisional: true },
  '5': { digits: 7, kind: 'landline', provisional: true },
  '6': { digits: 7, kind: 'landline', provisional: true },
  '7': { digits: 7, kind: 'landline', provisional: true },
  '9': { digits: 7, kind: 'landline', provisional: true },
  ...Object.fromEntries(range(82, 89).map((n) => [String(n), { digits: 6, kind: 'landline' as const, provisional: true as const }])),
};

/** Digits, spaces, hyphens and parentheses, with an optional leading plus. */
const PHONE_CHARS = /^\+?[0-9 ()-]+$/;

/** The national significant number (no trunk 0, no country code), or undefined. */
function nationalNumber(value: string): string | undefined {
  const v = value.trim();
  if (!PHONE_CHARS.test(v) || v.indexOf('+') > 0) return undefined;
  const digits = v.replace(/\D/g, '');
  if (v.startsWith('+')) return digits.startsWith('60') ? digits.slice(2) : undefined;
  if (digits.startsWith('0')) return digits.slice(1);
  if (digits.startsWith('60')) return digits.slice(2);
  return undefined;
}

/**
 * Validate a Malaysian phone number and write it in the standard national
 * grouping (decision 3): 012-345 6789, 011-2345 6789, 03-2345 6789,
 * 04-123 4567, 082-123 456. Accepts 0..., +60... and 60...; rejects a kept
 * trunk zero such as +60 012... Spacing in the input does not matter.
 */
export function validateMyPhone(value: string): ValidationResult {
  const invalid: ValidationResult = { valid: false, messageKey: 'validation.phone.invalid' };
  const nsn = nationalNumber(value);
  if (!nsn || nsn.startsWith('0')) return invalid;

  const prefix = [nsn.slice(0, 2), nsn.slice(0, 1)].find((p) => p in MY_PHONE_PLAN);
  if (!prefix) return invalid;
  const plan = MY_PHONE_PLAN[prefix]!;
  const subscriber = nsn.slice(prefix.length);
  if (subscriber.length !== plan.digits) return invalid;

  const head = subscriber.length === 6 ? 3 : subscriber.length - 4;
  return { valid: true, normalizedValue: `0${prefix}-${subscriber.slice(0, head)} ${subscriber.slice(head)}` };
}

// ---------------------------------------------------------------------------
// Postcode
// ---------------------------------------------------------------------------

/** Exactly 5 ASCII digits, leading zeros kept (requirement 7.3, UPU addressing sheet). */
export function validateMyPostcode(value: string): ValidationResult {
  const v = value.trim();
  return /^[0-9]{5}$/.test(v)
    ? { valid: true, normalizedValue: v }
    : { valid: false, messageKey: 'validation.postcode.my.invalid' };
}

export const myPack: CountryPack = {
  code: 'MY',
  validateIc,
  validatePhone: (value) => validateMyPhone(value),
  validatePostcode: (value) => validateMyPostcode(value),
  // Malaysian government forms commonly use DD/MM/YYYY; offered first, still confirmed.
  defaultDateFormat: 'DD/MM/YYYY',
  validateDate: (value, format) => validateDateAnswer(value, format),
};
