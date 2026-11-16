/**
 * src/frontend/accessforge/mirror-field-adapter.ts
 *
 * accessforge-skeleton task 16.6 (design "Reuse of FormBridge components and
 * validators", Requirement 9.14). Builds FormBridge's `FieldState` and the
 * fixed `FieldQuestion` props from a Mirror field, so the Mirror reuses
 * `FieldQuestion` with no change to its behaviour:
 *
 * - `evidence.tooltip` is the legacy label, else the neighbouring-cell text;
 *   `FieldQuestion` shows it as the original label with `lang` = form language.
 * - options come from the Page_Model only (`exportValue` = option value).
 * - `maxLength` is left undefined: the Mirror applies the UTF-16 rule itself.
 * - `status` is always `mapped`, so `FieldQuestion` never shows its own
 *   low-confidence view; the Mirror shows `LowConfidenceEvidence` instead.
 * - The form language is Malay and the country Malaysia; `confirmed` is true.
 */

import type { FieldState } from '../state.js';
import type { MirrorField } from '../../lib/accessforge/agent-machine.js';
import type { PdfFieldType } from '../../shared/types.js';

export const MIRROR_FORM_LANGUAGE = 'ms';
export const MIRROR_FORM_COUNTRY = 'MY';

const FIELD_TYPE: Partial<Record<MirrorField['entry']['control'], PdfFieldType>> = {
  text: 'text',
  select: 'dropdown',
  radio: 'radio',
};

/** The legacy wording shown as the original label. */
export function originalLabelOf(field: MirrorField): string {
  return field.entry.labelText.trim() || field.entry.neighbourText.trim();
}

export function toFieldState(field: MirrorField): FieldState {
  const fieldType = FIELD_TYPE[field.entry.control];
  if (!fieldType) throw new TypeError(`FieldQuestion does not render a ${field.entry.control} field`);
  if (!field.plan) throw new TypeError('a do-it-yourself field has no question');
  const tooltip = originalLabelOf(field);
  const options = field.entry.options.filter((o) => o.text.trim() !== '').map((o) => ({ exportValue: o.value, displayLabel: o.text }));
  return {
    evidence: {
      fieldId: field.elementId,
      ...(tooltip ? { tooltip } : {}),
      fieldType,
      ...(field.entry.control === 'text' ? {} : { options }),
      required: field.entry.required,
      readOnly: false,
      widgets: [{ pageNumber: 1, bbox: { left: 0, top: 0, right: 0, bottom: 0 }, pageSnippet: field.entry.nearbyText }],
      hasValue: false,
    },
    analysis: {
      fieldId: field.elementId,
      humanLabel: field.plan.humanLabel,
      question: field.plan.question,
      answerType: field.plan.answerType,
      confidence: field.plan.confidence,
    },
    status: 'mapped',
    skipped: false,
  };
}

/** The FieldQuestion props the adapter fixes; the step supplies draft, result and callbacks. */
export function fixedQuestionProps(interfaceLanguage: string) {
  return {
    formLanguage: MIRROR_FORM_LANGUAGE,
    formCountry: MIRROR_FORM_COUNTRY,
    interfaceLanguage,
    confirmed: true,
    onConfirm: () => {},
    onChooseDateFormat: () => {},
    headingLevel: 2 as const,
  };
}
