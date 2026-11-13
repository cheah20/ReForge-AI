/**
 * src/lib/accessforge/executor.ts
 *
 * accessforge-skeleton task 11.1 (design "Executor", Requirements 3.9, 4.4,
 * 4.9, 8.1 to 8.10, 8.13, 8.14, 10.7). The only code that changes the legacy
 * form. Every check runs before any write, so a rejected Action changes
 * nothing. The Action is parsed with the strict ActionSchema first; a kind
 * such as `Click` or `submit` fails as SCHEMA.
 *
 * Differences from the design's check list, all stricter or equivalent:
 * - RESET_BUTTON is checked before KIND_MISMATCH, so an Action addressed to
 *   the reset button always reports RESET_BUTTON (no kind matches it anyway).
 * - FORM_TARGET runs before every Action, not only the first of a generation
 *   and the click; it is cheap and needs no extra state.
 * - The context carries the iframe's live document and the app origin, which
 *   the document-identity check and `checkFormTarget` need.
 * - Every checkbox counts as the consent checkbox: the Legacy_Form has one
 *   checkbox, the consent box (Slice 1).
 */

import { ActionSchema, type Action, type PageEntry, type PageModel } from '../../shared/page-schemas.js';
import { checkFormTarget } from './allow-list.js';
import { parseElementId } from './element-id.js';
import type { FrameHandle } from './generation.js';
import { locate, pageVersionOf, theForm, type CheckControl, type SelectControl, type ValueControl } from './locate.js';
import type { ValidatedPlan } from './plan-validator.js';
import { legacyLength } from './transformations.js';

export type ActionRejectReason =
  | 'SCHEMA'
  | 'UNKNOWN_ELEMENT'
  | 'KIND_MISMATCH'
  | 'TOO_LONG'
  | 'NOT_AN_OPTION'
  | 'VERSION_CHANGED'
  | 'STALE_GENERATION'
  | 'RESET_BUTTON'
  | 'SUBMIT_NOT_ARMED'
  | 'CONSENT_NOT_GIVEN'
  | 'DO_IT_YOURSELF'
  | 'NOT_FOUND'
  | 'AMBIGUOUS'
  | 'FORM_TARGET';

export type ActionResult = { ok: true } | { ok: false; reason: ActionRejectReason };

export interface ExecutorContext {
  /** Current document and generation (Revival_Generation). */
  frame: FrameHandle;
  /** Generation recorded when the effect was created. */
  actionGeneration: number;
  /** The iframe's `contentDocument` right now. */
  liveDocument: Document | null;
  /** The ReForge app's origin, where the legacy form must post. */
  appOrigin: string;
  model: PageModel;
  plan: ValidatedPlan;
  /** True only between the confirm press (all read-backs equal) and the single click. */
  submitArmed: boolean;
  /** A submission is in progress or a confirmation was received. */
  submissionDone: boolean;
  /** The Mirror consent checkbox. */
  consentGiven: boolean;
}

const reject = (reason: ActionRejectReason): ActionResult => ({ ok: false, reason });

interface Target {
  entry: PageEntry;
  /** Set when the id is a radio option id. */
  optionValue?: string;
}

/** Membership (Requirement 8.13): an entry id, or a radio option id listed in a radio entry. Exact comparison. */
function findTarget(model: PageModel, id: string): Target | null {
  for (const entry of model.entries) {
    if (entry.elementId === id) return { entry };
    if (entry.control === 'radio') {
      const option = entry.options.find((o) => o.elementId === id);
      if (option) return { entry, optionValue: option.value };
    }
  }
  return null;
}

function kindMatches(action: Action, t: Target): boolean {
  switch (action.kind) {
    case 'fill':
      return t.entry.control === 'text';
    case 'select':
      return t.entry.control === 'select';
    case 'check':
      return t.entry.control === 'checkbox' || (t.entry.control === 'radio' && t.optionValue !== undefined);
    case 'click':
      return t.entry.control === 'submit';
  }
}

/** Runs the checks in order; returns the frame element to act on, or the reason to refuse. */
function check(action: Action, ctx: ExecutorContext): { ok: true; el: Element; doc: Document; target: Target } | { ok: false; reason: ActionRejectReason } {
  const { frame, liveDocument: live } = ctx;
  if (ctx.actionGeneration !== frame.generation || frame.document === null || frame.document !== live) return { ok: false, reason: 'STALE_GENERATION' };
  const doc = frame.document;
  if (pageVersionOf(doc) !== ctx.model.pageVersion) return { ok: false, reason: 'VERSION_CHANGED' };

  const target = findTarget(ctx.model, action.elementId);
  if (!target) return { ok: false, reason: 'UNKNOWN_ELEMENT' };
  if (target.entry.control === 'reset') return { ok: false, reason: 'RESET_BUTTON' };
  if (!kindMatches(action, target)) return { ok: false, reason: 'KIND_MISMATCH' };
  if (ctx.plan.doItYourself.has(target.entry.elementId)) return { ok: false, reason: 'DO_IT_YOURSELF' };

  if (action.kind === 'fill' && target.entry.maxLength !== null && legacyLength(action.value) > target.entry.maxLength) return { ok: false, reason: 'TOO_LONG' };
  if (action.kind === 'select') {
    const known = target.entry.options.some((o) => o.value === action.value) || (action.value === '' && target.entry.hasEmptyOption);
    if (!known) return { ok: false, reason: 'NOT_AN_OPTION' };
  }
  if (action.kind === 'check' && action.checked && target.entry.control === 'checkbox' && !ctx.consentGiven) return { ok: false, reason: 'CONSENT_NOT_GIVEN' };
  if (action.kind === 'click' && (!ctx.submitArmed || ctx.submissionDone)) return { ok: false, reason: 'SUBMIT_NOT_ARMED' };

  if (!checkFormTarget(doc, ctx.appOrigin).ok) return { ok: false, reason: 'FORM_TARGET' };

  // The Element_Id itself says what to locate; the plan supplies nothing.
  const key = parseElementId(action.elementId);
  if (!key) return { ok: false, reason: 'UNKNOWN_ELEMENT' };
  const found = locate(doc, key);
  if (found.length === 0) return { ok: false, reason: 'NOT_FOUND' };
  if (found.length > 1) return { ok: false, reason: 'AMBIGUOUS' };
  const el = found[0]!;
  if (action.kind === 'select') {
    // The frame's own options must contain the value, or setting it would clear the selection.
    const options = Array.from((el as unknown as SelectControl).options);
    if (!options.some((o) => o.value === action.value)) return { ok: false, reason: 'NOT_AN_OPTION' };
  }
  return { ok: true, el, doc, target };
}

export function execute(raw: unknown, ctx: ExecutorContext): ActionResult {
  const parsed = ActionSchema.safeParse(raw);
  if (!parsed.success) return reject('SCHEMA');
  const action = parsed.data;
  const c = check(action, ctx);
  if (!c.ok) return reject(c.reason);

  switch (action.kind) {
    case 'fill':
      (c.el as unknown as ValueControl).value = action.value;
      break;
    case 'select':
      (c.el as unknown as SelectControl).value = action.value;
      break;
    case 'check':
      (c.el as unknown as CheckControl).checked = action.checked;
      break;
    case 'click': {
      const form = theForm(c.doc)!;
      (form as unknown as { requestSubmit(submitter: Element): void }).requestSubmit(c.el);
      break;
    }
  }
  return { ok: true };
}
