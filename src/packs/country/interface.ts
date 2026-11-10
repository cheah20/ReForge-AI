/**
 * src/packs/country/interface.ts
 *
 * Country pack interface and ValidationResult type.
 * Each country pack implements CountryPack for its specific validation rules.
 * The universal fallback pack handles any country not explicitly registered.
 */

export interface ValidationResult {
  valid: boolean;
  /** i18n key for the error message, not a raw string */
  messageKey?: string;
  /** Interpolation values for the message key */
  messageParams?: Record<string, string | number>;
  /** The normalized value to write into the PDF (only when valid) */
  normalizedValue?: string;
}

export interface CountryPack {
  /** ISO 3166-1 alpha-2 country code, or "universal" for the fallback */
  code: string;

  /** Validate a national identity number (e.g. Malaysian IC / MyKad) */
  validateIc?(value: string): ValidationResult;

  /** Validate and normalize a phone number */
  validatePhone(value: string): ValidationResult;

  /** Validate a postal / ZIP code */
  validatePostcode(value: string): ValidationResult;

  /**
   * Validate a date string.
   * @param value - User-entered string
   * @param fieldTooltip - Optional tooltip from the PDF, may contain format hint
   */
  validateDate(value: string, fieldTooltip?: string): ValidationResult;

  /** Format a date string to the expected output format for this country */
  formatDate(value: string, fieldTooltip?: string): string;

  /** Validate a Social Security Number (US only — format check, never verification) */
  validateSsn?(value: string): ValidationResult;

  /** Validate a ZIP / postal code (US-specific — same as validatePostcode for US) */
  validateZip?(value: string): ValidationResult;
}
