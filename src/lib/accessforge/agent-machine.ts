/**
 * src/lib/accessforge/agent-machine.ts
 *
 * accessforge-skeleton task 14.1 (design Question 4). The agent loop as one
 * pure reducer: `agentReducer(state, event)` returns the next state and the
 * effects to run. `useAgentLoop` runs the effects (extract, analyse, execute,
 * read back, reload the frame, the 15 s timer, verify the result) and feeds
 * their results back as events. Nothing here touches the DOM or the network.
 *
 * Safety rules the reducer enforces:
 * - The only click effect is emitted on the move from `rereading` to
 *   `submitting`, which needs a confirm press on the review screen and every
 *   re-read equal to its Intended_Value (Requirements 10.6, 12.1).
 * - Every result event carries the generation (or, for the submit timer, the
 *   submit attempt) of the effect that produced it; a result from an older
 *   one is dropped (Requirement 3.9).
 * - A frame load the loop does not expect stops the loop (Requirements 3.3, 3.6).
 * - No analysis effect is emitted before the data notice is acknowledged (13.8).
 *
 * Choices beyond the design, recorded there:
 * - A write that would leave the current step names its target by
 *   Element_Id (`current`), not by index, so a field that becomes do it
 *   yourself mid-flow does not shift the steps.
 * - The 15 s timer is keyed by the submit attempt, because the generation
 *   changes right after the click and again when the response loads.
 * - Unticking consent after it was ticked writes "unchecked" to the legacy
 *   box (Requirement 8.7) and keeps the step open with the consent message.
 * - A field the Executor refuses for a reason other than a missing or
 *   duplicated element becomes do it yourself with reason `REJECTED`.
 */

import type { Action, AnalysisMode, PageEntry, PageModel, PagePlanEntry } from '../../shared/page-schemas.js';
import type { DateFormat } from '../../packs/country/dates.js';
import type { ActionRejectReason } from './executor.js';
import type { ExtractRefusal } from './extract.js';
import type { ValidatedPlan } from './plan-validator.js';
import { CONSENT_REQUIRED_KEY, toIntendedValue, type MirrorAnswer } from './transformations.js';
import { sameValue, type Difference, type FilledField, type ReadBack, type ReadBackResult } from './verifier.js';

export const LOW_CONFIDENCE = 0.7;

export type DiyReason = 'NO_PLAN' | 'DUPLICATE_ID' | 'UNSUPPORTED' | 'NOT_FOUND' | 'AMBIGUOUS' | 'REJECTED';

export interface FieldError {
  messageKey: string;
  messageParams?: Record<string, string | number> | undefined;
  needs?: 'format' | undefined;
}

export interface MirrorField {
  elementId: string;
  entry: PageEntry;
  /** Null for a do-it-yourself field without a plan entry. */
  plan: PagePlanEntry | null;
  status: 'pending' | 'filled' | 'skipped' | 'do-it-yourself' | 'mismatch';
  /** As typed, never trimmed. */
  answer?: MirrorAnswer | undefined;
  intended?: string | boolean | undefined;
  lastReadBack?: ReadBack | undefined;
  diyReason?: DiyReason | undefined;
  error?: FieldError | undefined;
}

export type Phase =
  | 'idle'
  | 'versionUnsupported'
  | 'notice'
  | 'extracting'
  | 'unreadable'
  | 'analysing'
  | 'analysisFailed'
  | 'asking'
  | 'writing'
  | 'verifying'
  | 'halted'
  | 'review'
  | 'rereading'
  | 'submitting'
  | 'unknownOutcome'
  | 'reloading'
  | 'errorReturned'
  | 'verifyingResult'
  | 'done'
  | 'notVerified'
  | 'stopped'
  | 'cancelConfirm';

/** What the next frame load must be. */
export type ExpectedLoad = 'none' | 'register' | 'register-current' | 'post-response';
export type ReloadReason = 'cancel' | 'stop' | 'error' | 'retry';
export type StopReason = 'pageNotSupported' | 'formTarget' | 'pageChanged';
export type FramePage = 'home' | 'register' | 'confirmation' | 'error' | 'not-allowed';

interface WriteItem {
  elementId: string;
  value: string | boolean;
  /** Status after an equal read-back. */
  mark: 'filled' | 'pending';
}

type After = { kind: 'next'; from: string } | { kind: 'review' } | { kind: 'stay'; elementId: string } | { kind: 'step'; elementId: string };

