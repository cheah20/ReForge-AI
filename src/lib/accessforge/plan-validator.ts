/**
 * src/lib/accessforge/plan-validator.ts
 *
 * accessforge-skeleton task 9.1 (design Question 3, Requirements 6.4 to 6.9,
 * 6.12, 6.13). Runs in the Worker before replying and again in the browser on
 * the reply. Pure: no I/O.
 *
 * Rules, in order:
 * 1. Envelope: the reply passes PagePlanReplySchema (`validatePlanReply`;
 *    a failure is an invalid reply and the caller retries once).
 * 2. Each entry is parsed alone with the strict schema; a failing entry is
 *    discarded, so an extra property (selector, XPath, script, URL, Action,
 *    options) never passes.
 * 3. The Element_Id must be the id of a non-button entry, compared exactly.
 * 4. First valid entry wins; later entries for the same id are discarded.
 * 5. An incompatible answer type becomes the implied type with confidence 0.
 * 6. Every non-button entry ends in exactly one of mapped or Do_It_Yourself.
 * 7. Buttons are identified by control type alone.
 *
 * Options never come from the plan: the Mirror lists the Page_Model options
 * and the Executor writes the Page_Model option value (Requirement 6.9).
 */

import type { AnswerType } from '../../shared/types.js';
import { PagePlanEntrySchema, PagePlanReplySchema, type ControlType, type PageModel, type PagePlanEntry } from '../../shared/page-schemas.js';

export interface ValidatedPlan {
  /** Element_Id -> entry, non-button fields only. */
  mapped: Map<string, PagePlanEntry>;
  /** Element_Ids of non-button fields the user completes in the legacy page. */
  doItYourself: Set<string>;
  /** Null when the model has no submit button or more than one (Slice 2, Requirement 6.16). */
  submitId: string | null;
  resetIds: string[];
}

const COMPATIBLE: Partial<Record<ControlType, { accepted: readonly AnswerType[]; implied: AnswerType }>> = {
  text: { accepted: ['text', 'ic', 'phone', 'postcode', 'date', 'email', 'description'], implied: 'text' },
  select: { accepted: ['dropdown'], implied: 'dropdown' },
  radio: { accepted: ['radio'], implied: 'radio' },
  checkbox: { accepted: ['checkbox'], implied: 'checkbox' },
};

const isButton = (control: ControlType) => control === 'submit' || control === 'reset';

export function validatePlan(model: PageModel, rawEntries: readonly unknown[]): ValidatedPlan {
  // Non-button entries that can be mapped: an unsupported control or a
  // duplicated id has no compatible answer type and is always Do_It_Yourself.
  const mappable = new Map<string, ControlType>();
  for (const e of model.entries) {
    if (!isButton(e.control) && COMPATIBLE[e.control] && !e.duplicateId) mappable.set(e.elementId, e.control);
  }

  const mapped = new Map<string, PagePlanEntry>();
  for (const raw of rawEntries) {
    const parsed = PagePlanEntrySchema.safeParse(raw);
    if (!parsed.success) continue;
    const entry = parsed.data;
    const control = mappable.get(entry.elementId);
    if (control === undefined) continue;
    if (mapped.has(entry.elementId)) continue;
    const rule = COMPATIBLE[control]!;
    mapped.set(
      entry.elementId,
      rule.accepted.includes(entry.answerType) ? entry : { ...entry, answerType: rule.implied, confidence: 0 },
    );
  }

  const doItYourself = new Set<string>();
  for (const e of model.entries) {
    if (!isButton(e.control) && !mapped.has(e.elementId)) doItYourself.add(e.elementId);
  }

  const submits = model.entries.filter((e) => e.control === 'submit');
  return {
    mapped,
    doItYourself,
    submitId: submits.length === 1 ? submits[0]!.elementId : null,
    resetIds: model.entries.filter((e) => e.control === 'reset').map((e) => e.elementId),
  };
}

/** Rule 1 plus the rest: null when the reply envelope is invalid. */
export function validatePlanReply(model: PageModel, reply: unknown): ValidatedPlan | null {
  const envelope = PagePlanReplySchema.safeParse(reply);
  if (!envelope.success) return null;
  return validatePlan(model, envelope.data.entries);
}
