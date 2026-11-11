/**
 * src/packs/country/validate.ts
 *
 * The single entry point the wizard uses to validate an answer. It dispatches to
 * the active country pack by answer type, then applies the checks every pack
 * shares, in this order:
 *   1. required: a blank answer to a required field is invalid
 *   2. pack validation and normalization (IC, phone, postcode, date, email, ...)
 *   3. MaxLen against the *normalized* output (decision 6), never truncating
 *
 * Example of rule 3: an IC typed as "900101-10-1234" (14 characters) fits a
 * MaxLen 12 field, because the value written to the PDF is "900101101234".
 */

import type { AnswerType } from '../../shared/types.js';
import { detectDateFormat, type DateFormat } from './dates.js';
import type { CountryPack, ValidationContext, ValidationResult } from './interface.js';
import { validateEmail } from './universal.js';

export interface FieldConstraints {
  required?: boolean;
  maxLength?: number;
  /** The PDF tooltip (/TU), searched for a printed date pattern. */
  tooltip?: string;
  /** Page text beside the field, also searched for a printed date pattern. */
  pageText?: string;
  /** Date format the user confirmed for this field. Wins over anything printed. */
  dateFormat?: DateFormat;
  /** The field asks for a US Social Security number (format check only). */
  ssn?: boolean;
}

/**
 * The output format for a date field: the user's confirmed choice, else a
 * single unambiguous pattern printed in the tooltip, else in the page text.
 * Undefined means the user must be asked (requirement 7.5).
 */
export function resolveDateFormat(field: FieldConstraints): DateFormat | undefined {
  return field.dateFormat ?? detectDateFormat(field.tooltip) ?? detectDateFormat(field.pageText);
}

/** Number of characters as a PDF viewer counts them (Unicode code points). */
export function charCount(value: string): number {
  return [...value].length;
}

/**
 * Apply the MaxLen rule to an already-validated result. A normalized value
 * longer than MaxLen makes the answer invalid; it is never cut short.
 */
export function checkMaxLength(result: ValidationResult, maxLength: number | undefined): ValidationResult {
  if (!result.valid || maxLength === undefined || result.normalizedValue === undefined) return result;
  if (charCount(result.normalizedValue) <= maxLength) return result;
  return { valid: false, messageKey: 'validation.maxLength', messageParams: { max: maxLength } };
}

function byType(
  pack: CountryPack,
  answerType: AnswerType,
  value: string,
  field: FieldConstraints,
  context: ValidationContext,
): ValidationResult {
  switch (answerType) {
    case 'phone':
      return pack.validatePhone(value, context);
    case 'postcode':
      return pack.validatePostcode(value, context);
    case 'date':
      return pack.validateDate(value, resolveDateFormat(field), context);
    case 'email':
      return validateEmail(value);
    case 'ic':
      // Only packs that define an identity number format can check it; otherwise
      // the value is kept as typed (the field label decides what it means).
      return pack.validateIc ? pack.validateIc(value, context) : { valid: true, normalizedValue: value.trim() };
    case 'text':
      if (field.ssn && pack.validateSsn) return pack.validateSsn(value, context);
      // Free text keeps the user's exact spelling; only surrounding spaces go.
      return { valid: true, normalizedValue: value.trim() };
    case 'description':
      return { valid: true, normalizedValue: value.trim() };
    default:
      // Checkbox, radio, dropdown and signature answers are not typed text.
      return { valid: true, normalizedValue: value };
  }
}

export function validateAnswer(
  pack: CountryPack,
  answerType: AnswerType,
  value: string,
  field: FieldConstraints = {},
  context: ValidationContext = {},
): ValidationResult {
  if (value.trim() === '') {
    return field.required ? { valid: false, messageKey: 'validation.required' } : { valid: true, normalizedValue: '' };
  }
  return checkMaxLength(byType(pack, answerType, value, field, context), field.maxLength);
}
