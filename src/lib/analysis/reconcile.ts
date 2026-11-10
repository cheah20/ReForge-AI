/**
 * src/lib/analysis/reconcile.ts
 *
 * Pure rules that combine extracted field evidence with an AI analysis reply.
 * Used by the analyze route and by the browser session state.
 *
 * - Requirement 5.5: entries whose fieldId was not submitted are discarded;
 *   duplicates keep the first entry; submitted fields missing from the reply
 *   become "fill this yourself".
 * - Requirement 5.5a: an answerType incompatible with the PDF field type is
 *   replaced by the PDF's own type, with confidence 0.
 * - Requirement 5.6: the fallback analysis for a field.
 * - Requirements 5.7 / 6.1: confidence below 0.7 is low confidence.
 * - Requirements 6.2 / 6.3: unresolvable fields and signatures are "fill this yourself".
 * - Review 1, item 21: multi-select and unresolved-page fields are "fill this yourself".
 *
 * Every submitted field appears in the output exactly once, in submission order
 * (Property 1: no silent drops).
 */

import type { AnswerType, FieldAnalysis, FieldEvidence, PdfFieldType } from '../../shared/types.js';

export const LOW_CONFIDENCE_THRESHOLD = 0.7;

export type FieldStatus = 'mapped' | 'low-confidence' | 'fill-yourself';

export interface ReconciledField {
  evidence: FieldEvidence;
  /** The analysis used for the question; null when the field is fill-yourself without one. */
  analysis: FieldAnalysis | null;
  status: FieldStatus;
}

export interface ReconcileResult {
  fields: ReconciledField[];
  /** Counts only: warnings never carry field content. */
  discardedUnknown: number;
  discardedDuplicates: number;
}

/** Answer types allowed for each PDF field type (requirement 5.5a). */
export const COMPATIBLE_ANSWER_TYPES: Readonly<Record<PdfFieldType, readonly AnswerType[]>> = {
  text: ['text', 'ic', 'phone', 'postcode', 'date', 'email', 'description'],
  checkbox: ['checkbox'],
  radio: ['radio'],
  dropdown: ['dropdown'],
  signature: ['signature'],
};

export function isCompatible(pdfType: PdfFieldType, answerType: AnswerType): boolean {
  return COMPATIBLE_ANSWER_TYPES[pdfType].includes(answerType);
}

/** The PDF's own answer type (requirement 5.6: text fields fall back to `text`). */
export function ownAnswerType(pdfType: PdfFieldType): AnswerType {
  return pdfType;
}

/** Requirement 5.5a: keep a compatible type, otherwise use the PDF's type at confidence 0. */
export function enforceAnswerType(
  pdfType: PdfFieldType,
  answerType: AnswerType,
  confidence: number,
): { answerType: AnswerType; confidence: number } {
  return isCompatible(pdfType, answerType)
    ? { answerType, confidence }
    : { answerType: ownAnswerType(pdfType), confidence: 0 };
}

/** Requirement 5.6: label from the tooltip or raw field name, PDF type, confidence 0. */
export function fallbackAnalysis(evidence: FieldEvidence): FieldAnalysis {
  const source = (evidence.tooltip?.trim() || evidence.fieldId).trim();
  return {
    fieldId: evidence.fieldId,
    humanLabel: [...source].slice(0, 40).join(''),
    question: [...source].slice(0, 120).join(''),
    answerType: ownAnswerType(evidence.fieldType),
    confidence: 0,
  };
}

export function isLowConfidence(confidence: number): boolean {
  return confidence < LOW_CONFIDENCE_THRESHOLD;
}

/** Requirement 6.2: nothing usable to build a question from. */
function isUnresolvable(evidence: FieldEvidence, analysis: FieldAnalysis): boolean {
  const hasTooltip = !!evidence.tooltip?.trim();
  const hasSnippet = evidence.widgets.some((w) => w.pageSnippet.trim() !== '');
  return analysis.confidence === 0 && !hasTooltip && !hasSnippet;
}

export function classifyField(evidence: FieldEvidence, analysis: FieldAnalysis | null): FieldStatus {
  if (evidence.fieldType === 'signature') return 'fill-yourself';
  if (evidence.multiSelect || evidence.unresolvedPage) return 'fill-yourself';
  if (!analysis) return 'fill-yourself';
  if (isUnresolvable(evidence, analysis)) return 'fill-yourself';
  return isLowConfidence(analysis.confidence) ? 'low-confidence' : 'mapped';
}

export function reconcileAnalysis(evidence: readonly FieldEvidence[], analyses: readonly FieldAnalysis[]): ReconcileResult {
  const submitted = new Set(evidence.map((e) => e.fieldId));
  const byId = new Map<string, FieldAnalysis>();
  let discardedUnknown = 0;
  let discardedDuplicates = 0;

  for (const a of analyses) {
    if (!submitted.has(a.fieldId)) discardedUnknown++;
    else if (byId.has(a.fieldId)) discardedDuplicates++;
    else byId.set(a.fieldId, a);
  }

  const fields = evidence.map((ev): ReconciledField => {
    const raw = byId.get(ev.fieldId);
    let analysis: FieldAnalysis | null = null;
    if (raw) {
      analysis = { ...raw, ...enforceAnswerType(ev.fieldType, raw.answerType, raw.confidence) };
      // A blank label or question cannot be shown to the user: use the
      // field's own name or tooltip instead, at confidence 0.
      if (!raw.humanLabel.trim() || !raw.question.trim()) {
        analysis = { ...fallbackAnalysis(ev), answerType: analysis.answerType, confidence: 0 };
      }
    }
    return { evidence: ev, analysis, status: classifyField(ev, analysis) };
  });

  return { fields, discardedUnknown, discardedDuplicates };
}
