/**
 * src/packs/country/interface.ts
 *
 * Country pack interface and ValidationResult type.
 * Each country pack implements CountryPack for its own validation rules.
 * The universal fallback pack handles any country without a registered pack.
 */

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
}

export interface CountryPack {
  /** ISO 3166-1 alpha-2 country code, or "universal" for the fallback */
  code: string;

  /** Validate a national identity number (e.g. Malaysian IC / MyKad) */
  validateIc?(value: string, context?: ValidationContext): ValidationResult;

  /** Validate and normalize a phone number */
  validatePhone(value: string, context?: ValidationContext): ValidationResult;

  /** Validate a postal / ZIP code */
  validatePostcode(value: string, context?: ValidationContext): ValidationResult;

  /**
   * Validate a date string.
   * @param value - User-entered string
   * @param fieldTooltip - Optional tooltip from the PDF, may contain format hint
   */
  validateDate(value: string, fieldTooltip?: string, context?: ValidationContext): ValidationResult;

  /** Format a date string to the expected output format for this country */
  formatDate(value: string, fieldTooltip?: string): string;

  /** Validate a Social Security Number (US only: format check, never verification) */
  validateSsn?(value: string, context?: ValidationContext): ValidationResult;

  /** Validate a ZIP / postal code (US-specific; same as validatePostcode for US) */
  validateZip?(value: string, context?: ValidationContext): ValidationResult;
}
