/**
 * src/packs/country/interface.ts
 *
 * Country pack interface and ValidationResult type.
 * Each country pack implements CountryPack for its own validation rules.
 * The universal fallback pack handles any country without a registered pack.
 */

import type { DateFormat } from './dates.js';

export interface ValidationResult {
  valid: boolean;
  /** i18n key for the error message, not a raw string */
  messageKey?: string;
  /** Interpolation values for the message key */
  messageParams?: Record<string, string | number>;
  /** The normalized value to write into the PDF (only when valid) */
  normalizedValue?: string;
  /**
   * The answer cannot be checked yet because information is missing:
   * - 'country': a national phone number without a known country
   * - 'format': a date without a confirmed format
   * The UI asks for the missing information instead of showing an error.
   */
  needs?: 'country' | 'format';
}

/** Context passed to every validator. */
export interface ValidationContext {
  /** ISO 3166-1 alpha-2 country of the form, when known (e.g. "MY", "US"). */
  country?: string;
  /** "Today" for checks that compare with the current date (IC century). Defaults to the real date. */
  today?: Date;
}

export interface CountryPack {
  /** ISO 3166-1 alpha-2 country code, or "universal" for the fallback */
  code: string;

  /**
   * Date format to pre-select when the user is asked to confirm one. Only a
   * suggestion: a date is never checked against it without confirmation.
   */
  defaultDateFormat: DateFormat;

  /** Validate a national identity number (e.g. Malaysian IC / MyKad) */
  validateIc?(value: string, context?: ValidationContext): ValidationResult;

  /** Validate and normalize a phone number */
  validatePhone(value: string, context?: ValidationContext): ValidationResult;

  /** Validate a postal / ZIP code */
  validatePostcode(value: string, context?: ValidationContext): ValidationResult;

  /**
   * Validate a date answer.
   * @param format the field's output format, confirmed by the user or printed
   *   on the form; undefined when neither exists (the result then asks for it)
   */
  validateDate(value: string, format: DateFormat | undefined, context?: ValidationContext): ValidationResult;

  /** Validate a Social Security Number (US only: format check, never verification) */
  validateSsn?(value: string, context?: ValidationContext): ValidationResult;
}
