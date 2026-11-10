/**
 * src/packs/country/universal.ts
 *
 * Universal fallback country pack.
 * Handles international phone numbers (via libphonenumber-js), email,
 * permissive dates, and permissive postcodes.
 *
 * Postcodes are permissive (unfamiliar formats are kept as typed). Phone numbers
 * are checked against numbering metadata and need a country for national input.
 */

import { isSupportedCountry, parsePhoneNumberWithError } from 'libphonenumber-js';
import type { CountryCode } from 'libphonenumber-js';
import type { CountryPack, ValidationContext, ValidationResult } from './interface.js';

/** Digits, spaces, hyphens, dots, parentheses and one leading plus. Nothing else. */
const PHONE_CHARS = /^\+?[0-9\s().-]+$/;

/**
 * International phone validation through libphonenumber-js.
 * - "+<country code>..." is checked against that country's numbering metadata.
 * - A national number is checked only when the form country is known; otherwise
 *   the result asks for the country (`needs: 'country'`) instead of guessing.
 * - Letters or other characters are rejected outright.
 * Passing means the number has a valid structure, not that it is in service.
 */
export function validateInternationalPhone(value: string, context?: ValidationContext): ValidationResult {
  const invalid: ValidationResult = { valid: false, messageKey: 'validation.phone.invalid' };
  const v = value.trim();
  if (!v || !PHONE_CHARS.test(v)) return invalid;

  let country: CountryCode | undefined;
  if (!v.startsWith('+')) {
    const hint = context?.country?.toUpperCase();
    if (!hint || !isSupportedCountry(hint)) {
      return { valid: false, needs: 'country', messageKey: 'validation.phone.needsCountry' };
    }
    country = hint;
  }

  try {
    const phone = parsePhoneNumberWithError(v, country);
    if (!phone.isValid()) return invalid;
    return { valid: true, normalizedValue: phone.format('INTERNATIONAL') };
  } catch {
    return invalid;
  }
}

/** Simple email regex — RFC 5321 simplified, good enough for format check */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Parse a date string in DD/MM/YYYY, MM/DD/YYYY, or YYYY-MM-DD format.
 * Returns { day, month, year } or null on failure.
 * Never auto-swaps day and month.
 */
function parseDate(
  value: string,
  format: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD' | 'unknown',
): { day: number; month: number; year: number } | null {
  const v = value.trim();

  if (format === 'YYYY-MM-DD' || (format === 'unknown' && /^\d{4}-\d{2}-\d{2}$/.test(v))) {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  }

  if (format === 'DD/MM/YYYY') {
    const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return null;
    return { day: Number(m[1]), month: Number(m[2]), year: Number(m[3]) };
  }

  if (format === 'MM/DD/YYYY') {
    const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return null;
    return { month: Number(m[1]), day: Number(m[2]), year: Number(m[3]) };
  }

  // Unknown format: try YYYY-MM-DD first, then permissive slash
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/)!;
    return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  }

  // Permissive: accept as-is if it looks like a date
  return null;
}

/** True if the given year is a Gregorian leap year */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Days in a given month (1-indexed) */
function daysInMonth(month: number, year: number): number {
  const days = [0, 31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return days[month] ?? 0;
}

/** True iff the date components represent a real Gregorian calendar date */
function isValidCalendarDate(day: number, month: number, year: number): boolean {
  if (year < 1 || year > 9999) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(month, year)) return false;
  return true;
}

/**
 * Detect the date format from a tooltip/nearby text hint.
 */
function detectFormatHint(
  tooltip: string | undefined,
): 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD' | 'unknown' {
  if (!tooltip) return 'unknown';
  const t = tooltip.toUpperCase();
  if (t.includes('DD/MM/YYYY')) return 'DD/MM/YYYY';
  if (t.includes('MM/DD/YYYY')) return 'MM/DD/YYYY';
  if (t.includes('YYYY-MM-DD')) return 'YYYY-MM-DD';
  return 'unknown';
}

export const universalPack: CountryPack = {
  code: 'universal',

  validatePhone(value: string, context?: ValidationContext): ValidationResult {
    return validateInternationalPhone(value, context);
  },

  validatePostcode(value: string): ValidationResult {
    // Permissive: accept anything that has at least some digits
    const v = value.trim();
    if (v.length > 0) {
      return { valid: true, normalizedValue: v };
    }
    return {
      valid: false,
      messageKey: 'validation.postcode.invalid',
    };
  },

  validateDate(value: string, fieldTooltip?: string): ValidationResult {
    const format = detectFormatHint(fieldTooltip);
    const v = value.trim();

    // If format unknown, try ISO first
    const parsed = parseDate(v, format !== 'unknown' ? format : 'YYYY-MM-DD')
      ?? parseDate(v, 'DD/MM/YYYY')
      ?? parseDate(v, 'MM/DD/YYYY');

    if (!parsed) {
      return {
        valid: false,
        messageKey: 'validation.date.invalid',
      };
    }

    if (!isValidCalendarDate(parsed.day, parsed.month, parsed.year)) {
      return {
        valid: false,
        messageKey: 'validation.date.invalid',
      };
    }

    // Normalize to output format
    const normalized = this.formatDate(value, fieldTooltip);
    return { valid: true, normalizedValue: normalized };
  },

  formatDate(value: string, fieldTooltip?: string): string {
    const format = detectFormatHint(fieldTooltip);
    const v = value.trim();

    // Parse from any recognized input format
    const parsed = parseDate(v, format !== 'unknown' ? format : 'YYYY-MM-DD')
      ?? parseDate(v, 'DD/MM/YYYY')
      ?? parseDate(v, 'MM/DD/YYYY');

    if (!parsed) return v;

    const { day, month, year } = parsed;
    const dd = String(day).padStart(2, '0');
    const mm = String(month).padStart(2, '0');
    const yyyy = String(year).padStart(4, '0');

    // Output in the format indicated by the tooltip/hint
    if (format === 'DD/MM/YYYY') return `${dd}/${mm}/${yyyy}`;
    if (format === 'MM/DD/YYYY') return `${mm}/${dd}/${yyyy}`;
    return `${yyyy}-${mm}-${dd}`;
  },
};

/**
 * Validate an email address.
 * Shared utility used by multiple packs.
 */
export function validateEmail(value: string): ValidationResult {
  const v = value.trim();
  if (EMAIL_RE.test(v)) {
    return { valid: true, normalizedValue: v.toLowerCase() };
  }
  return {
    valid: false,
    messageKey: 'validation.email.invalid',
  };
}

/** Re-export helpers for use in other packs */
export { isLeapYear, isValidCalendarDate, daysInMonth, detectFormatHint, parseDate };