export interface Mismatch {
  elementId: string;
  intended: string | boolean;
  read: string | boolean | null;
}

export interface AgentState {
  phase: Phase;
  /** The phase a cancel question interrupted. */
  resumePhase: Phase | null;
  generation: number;
  expectedLoad: ExpectedLoad;
  reloadReason: ReloadReason | null;
  /** What the frame shows while the loop is idle. */
  frame: 'none' | 'register' | 'other';
  interfaceLanguage: string;
  model: PageModel | null;
  plan: ValidatedPlan | null;
  analysisMode: AnalysisMode | null;
  fields: MirrorField[];
  /** Element_Id of the open question step. */
  current: string | null;
  returnToReview: boolean;
  dateFormat: DateFormat | null;
  queue: WriteItem[];
  after: After;
  mismatches: Mismatch[];
  haltedReturn: 'next' | 'review';
  /** Re-read results after the confirm press: equal, and the value read. */
  reread: Record<string, { equal: boolean; read: string | boolean | null }>;
  submitAttempt: number;
  submissionDone: boolean;
  confirmationReceived: boolean;
  failingNames: string[];
  result: { differences: Difference[]; reference: string | null; originalText: string | null } | null;
  errorCode: string | null;
  stopReason: StopReason | null;
  /** Answers kept in memory after a stop (Requirement 3.3). */
  keptAnswers: Record<string, MirrorAnswer>;
  /** After the loop ended, the frame showed an unsupported page; the result is unchanged. */
  pageNotice: boolean;
  noticeAcknowledged: boolean;
}

export type Effect =
  | { type: 'EXTRACT'; generation: number }
  | { type: 'ANALYZE'; generation: number; model: PageModel; interfaceLanguage: string }
  | { type: 'ABORT_PENDING'; before: number }
  | { type: 'EXECUTE'; generation: number; action: Action; submitArmed: boolean; consentGiven: boolean }
  | { type: 'READ_BACK'; generation: number; elementId: string }
  | { type: 'RELOAD_FRAME' }
  | { type: 'START_SUBMIT_TIMER'; attempt: number }
  | { type: 'CLEAR_SUBMIT_TIMER' }
  | { type: 'VERIFY_RESULT'; generation: number; filled: FilledField[] };

export type AgentEvent =
  | { type: 'FRAME_LOADED'; generation: number; page: FramePage; versionSupported: boolean; failingNames?: string[] }
  | { type: 'REVIVE_PRESSED' }
  | { type: 'NOTICE_ACKNOWLEDGED' }
  | { type: 'NOTICE_DISMISSED' }
  | { type: 'MODEL_READY'; generation: number; model: PageModel }
  | { type: 'EXTRACT_FAILED'; generation: number; code: ExtractRefusal }
  | { type: 'PLAN_READY'; generation: number; analysisMode: AnalysisMode; plan: ValidatedPlan }
  | { type: 'ANALYSIS_FAILED'; generation: number; code: string }
  | { type: 'RETRY_PRESSED' }
  | { type: 'NEXT_PRESSED'; answer: MirrorAnswer; today?: Date }
  | { type: 'BACK_PRESSED' }
  | { type: 'DATE_FORMAT_CHOSEN'; format: DateFormat }
  | { type: 'ACTION_DONE'; generation: number; elementId: string }
  | { type: 'ACTION_REJECTED'; generation: number; elementId: string; reason: ActionRejectReason }
  | { type: 'READ_BACK_DONE'; generation: number; elementId: string; result: ReadBackResult }
  | { type: 'EDIT_PRESSED'; elementId: string }
  | { type: 'CONFIRM_PRESSED' }
  | { type: 'SUBMIT_TIMEOUT'; attempt: number }
  | { type: 'TRY_AGAIN_PRESSED' }
  | { type: 'RESULT_VERIFIED'; generation: number; differences: Difference[]; reference: string | null; originalText: string | null }
  | { type: 'CANCEL_PRESSED' }
  | { type: 'CANCEL_CONFIRMED' }
  | { type: 'CANCEL_DECLINED' }
  | { type: 'RELOAD_PRESSED' };

export type Step = { state: AgentState; effects: Effect[] };

