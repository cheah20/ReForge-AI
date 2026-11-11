/**
 * src/packs/country/universal.ts
 *
 * Universal fallback country pack: international phone numbers (via
 * libphonenumber-js), email, dates in a confirmed format, and postcodes kept as
 * typed. This is a permissive fallback, not full validation for any country.
 *
 * Phone numbers are checked against numbering metadata and need a country for
 * national input.
 */

import { isSupportedCountry, parsePhoneNumberWithError } from 'libphonenumber-js';
import type { CountryCode } from 'libphonenumber-js';
import type { CountryPack, ValidationContext, ValidationResult } from './interface.js';
import { validateDateAnswer } from './dates.js';

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

/**
 * Email format check: one @, no spaces, a dot in the domain, a top-level part
 * of two or more characters. This checks shape only, not that the mailbox exists.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[^\s@.]{2,}$/;

export const universalPack: CountryPack = {
  code: 'universal',
  // ISO is unambiguous everywhere; it is only pre-selected, never assumed.
  defaultDateFormat: 'YYYY-MM-DD',

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

  validateDate: (value, format) => validateDateAnswer(value, format),
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


