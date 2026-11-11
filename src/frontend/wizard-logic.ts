/**
 * src/frontend/wizard-logic.ts
 *
 * Pure rules behind the question wizard, the review screen and the download,
 * with no React and no I/O so they can be property-tested.
 *
 * - Which fields are asked (one per step), and which are shown only in review
 *   as "fill this yourself", "set by the form" or "sign after printing".
 * - The constraints each answer is validated against, from the PDF itself.
 * - Which answers are written to the PDF: only answered fields; a skipped field
 *   or a skipped checkbox stays exactly as it was (8.5, 10.3); read-only,
 *   signature and fill-yourself fields are never written; a description is
 *   written in its approved translation, or as typed when no translation was made.
 */

import type { FieldAnswer } from '../lib/pdf-fill/index.js';
import { isCompatible } from '../lib/analysis/reconcile.js';
import { getCountryPack } from '../packs/country/registry.js';
import type { ValidationResult } from '../packs/country/interface.js';
import { isSsnField } from '../packs/country/us.js';
import { resolveDateFormat, validateAnswer, type FieldConstraints } from '../packs/country/validate.js';
import type { AnswerType } from '../shared/types.js';
import type { FieldState } from './state.js';

/** Answer values for checkboxes in `rawAnswer`. */
export const CHECKED = 'checked';
export const UNCHECKED = 'unchecked';

export function answerTypeOf(field: FieldState): AnswerType {
  return field.userOverrideAnswerType ?? field.analysis?.answerType ?? field.evidence.fieldType;
}

/** The field is shown in review but never asked and never written. */
export type ReviewOnlyReason = 'fillYourself' | 'readOnly' | 'signed';

export function reviewOnlyReason(field: FieldState): ReviewOnlyReason | null {
  if (field.evidence.fieldType === 'signature') return 'signed';
  if (field.evidence.readOnly) return 'readOnly';
  if (field.status === 'fill-yourself') return 'fillYourself';
  return null;
}

/** Indexes (into `fields`) of the fields the wizard asks, in form order. */
export function wizardSteps(fields: readonly FieldState[]): number[] {
  return fields.flatMap((f, i) => (reviewOnlyReason(f) === null ? [i] : []));
}

/** Text printed beside the field on the page, from every widget. */
export function pageTextOf(field: FieldState): string {
  return field.evidence.widgets
    .map((w) => w.pageSnippet.trim())
    .filter(Boolean)
    .join(' ');
}

export function constraintsFor(field: FieldState): FieldConstraints {
  const c: FieldConstraints = { required: field.evidence.required };
  if (field.evidence.maxLength !== undefined) c.maxLength = field.evidence.maxLength;
  if (field.evidence.tooltip) c.tooltip = field.evidence.tooltip;
  const pageText = pageTextOf(field);
  if (pageText) c.pageText = pageText;
  if (field.dateFormat) c.dateFormat = field.dateFormat;
  if (isSsnField(field.evidence)) c.ssn = true;
  return c;
}

/** True when a date question must first ask which format the form uses (7.5). */
export function needsDateFormatChoice(field: FieldState): boolean {
  return answerTypeOf(field) === 'date' && resolveDateFormat(constraintsFor(field)) === undefined;
}

export interface ValidateOptions {
  formCountry: string;
  today?: Date;
}

/** Validate a typed or selected answer against the field and the form's country pack. */
export function validateFieldAnswer(field: FieldState, raw: string, options: ValidateOptions): ValidationResult {
  const type = answerTypeOf(field);
  const options_ = field.evidence.options ?? [];
  if (type === 'radio' || type === 'dropdown') {
    if (raw === '') return field.evidence.required ? { valid: false, messageKey: 'validation.required' } : { valid: true, normalizedValue: '' };
    return options_.some((o) => o.exportValue === raw)
      ? { valid: true, normalizedValue: raw }
      : { valid: false, messageKey: `validation.${type}.invalid` };
  }
  if (type === 'checkbox') {
    if (raw === CHECKED || raw === UNCHECKED) return { valid: true, normalizedValue: raw };
    return field.evidence.required ? { valid: false, messageKey: 'validation.required' } : { valid: true, normalizedValue: '' };
  }
  const context = options.today ? { country: options.formCountry, today: options.today } : { country: options.formCountry };
  return validateAnswer(getCountryPack(options.formCountry), type, raw, constraintsFor(field), context);
}

/** Answer types the user may switch a field to (5.9): compatible with the PDF field type. */
export function overrideChoices(field: FieldState): AnswerType[] {
  const all: AnswerType[] = ['text', 'ic', 'phone', 'postcode', 'date', 'email', 'description'];
  return field.evidence.fieldType === 'text' ? all.filter((t) => isCompatible('text', t)) : [field.evidence.fieldType];
}

export type ReviewStatus = 'filled' | 'skipped' | 'fillYourself' | 'readOnly' | 'signed' | 'missingRequired' | 'unanswered';

export function reviewStatus(field: FieldState): ReviewStatus {
  const reason = reviewOnlyReason(field);
  if (reason) return reason;
  if (field.skipped) return 'skipped';
  if (hasWritableAnswer(field)) return 'filled';
  return field.evidence.required ? 'missingRequired' : 'unanswered';
}

function hasWritableAnswer(field: FieldState): boolean {
  return (field.normalizedOutput ?? '') !== '';
}

/** What will be written for a description: the approved translation, else the answer as typed. */
function writtenText(field: FieldState): string {
  if (field.translation?.approved) return field.translation.text.trim();
  return field.normalizedOutput ?? '';
}

/**
 * The answers to write into the PDF. Fields not in the map stay untouched:
 * skipped, unanswered, read-only, signature and fill-yourself fields.
 */
export function answersForFill(fields: readonly FieldState[]): Map<string, FieldAnswer> {
  const out = new Map<string, FieldAnswer>();
  for (const f of fields) {
    if (reviewOnlyReason(f) !== null || f.skipped || !hasWritableAnswer(f)) continue;
    const id = f.evidence.fieldId;
    const type = f.evidence.fieldType;
    if (type === 'checkbox') {
      out.set(id, { kind: 'checkbox', state: f.normalizedOutput === CHECKED ? 'checked' : 'unchecked' });
    } else if (type === 'radio' || type === 'dropdown') {
      out.set(id, { kind: 'choice', exportValue: f.normalizedOutput! });
    } else if (type === 'text') {
      const text = answerTypeOf(f) === 'description' ? writtenText(f) : f.normalizedOutput!;
      if (text !== '') out.set(id, { kind: 'text', value: text });
    }
  }
  return out;
}

/** The first field the user must still deal with before downloading, if any. */
export function firstBlockingField(fields: readonly FieldState[]): number {
  return fields.findIndex((f) => reviewStatus(f) === 'missingRequired');
}

/** File name for the download: "<name>-filled.pdf" (10.4). */
export function filledFileName(original: string): string {
  const base = original.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'form';
  return `${base}-filled.pdf`;
}