export function initialAgentState(interfaceLanguage: string): AgentState {
  return {
    phase: 'idle',
    resumePhase: null,
    generation: 0,
    expectedLoad: 'none',
    reloadReason: null,
    frame: 'none',
    interfaceLanguage,
    model: null,
    plan: null,
    analysisMode: null,
    fields: [],
    current: null,
    returnToReview: false,
    dateFormat: null,
    queue: [],
    after: { kind: 'review' },
    mismatches: [],
    haltedReturn: 'next',
    reread: {},
    submitAttempt: 0,
    submissionDone: false,
    confirmationReceived: false,
    failingNames: [],
    result: null,
    errorCode: null,
    stopReason: null,
    keptAnswers: {},
    pageNotice: false,
    noticeAcknowledged: false,
  };
}

// ---------------------------------------------------------------------------
// Derived values (pure helpers for the screens)
// ---------------------------------------------------------------------------

const ACTIVE: ReadonlySet<Phase> = new Set<Phase>([
  'extracting', 'analysing', 'analysisFailed', 'asking', 'writing', 'verifying', 'halted', 'review', 'rereading',
  'submitting', 'unknownOutcome', 'reloading', 'errorReturned', 'verifyingResult',
]);

/** The loop is running: the language picker is locked (Requirement 7.11) and unexpected loads stop it. */
export function isActive(s: AgentState): boolean {
  return ACTIVE.has(s.phase === 'cancelConfirm' ? (s.resumePhase ?? 'idle') : s.phase);
}

export const languageLocked = isActive;

const CANCELLABLE: ReadonlySet<Phase> = new Set<Phase>(['notice', 'extracting', 'analysing', 'analysisFailed', 'asking', 'writing', 'verifying', 'halted', 'review', 'rereading']);

/** Element_Ids of the question steps, in Legacy_Form order (Requirement 9.1). */
export function steps(s: AgentState): string[] {
  return s.fields.filter((f) => f.plan !== null && f.status !== 'do-it-yourself').map((f) => f.elementId);
}

export function stepInfo(s: AgentState): { index: number; total: number } | null {
  const all = steps(s);
  const i = s.current === null ? -1 : all.indexOf(s.current);
  return i < 0 ? null : { index: i + 1, total: all.length };
}

export function isLowConfidence(f: MirrorField): boolean {
  return f.plan !== null && f.plan.confidence < LOW_CONFIDENCE;
}

export function fieldById(s: AgentState, id: string): MirrorField | undefined {
  return s.fields.find((f) => f.elementId === id);
}

/** The Mirror consent box is ticked, or there is no consent question the Mirror asks. */
export function consentGiven(s: AgentState): boolean {
  const consent = s.fields.find((f) => f.entry.control === 'checkbox' && f.plan !== null && f.status !== 'do-it-yourself');
  if (!consent) return true;
  return consent.answer?.kind === 'consent' && consent.answer.checked;
}

export interface ReviewRow {
  field: MirrorField;
  status: 'filled' | 'skipped' | 'do-it-yourself' | 'mismatch';
}

/** Every field except the buttons, in Legacy_Form order, with exactly one status (Requirements 10.4, 12.7). */
export function reviewRows(s: AgentState): ReviewRow[] {
  return s.fields.map((field) => ({
    field,
    status: field.status === 'do-it-yourself' ? 'do-it-yourself' : field.status === 'filled' ? 'filled' : field.status === 'mismatch' ? 'mismatch' : 'skipped',
  }));
}

/** Required do-it-yourself fields; the screen names the empty ones (Requirement 12.8). */
export function requiredDoItYourself(s: AgentState): MirrorField[] {
  return s.fields.filter((f) => f.status === 'do-it-yourself' && f.entry.required);
}

export type ConfirmBlock = 'CONSENT' | 'PENDING' | 'MISMATCH' | 'SUBMITTED' | 'NOT_REVIEW';

