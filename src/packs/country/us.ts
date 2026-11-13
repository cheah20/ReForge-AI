/**
 * src/packs/country/us.ts
 *
 * United States country pack (requirement 7.4). Every check is a format check:
 * passing does not mean a phone number is in service, a ZIP code exists or a
 * Social Security number was issued.
 */

import type { FieldEvidence } from '../../shared/types.js';
import { validateDateAnswer } from './dates.js';
import type { CountryPack, ValidationResult } from './interface.js';

// ---------------------------------------------------------------------------
// Phone (NANP)
// ---------------------------------------------------------------------------

/**
 * North American Numbering Plan structure, NPA-NXX-XXXX:
 * NPA (area code) and NXX (exchange) are [2-9]XX and never N11 (211 ... 911 are
 * service codes). Sources: https://nanpa.com/about and
 * https://www.nanpa.com/numbering/abbreviated-codes (checked 2026-11-09).
 * +1 is shared with Canada and other NANP countries, so passing does not prove
 * the number is in the United States. 555-0100 to 555-0199 are fictional
 * numbers and pass this structural check on purpose.
 */
const NANP_PART = /^[2-9](?!11)\d{2}$/;

/** Digits, spaces, hyphens, dots and parentheses, with an optional leading +. */
const PHONE_CHARS = /^\+?[0-9 ().-]+$/;

export function validateUsPhone(value: string): ValidationResult {
  const invalid: ValidationResult = { valid: false, messageKey: 'validation.phone.invalid' };
  const v = value.trim();
  if (!PHONE_CHARS.test(v)) return invalid;
  let digits = v.replace(/\D/g, '');
  if (v.startsWith('+')) {
    if (!digits.startsWith('1')) return invalid;
    digits = digits.slice(1);
  } else if (digits.length === 11 && digits.startsWith('1')) {
    digits = digits.slice(1); // bare leading 1 (decision 4 normalization policy)
  }
  if (digits.length !== 10) return invalid;
  const npa = digits.slice(0, 3);
  const nxx = digits.slice(3, 6);
  if (!NANP_PART.test(npa) || !NANP_PART.test(nxx)) return invalid;
  return { valid: true, normalizedValue: `(${npa}) ${nxx}-${digits.slice(6)}` };
}

// ---------------------------------------------------------------------------
// ZIP and ZIP+4 (USPS)
// ---------------------------------------------------------------------------

/**
 * Five digits, or five digits, a hyphen and four digits; leading zeros kept.
 * Nine digits without the hyphen are rejected rather than reformatted.
 * Source: https://faq.usps.com/articles/Knowledge/ZIP-Code-The-Basics (checked 2026-11-09).
 */
export function validateZip(value: string): ValidationResult {
  const v = value.trim();
  return /^[0-9]{5}(-[0-9]{4})?$/.test(v)
    ? { valid: true, normalizedValue: v }
    : { valid: false, messageKey: 'validation.zip.invalid' };
}

// ---------------------------------------------------------------------------
// Social Security number: format check only
// ---------------------------------------------------------------------------

/**
 * Unanchored SSN shape for the Document_Path value rules: 3, 2 and 4 digits,
 * optionally separated by a hyphen or space, not inside a longer run of digits.
 * It covers both forms `validateSsn` accepts and does not check the number
 * ranges, so it also finds structurally impossible numbers.
 */
export const US_SSN_SEARCH = /(?<!\d)\d{3}[- ]?\d{2}[- ]?\d{4}(?!\d)/;

/**
 * NNN-NN-NNNN, or 9 digits (written back with hyphens). Structurally impossible
 * values are rejected: area 000, 666 or 900-999, group 00, serial 0000
 * (SSA POMS RM 10201.035, https://secure.ssa.gov/poms.nsf/lnx/0110201035,
 * checked 2026-11-09). Passing never means the number was issued; the app says
 * so and never sends the answer anywhere.
 */
export function validateSsn(value: string): ValidationResult {
  const invalid: ValidationResult = { valid: false, messageKey: 'validation.ssn.invalid' };
  const m = value.trim().match(/^(\d{3})-(\d{2})-(\d{4})$/) ?? value.trim().match(/^(\d{3})(\d{2})(\d{4})$/);
  if (!m) return invalid;
  const [, area, group, serial] = m as unknown as [string, string, string, string];
  const a = Number(area);
  if (a === 0 || a === 666 || a >= 900 || group === '00' || serial === '0000') return invalid;
  return { valid: true, normalizedValue: `${area}-${group}-${serial}` };
}

/**
 * True when a text field asks for a Social Security number, judged from the
 * PDF's own tooltip or the label printed beside it.
 */
export function isSsnField(evidence: Pick<FieldEvidence, 'tooltip' | 'widgets' | 'fieldType'>): boolean {
  if (evidence.fieldType !== 'text') return false;
  const text = [evidence.tooltip ?? '', ...evidence.widgets.map((w) => w.pageSnippet)].join(' ');
  return /social security|\bSSN\b/i.test(text);
}

export const usPack: CountryPack = {
  code: 'US',
  // US forms commonly use MM/DD/YYYY; offered first, still confirmed.
  defaultDateFormat: 'MM/DD/YYYY',
  validatePhone: (value) => validateUsPhone(value),
  validatePostcode: (value) => validateZip(value),
  validateDate: (value, format) => validateDateAnswer(value, format),
  validateSsn: (value) => validateSsn(value),
};