/** Whether the confirm button is available, and why not (Requirements 9.8, 10.7, 10.13). */
export function canConfirm(s: AgentState): { ok: true } | { ok: false; reason: ConfirmBlock } {
  if (s.submissionDone || s.confirmationReceived) return { ok: false, reason: 'SUBMITTED' };
  if (s.phase !== 'review') return { ok: false, reason: 'NOT_REVIEW' };
  if (s.queue.length > 0) return { ok: false, reason: 'PENDING' };
  if (s.fields.some((f) => f.status === 'mismatch')) return { ok: false, reason: 'MISMATCH' };
  if (!consentGiven(s)) return { ok: false, reason: 'CONSENT' };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

const same = (state: AgentState): Step => ({ state, effects: [] });

function setField(s: AgentState, id: string, patch: Partial<MirrorField>): AgentState {
  return { ...s, fields: s.fields.map((f) => (f.elementId === id ? { ...f, ...patch } : f)) };
}

function keepAnswers(s: AgentState): Record<string, MirrorAnswer> {
  const kept = { ...s.keptAnswers };
  for (const f of s.fields) if (f.answer) kept[f.elementId] = f.answer;
  return kept;
}

function stop(s: AgentState, reason: StopReason, effects: Effect[] = []): Step {
  return {
    state: { ...s, phase: 'stopped', resumePhase: null, stopReason: reason, keptAnswers: keepAnswers(s), queue: [], expectedLoad: 'none' },
    effects: [...effects, { type: 'CLEAR_SUBMIT_TIMER' }],
  };
}

function actionFor(field: MirrorField, value: string | boolean): Action {
  const id = field.elementId;
  switch (field.entry.control) {
    case 'text':
      return { kind: 'fill', elementId: id, value: String(value) };
    case 'select':
      return { kind: 'select', elementId: id, value: String(value) };
    case 'radio': {
      const option = field.entry.options.find((o) => o.value === value);
      if (!option?.elementId) throw new Error(`no radio option for the intended value of ${id}`);
      return { kind: 'check', elementId: option.elementId, checked: true };
    }
    case 'checkbox':
      return { kind: 'check', elementId: id, checked: value === true };
    default:
      throw new Error(`no write for control ${field.entry.control}`);
  }
}

/** Emits the write of the first queued item, or moves on when the queue is empty. */
function runQueue(s: AgentState, effects: Effect[]): Step {
  const item = s.queue[0];
  if (item) {
    const field = fieldById(s, item.elementId)!;
    const consent = field.entry.control === 'checkbox' ? item.value === true : consentGiven(s);
    return {
      state: { ...s, phase: 'writing' },
      effects: [...effects, { type: 'EXECUTE', generation: s.generation, action: actionFor(field, item.value), submitArmed: false, consentGiven: consent }],
    };
  }
  return goAfter(s, effects);
}

function goAfter(s: AgentState, effects: Effect[]): Step {
  const all = steps(s);
  const ask = (id: string): Step => ({ state: { ...s, phase: 'asking', current: id }, effects });
  const review: Step = { state: { ...s, phase: 'review', current: null, returnToReview: false }, effects };
  const a = s.after;
  if (a.kind === 'review') return review;
  if (a.kind === 'stay' || a.kind === 'step') return all.includes(a.elementId) ? ask(a.elementId) : review;
  // Next step after `from` in Legacy_Form order, even if `from` itself is no longer a step.
  const order = s.fields.map((f) => f.elementId);
  const from = order.indexOf(a.from);
  const next = all.find((id) => order.indexOf(id) > from);
  return next ? ask(next) : review;
}

function makeDiy(s: AgentState, id: string, reason: DiyReason): AgentState {
  return setField(s, id, { status: 'do-it-yourself', diyReason: reason, intended: undefined });
}

function equalsRead(value: string | boolean, rb: ReadBack): boolean {
  if (rb.kind === 'checkbox') return typeof value === 'boolean' && rb.checked === value;
  return typeof value === 'string' && rb.value !== null && sameValue(value, rb.value);
}

function readValue(rb: ReadBack): string | boolean | null {
  return rb.kind === 'checkbox' ? rb.checked : rb.value;
}

function buildFields(model: PageModel, plan: ValidatedPlan, kept: Record<string, MirrorAnswer>): MirrorField[] {
  return model.entries
    .filter((e) => e.control !== 'submit' && e.control !== 'reset')
    .map((entry) => {
      const p = plan.mapped.get(entry.elementId) ?? null;
      const diyReason: DiyReason | undefined = p ? undefined : entry.control === 'unsupported' ? 'UNSUPPORTED' : entry.duplicateId ? 'DUPLICATE_ID' : 'NO_PLAN';
      return {
        elementId: entry.elementId,
        entry,
        plan: p,
        status: p ? 'pending' : 'do-it-yourself',
        answer: p ? kept[entry.elementId] : undefined,
        diyReason,
      };
    });
}

/** Writes every filled field again from the kept answers (Requirements 10.8, 10.9). */
function startRewrite(s: AgentState, after: After, effects: Effect[]): Step {
  const items: WriteItem[] = s.fields
    .filter((f) => f.status === 'filled' && f.intended !== undefined && !(f.entry.control === 'radio' && f.intended === ''))
    .map((f) => ({ elementId: f.elementId, value: f.intended!, mark: 'filled' }));
  let next: AgentState = { ...s, queue: items, after, submissionDone: false, expectedLoad: 'register-current', reloadReason: null };
  for (const it of items) next = setField(next, it.elementId, { status: 'pending' });
  return runQueue(next, effects);
}

function frameLoaded(s: AgentState, e: Extract<AgentEvent, { type: 'FRAME_LOADED' }>): Step {
  if (e.generation < s.generation) return same(s);
  const base: AgentState = { ...s, generation: e.generation };
  const effects: Effect[] = [{ type: 'ABORT_PENDING', before: e.generation }];

  if (s.phase === 'done' || s.phase === 'notVerified') {
    return { state: { ...base, pageNotice: base.pageNotice || e.page !== 'confirmation' }, effects };
  }

  const idleFrom = (st: AgentState): Step => {
    if (e.page === 'register' && !e.versionSupported) return { state: { ...st, phase: 'versionUnsupported', frame: 'register' }, effects };
    return { state: { ...st, phase: 'idle', frame: e.page === 'register' ? 'register' : 'other' }, effects };
  };

  switch (s.expectedLoad) {
    case 'register': {
      const reason = s.reloadReason;
      const cleared: AgentState = { ...base, expectedLoad: 'none', reloadReason: null };
      if (e.page !== 'register') {
        if (reason === 'cancel' || reason === 'stop') return idleFrom(cleared);
        return stop(cleared, 'pageNotSupported', effects);
      }
      if (!e.versionSupported) return { state: { ...cleared, phase: 'versionUnsupported', frame: 'register', queue: [] }, effects };
      if (reason === 'error') {
        const order = s.fields.map((f) => f.elementId);
        const named = s.fields.filter((f) => s.failingNames.includes(f.entry.name) && f.plan !== null && f.status !== 'do-it-yourself');
        const first = named.sort((a, b) => order.indexOf(a.elementId) - order.indexOf(b.elementId))[0];
        return startRewrite({ ...base, reloadReason: null }, first ? { kind: 'step', elementId: first.elementId } : { kind: 'review' }, effects);
      }
      if (reason === 'retry') return startRewrite({ ...base, reloadReason: null }, { kind: 'review' }, effects);
      return idleFrom(cleared);
    }
    case 'post-response':
      if (e.page === 'confirmation') {
        const filled: FilledField[] = s.fields.filter((f) => f.status === 'filled' && f.intended !== undefined).map((f) => ({ entry: f.entry, intended: f.intended! }));
        return {
          state: { ...base, phase: 'verifyingResult', resumePhase: null, confirmationReceived: true, expectedLoad: 'none' },
          effects: [...effects, { type: 'CLEAR_SUBMIT_TIMER' }, { type: 'VERIFY_RESULT', generation: e.generation, filled }],
        };
      }
      if (e.page === 'error') {
        return {
          state: { ...base, phase: 'errorReturned', resumePhase: null, failingNames: e.failingNames ?? [], expectedLoad: 'register', reloadReason: 'error' },
          effects: [...effects, { type: 'CLEAR_SUBMIT_TIMER' }, { type: 'RELOAD_FRAME' }],
        };
      }
      return stop(base, 'pageNotSupported', effects);
    case 'register-current':
      // Any load during the flow replaces the document the answers were written into.
      return stop(base, 'pageNotSupported', effects);
    case 'none':
      if (s.phase === 'stopped') return { state: base, effects };
      if (s.phase === 'notice') return idleFrom(base);
      if (s.phase === 'idle' || s.phase === 'versionUnsupported' || s.phase === 'unreadable') return idleFrom(base);
      return isActive(s) ? stop(base, 'pageNotSupported', effects) : { state: base, effects };
  }
}

function nextPressed(s: AgentState, e: Extract<AgentEvent, { type: 'NEXT_PRESSED' }>): Step {
  if ((s.phase !== 'asking' && s.phase !== 'halted') || s.current === null) return same(s);
  const field = fieldById(s, s.current);
  if (!field?.plan) return same(s);
  const res = toIntendedValue(field.entry, field.plan.answerType, e.answer, {
    ...(s.dateFormat ? { dateFormat: s.dateFormat } : {}),
    ...(e.today ? { today: e.today } : {}),
  });
  const after: After = s.returnToReview || (s.phase === 'halted' && s.haltedReturn === 'review') ? { kind: 'review' } : { kind: 'next', from: field.elementId };
  let st = setField(s, field.elementId, { answer: e.answer });

  if (!res.ok) {
    const error: FieldError = { messageKey: res.messageKey, messageParams: res.messageParams, needs: res.needs };
    st = setField(st, field.elementId, { error, status: field.status === 'mismatch' ? 'mismatch' : 'pending' });
    if (res.messageKey === CONSENT_REQUIRED_KEY && field.intended === true) {
      // Requirement 8.7: set the legacy consent box back to unchecked.
      st = setField(st, field.elementId, { intended: false, status: 'pending' });
      return runQueue({ ...st, queue: [{ elementId: field.elementId, value: false, mark: 'pending' }], after: { kind: 'stay', elementId: field.elementId }, mismatches: [] }, []);
    }
    return same(st);
  }

  st = setField(st, field.elementId, { intended: res.intended, error: undefined });
  st = { ...st, mismatches: st.mismatches.filter((m) => m.elementId !== field.elementId), after };
  if (field.entry.control === 'radio' && res.intended === '') {
    // A blank optional radio: nothing to write.
    return goAfter(setField(st, field.elementId, { status: 'skipped' }), []);
  }
  return runQueue({ ...st, queue: [{ elementId: field.elementId, value: res.intended, mark: 'filled' }] }, []);
}

function doSubmit(s: AgentState): Step {
  if (!s.plan?.submitId) return stop(s, 'pageNotSupported');
  const attempt = s.submitAttempt + 1;
  return {
    state: { ...s, phase: 'submitting', submitAttempt: attempt, submissionDone: true, expectedLoad: 'post-response', reread: {} },
    effects: [
      { type: 'EXECUTE', generation: s.generation, action: { kind: 'click', elementId: s.plan.submitId }, submitArmed: true, consentGiven: consentGiven(s) },
      { type: 'START_SUBMIT_TIMER', attempt },
    ],
  };
}

function halt(s: AgentState, mismatches: Mismatch[], ret: 'next' | 'review'): Step {
  let st: AgentState = { ...s, phase: 'halted', queue: [], mismatches, haltedReturn: ret, current: mismatches[0]!.elementId, reread: {} };
  for (const m of mismatches) st = setField(st, m.elementId, { status: 'mismatch' });
  return same(st);
}

function readBackDone(s: AgentState, e: Extract<AgentEvent, { type: 'READ_BACK_DONE' }>): Step {
  if (e.generation !== s.generation || e.result === 'STALE_GENERATION') return same(s);
  const field = fieldById(s, e.elementId);
  if (!field) return same(s);

  if (s.phase === 'rereading') {
    if (!(e.elementId in s.reread) && field.status === 'filled') {
      const ok = typeof e.result !== 'string';
      const entry = { equal: ok && equalsRead(field.intended!, e.result as ReadBack), read: ok ? readValue(e.result as ReadBack) : null };
      const reread = { ...s.reread, [e.elementId]: entry };
      const filled = s.fields.filter((f) => f.status === 'filled');
      if (filled.some((f) => !(f.elementId in reread))) return same({ ...s, reread });
      const different = filled.filter((f) => !reread[f.elementId]!.equal);
      if (different.length === 0) return doSubmit({ ...s, reread });
      return halt(s, different.map((f) => ({ elementId: f.elementId, intended: f.intended!, read: reread[f.elementId]!.read })), 'review');
    }
    return same(s);
  }

  const item = s.queue[0];
  if (s.phase !== 'verifying' || !item || item.elementId !== e.elementId) return same(s);
  if (e.result === 'NOT_FOUND' || e.result === 'AMBIGUOUS') {
    return runQueue({ ...makeDiy(s, e.elementId, e.result), queue: s.queue.slice(1) }, []);
  }
  if (!equalsRead(item.value, e.result)) {
    const st = setField(s, e.elementId, { lastReadBack: e.result });
    return halt(st, [{ elementId: e.elementId, intended: item.value, read: readValue(e.result) }], s.after.kind === 'review' ? 'review' : 'next');
  }
  const st = setField(s, e.elementId, { status: item.mark, lastReadBack: e.result });
  return runQueue({ ...st, queue: s.queue.slice(1) }, []);
}

function actionResult(s: AgentState, e: Extract<AgentEvent, { type: 'ACTION_DONE' | 'ACTION_REJECTED' }>): Step {
  if (e.generation !== s.generation) return same(s);
  if (s.phase === 'submitting' && e.type === 'ACTION_REJECTED') {
    return stop({ ...s, submissionDone: false }, e.reason === 'FORM_TARGET' ? 'formTarget' : 'pageNotSupported');
  }
  const item = s.queue[0];
  if (s.phase !== 'writing' || !item || item.elementId !== e.elementId) return same(s);
  if (e.type === 'ACTION_DONE') return { state: { ...s, phase: 'verifying' }, effects: [{ type: 'READ_BACK', generation: s.generation, elementId: e.elementId }] };
  switch (e.reason) {
    case 'STALE_GENERATION':
      return same(s);
    case 'FORM_TARGET':
      return stop(s, 'formTarget');
    case 'VERSION_CHANGED':
      return stop(s, 'pageChanged');
    default: {
      const reason: DiyReason = e.reason === 'NOT_FOUND' || e.reason === 'AMBIGUOUS' ? e.reason : 'REJECTED';
      return runQueue({ ...makeDiy(s, e.elementId, reason), queue: s.queue.slice(1) }, []);
    }
  }
}

function reduce(s: AgentState, e: AgentEvent): Step {
  switch (e.type) {
    case 'FRAME_LOADED':
      return frameLoaded(s, e);

    case 'REVIVE_PRESSED':
      if (s.phase !== 'idle' || s.frame !== 'register' || s.expectedLoad !== 'none') return same(s);
      return same({ ...s, phase: 'notice', pageNotice: false });
    case 'NOTICE_DISMISSED':
      return s.phase === 'notice' ? same({ ...s, phase: 'idle' }) : same(s);
    case 'NOTICE_ACKNOWLEDGED':
      if (s.phase !== 'notice') return same(s);
      return {
        state: { ...s, phase: 'extracting', noticeAcknowledged: true, expectedLoad: 'register-current', errorCode: null, stopReason: null },
        effects: [{ type: 'EXTRACT', generation: s.generation }],
      };

    case 'MODEL_READY':
      if (s.phase !== 'extracting' || e.generation !== s.generation) return same(s);
      return {
        state: { ...s, phase: 'analysing', model: e.model },
        effects: [{ type: 'ANALYZE', generation: s.generation, model: e.model, interfaceLanguage: s.interfaceLanguage }],
      };
    case 'EXTRACT_FAILED':
      if (s.phase !== 'extracting' || e.generation !== s.generation) return same(s);
      return same({ ...s, phase: 'unreadable', errorCode: e.code, expectedLoad: 'none' });
    case 'PLAN_READY': {
      if (s.phase !== 'analysing' || e.generation !== s.generation || !s.model) return same(s);
      const fields = buildFields(s.model, e.plan, s.keptAnswers);
      const st: AgentState = { ...s, plan: e.plan, analysisMode: e.analysisMode, fields, keptAnswers: {}, submissionDone: false, confirmationReceived: false, result: null, after: { kind: 'review' } };
      const first = steps(st)[0];
      return same(first ? { ...st, phase: 'asking', current: first } : { ...st, phase: 'review', current: null });
    }
    case 'ANALYSIS_FAILED':
      if (s.phase !== 'analysing' || e.generation !== s.generation) return same(s);
      return same({ ...s, phase: 'analysisFailed', errorCode: e.code });
    case 'RETRY_PRESSED':
      if (s.phase !== 'analysisFailed' || !s.model) return same(s);
      return {
        state: { ...s, phase: 'analysing', errorCode: null },
        effects: [{ type: 'ANALYZE', generation: s.generation, model: s.model, interfaceLanguage: s.interfaceLanguage }],
      };

    case 'NEXT_PRESSED':
      return nextPressed(s, e);
    case 'BACK_PRESSED': {
      if (s.phase !== 'asking' || s.current === null) return same(s);
      const all = steps(s);
      const i = all.indexOf(s.current);
      return i > 0 ? same({ ...s, current: all[i - 1]! }) : same(s);
    }
    case 'DATE_FORMAT_CHOSEN':
      return same({ ...s, dateFormat: e.format });
    case 'ACTION_DONE':
    case 'ACTION_REJECTED':
      return actionResult(s, e);
    case 'READ_BACK_DONE':
      return readBackDone(s, e);

    case 'EDIT_PRESSED':
      if (s.phase !== 'review' || !steps(s).includes(e.elementId)) return same(s);
      return same({ ...s, phase: 'asking', current: e.elementId, returnToReview: true });
    case 'CONFIRM_PRESSED': {
      if (!canConfirm(s).ok) return same(s);
      const filled = s.fields.filter((f) => f.status === 'filled');
      if (filled.length === 0) return doSubmit(s);
      return {
        state: { ...s, phase: 'rereading', reread: {} },
        effects: filled.map((f): Effect => ({ type: 'READ_BACK', generation: s.generation, elementId: f.elementId })),
      };
    }
    case 'SUBMIT_TIMEOUT':
      if (s.phase !== 'submitting' || e.attempt !== s.submitAttempt) return same(s);
      return same({ ...s, phase: 'unknownOutcome' });
    case 'TRY_AGAIN_PRESSED':
      if (s.phase !== 'unknownOutcome') return same(s);
      return {
        state: { ...s, phase: 'reloading', expectedLoad: 'register', reloadReason: 'retry' },
        effects: [{ type: 'ABORT_PENDING', before: s.generation + 1 }, { type: 'RELOAD_FRAME' }],
      };
    case 'RESULT_VERIFIED':
      if (s.phase !== 'verifyingResult' || e.generation !== s.generation) return same(s);
      return same({
        ...s,
        phase: e.differences.length === 0 ? 'done' : 'notVerified',
        result: { differences: e.differences, reference: e.reference, originalText: e.originalText },
      });

    case 'CANCEL_PRESSED':
      if (!CANCELLABLE.has(s.phase)) return same(s);
      return same({ ...s, phase: 'cancelConfirm', resumePhase: s.phase });
    case 'CANCEL_DECLINED':
      if (s.phase !== 'cancelConfirm' || !s.resumePhase) return same(s);
      return same({ ...s, phase: s.resumePhase, resumePhase: null });
    case 'CANCEL_CONFIRMED': {
      if (s.phase !== 'cancelConfirm') return same(s);
      const fresh = initialAgentState(s.interfaceLanguage);
      return {
        state: { ...fresh, generation: s.generation, expectedLoad: 'register', reloadReason: 'cancel', noticeAcknowledged: s.noticeAcknowledged },
        effects: [{ type: 'ABORT_PENDING', before: s.generation + 1 }, { type: 'CLEAR_SUBMIT_TIMER' }, { type: 'RELOAD_FRAME' }],
      };
    }
    case 'RELOAD_PRESSED':
      if (s.phase !== 'stopped') return same(s);
      return {
        state: { ...s, phase: 'idle', frame: 'none', keptAnswers: keepAnswers(s), fields: [], current: null, expectedLoad: 'register', reloadReason: 'stop', stopReason: null },
        effects: [{ type: 'ABORT_PENDING', before: s.generation + 1 }, { type: 'CLEAR_SUBMIT_TIMER' }, { type: 'RELOAD_FRAME' }],
      };
  }
}

const RESULT_EVENTS: ReadonlySet<AgentEvent['type']> = new Set(['MODEL_READY', 'EXTRACT_FAILED', 'PLAN_READY', 'ANALYSIS_FAILED', 'ACTION_DONE', 'ACTION_REJECTED', 'READ_BACK_DONE', 'SUBMIT_TIMEOUT', 'RESULT_VERIFIED']);

export function agentReducer(state: AgentState, event: AgentEvent): Step {
  // While the cancel question is open, results keep arriving for the interrupted phase.
  if (state.phase === 'cancelConfirm' && state.resumePhase && RESULT_EVENTS.has(event.type)) {
    const inner = reduce({ ...state, phase: state.resumePhase, resumePhase: null }, event);
    if (inner.state.phase === 'stopped') return inner;
    return { state: { ...inner.state, phase: 'cancelConfirm', resumePhase: inner.state.phase }, effects: inner.effects };
  }
  return reduce(state, event);
}
