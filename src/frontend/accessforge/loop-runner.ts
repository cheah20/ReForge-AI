/**
 * src/frontend/accessforge/loop-runner.ts
 *
 * accessforge-skeleton task 16.3 (Requirements 3.2, 3.3, 3.8 to 3.10, 5.1,
 * 6.1, 6.15, 8.4, 10.1, 10.8, 13.4, 13.8). Runs the agent-loop reducer's
 * effects against the Revival_Frame and feeds the results back as events.
 * `useAgentLoop` is a thin React wrapper around it; tests drive it with a
 * fake iframe.
 *
 * - Every frame load first passes `checkFrameDocument`; nothing else reads a
 *   document that failed it.
 * - The Revival_Generation goes up before every app-initiated load, right
 *   after the submit click, and on every `load` event; the AbortController
 *   of the old generation is aborted at once.
 * - Analysis replies are validated again in the browser (`validatePlan`).
 * - State is memory only: nothing is written to any browser storage.
 */

import { agentReducer, initialAgentState, type Wording, type AgentEvent, type AgentState, type Effect, type FramePage } from '../../lib/accessforge/agent-machine.js';
import { checkFrameDocument } from '../../lib/accessforge/allow-list.js';
import { parseElementId } from '../../lib/accessforge/element-id.js';
import { execute } from '../../lib/accessforge/executor.js';
import { extractPageModel } from '../../lib/accessforge/extract.js';
import { INITIAL_FRAME, nextGeneration, type FrameHandle } from '../../lib/accessforge/generation.js';
import { locate, pageVersionOf } from '../../lib/accessforge/locate.js';
import { validatePlan } from '../../lib/accessforge/plan-validator.js';
import { REVIVAL_FRAME_SRC } from '../../lib/accessforge/scope.js';
import { SUPPORTED_PAGE_VERSIONS } from '../../lib/accessforge/supported-versions.js';
import { compareReceived, parseConfirmation, readBack } from '../../lib/accessforge/verifier.js';
import { heuristicPlan } from '../../lib/accessforge/heuristic.js';
import type { PageAnalyzeRequest, PageAnalyzeResponse, PageRetranslateRequest, PageRetranslateResponse } from '../../shared/page-schemas.js';
import { ApiRequestError, type ApiReply } from '../api.js';

export const SUBMIT_TIMEOUT_MS = 15_000;

export interface LoopDeps {
  /** The Revival_Frame element, or null before it is mounted. */
  frame: () => HTMLIFrameElement | null;
  appOrigin: string;
  analyze: (request: PageAnalyzeRequest, options: { signal: AbortSignal }) => Promise<ApiReply<PageAnalyzeResponse>>;
  /** Slice 2 (Requirement 7.7): new wording in live and mock modes. Absent in tests that never switch language. */
  retranslate?: (request: PageRetranslateRequest, options: { signal: AbortSignal }) => Promise<ApiReply<PageRetranslateResponse>>;
  /** Slice 2 (Requirement 7.7): the saved plan for a version and language in cached mode. */
  cachedPlan?: (version: string, language: string, options: { signal: AbortSignal }) => Promise<ApiReply<PageAnalyzeResponse>>;
  /** Outline a written control in the frame (Requirement 8.5). */
  highlight?: (el: Element) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export type Listener = (state: AgentState) => void;

/** The page type of a loaded frame document; `not-allowed` when the Allow_List check fails. */
export function classifyFrame(frame: HTMLIFrameElement, appOrigin: string): { page: FramePage; versionSupported: boolean; failingNames: string[] } {
  const check = checkFrameDocument(frame, appOrigin);
  if (!check.ok) return { page: 'not-allowed', versionSupported: false, failingNames: [] };
  const page = check.entry.pageType;
  const doc = frame.contentDocument!;
  const versionSupported = page === 'register' ? check.pageVersion === SUPPORTED_PAGE_VERSIONS.register : page === 'home' ? check.pageVersion === SUPPORTED_PAGE_VERSIONS.home : false;
  const failingNames =
    page === 'error'
      ? Array.from(doc.querySelectorAll('ul.gagal li')).map((li) => (li.textContent ?? '').trim())
      : [];
  return { page, versionSupported, failingNames };
}

export class LoopRunner {
  private state: AgentState;
  private handle: FrameHandle = INITIAL_FRAME;
  private controller = new AbortController();
  private timer: unknown = null;
  private readonly listeners = new Set<Listener>();
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly deps: LoopDeps, language: string) {
    this.state = initialAgentState(language);
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  get(): AgentState {
    return this.state;
  }

  get generation(): number {
    return this.handle.generation;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  dispatch = (event: AgentEvent): void => {
    const step = agentReducer(this.state, event);
    if (step.state !== this.state) {
      this.state = step.state;
      for (const fn of this.listeners) fn(this.state);
    }
    for (const fx of step.effects) this.run(fx);
  };

  /** A new generation: the old one's requests are aborted and its effects become stale. */
  private advance(doc: Document | null): void {
    this.handle = nextGeneration(this.handle, doc);
    this.controller.abort();
    this.controller = new AbortController();
  }

  /** The iframe's `load` event. */
  onFrameLoad = (): void => {
    const frame = this.deps.frame();
    if (!frame) return;
    let doc: Document | null = null;
    try {
      doc = frame.contentDocument;
    } catch (e) {
      if (!(e instanceof DOMException)) throw e;
    }
    this.advance(doc);
    this.dispatch({ type: 'FRAME_LOADED', generation: this.handle.generation, ...classifyFrame(frame, this.deps.appOrigin) });
  };

  private live(): Document | null {
    try {
      return this.deps.frame()?.contentDocument ?? null;
    } catch (e) {
      if (e instanceof DOMException) return null;
      throw e;
    }
  }

  private run(fx: Effect): void {
    switch (fx.type) {
      case 'EXTRACT': {
        const doc = this.handle.generation === fx.generation ? this.handle.document : null;
        const version = doc ? pageVersionOf(doc) : null;
        const r = doc && version ? extractPageModel(doc, version) : ({ ok: false, code: 'UNREADABLE' } as const);
        this.dispatch(r.ok ? { type: 'MODEL_READY', generation: fx.generation, model: r.model } : { type: 'EXTRACT_FAILED', generation: fx.generation, code: r.code });
        return;
      }
      case 'ANALYZE': {
        const signal = this.controller.signal;
        const model = fx.model;
        this.deps
          .analyze({ pageModel: model, interfaceLanguage: fx.interfaceLanguage }, { signal })
          .then(
            (reply) => this.dispatch({ type: 'PLAN_READY', generation: fx.generation, analysisMode: reply.data.analysisMode, plan: validatePlan(model, reply.data.entries) }),
            (err: unknown) => {
              const code = err instanceof ApiRequestError ? err.code : 'NETWORK_ERROR';
              // An aborted request belongs to an old generation; its result is not wanted.
              if (code !== 'ABORTED') this.dispatch({ type: 'ANALYSIS_FAILED', generation: fx.generation, code });
            },
          );
        return;
      }
      case 'RETRANSLATE': {
        this.retranslate(fx);
        return;
      }
      case 'ABORT_PENDING':
        if (this.handle.generation < fx.before) this.advance(this.handle.document);
        return;
      case 'EXECUTE': {
        const { model, plan } = this.state;
        if (!model || !plan) return;
        const fieldId = fx.action.elementId.startsWith('f0:radio:') ? fx.action.elementId.split(':').slice(0, 3).join(':') : fx.action.elementId;
        const result = execute(fx.action, {
          frame: this.handle,
          actionGeneration: fx.generation,
          liveDocument: this.live(),
          appOrigin: this.deps.appOrigin,
          model,
          plan,
          submitArmed: fx.submitArmed,
          // The reducer emits the one click itself; it marks the submission done in the same step.
          submissionDone: false,
          consentGiven: fx.consentGiven,
        });
        if (fx.action.kind === 'click') {
          if (result.ok) this.advance(null);
          else this.dispatch({ type: 'ACTION_REJECTED', generation: fx.generation, elementId: fieldId, reason: result.reason });
          return;
        }
        if (result.ok) {
          const key = parseElementId(fx.action.elementId);
          const el = key && this.handle.document ? locate(this.handle.document, key)[0] : undefined;
          if (el) this.deps.highlight?.(el);
          this.dispatch({ type: 'ACTION_DONE', generation: fx.generation, elementId: fieldId });
        } else {
          this.dispatch({ type: 'ACTION_REJECTED', generation: fx.generation, elementId: fieldId, reason: result.reason });
        }
        return;
      }
      case 'READ_BACK': {
        const entry = this.state.model?.entries.find((e) => e.elementId === fx.elementId);
        if (!entry) return;
        this.dispatch({ type: 'READ_BACK_DONE', generation: fx.generation, elementId: fx.elementId, result: readBack(this.handle, fx.generation, entry, this.live()) });
        return;
      }
      case 'RELOAD_FRAME': {
        this.advance(null);
        const frame = this.deps.frame();
        if (frame) frame.src = REVIVAL_FRAME_SRC;
        return;
      }
      case 'START_SUBMIT_TIMER':
        if (this.timer !== null) this.clearTimer(this.timer);
        this.timer = this.setTimer(() => {
          this.timer = null;
          this.dispatch({ type: 'SUBMIT_TIMEOUT', attempt: fx.attempt });
        }, SUBMIT_TIMEOUT_MS);
        return;
      case 'CLEAR_SUBMIT_TIMER':
        if (this.timer !== null) this.clearTimer(this.timer);
        this.timer = null;
        return;
      case 'VERIFY_RESULT': {
        const doc = this.handle.generation === fx.generation ? this.handle.document : null;
        const read = (doc && parseConfirmation(doc)) ?? { reference: null, originalText: null, entries: [] };
        const differences = this.state.model ? compareReceived(read, fx.filled, this.state.model) : [];
        this.dispatch({ type: 'RESULT_VERIFIED', generation: fx.generation, differences, reference: read.reference, originalText: read.originalText });
        return;
      }
    }
  }

  /**
   * Slice 2 (Requirements 7.7, 7.9): new wording for the question texts. `live` and `mock` ask the
   * re-translation route with the existing wording only; `cached` reads the saved plan for the new
   * language and the same Page_Version; `heuristic` rebuilds the sentences from the locale files in the
   * browser. Any failure, or a result that does not cover every planned field, keeps the earlier wording.
   */
  private retranslate(fx: Extract<Effect, { type: 'RETRANSLATE' }>): void {
    const signal = this.controller.signal;
    const ok = (items: Wording[]) => this.dispatch({ type: 'RETRANSLATED', generation: fx.generation, language: fx.language, items });
    const fail = (err?: unknown) => {
      // An aborted request belongs to an old generation; its result is not wanted.
      if (err instanceof ApiRequestError && err.code === 'ABORTED') return;
      this.dispatch({ type: 'RETRANSLATE_FAILED', generation: fx.generation, language: fx.language });
    };
    const wanted = fx.items.map((i) => i.elementId);
    const pick = (source: ReadonlyMap<string, { humanLabel: string; question: string }>): Wording[] | null => {
      const out: Wording[] = [];
      for (const id of wanted) {
        const w = source.get(id);
        if (!w) return null;
        out.push({ elementId: id, humanLabel: w.humanLabel, question: w.question });
      }
      return out;
    };
    if (fx.mode === 'heuristic') {
      const picked = pick(new Map(heuristicPlan(fx.model, fx.language).map((p) => [p.elementId, p])));
      if (picked) ok(picked);
      else fail();
      return;
    }
    if (fx.mode === 'cached') {
      if (!this.deps.cachedPlan) return fail();
      this.deps.cachedPlan(fx.model.pageVersion, fx.language, { signal }).then((reply) => {
        const plan = validatePlan(fx.model, reply.data.entries);
        const picked = pick(plan.mapped);
        if (picked) ok(picked);
        else fail();
      }, fail);
      return;
    }
    if (!this.deps.retranslate) return fail();
    const request: PageRetranslateRequest = { targetLanguage: fx.language, items: fx.items.map((i) => ({ humanLabel: i.humanLabel, question: i.question })) };
    this.deps.retranslate(request, { signal }).then((reply) => {
      // The reply is matched by position, so a different count is unusable (Requirement 7.9).
      if (reply.data.items.length !== fx.items.length) return fail();
      ok(reply.data.items.map((w, i) => ({ elementId: fx.items[i]!.elementId, humanLabel: w.humanLabel, question: w.question })));
    }, fail);
  }

  /**
   * Slice 2 (Requirement 12.2): scrolls the frame to a do-it-yourself field on the
   * review screen and outlines it. It reads the frame and changes no value, so it
   * never counts as an Action. Returns false when the field cannot be shown now.
   */
  showField(elementId: string): boolean {
    if (this.state.phase !== 'review') return false;
    const doc = this.handle.document;
    if (!doc || doc !== this.live()) return false;
    const entry = this.state.model?.entries.find((e) => e.elementId === elementId);
    const key = entry ? parseElementId(entry.elementId) : null;
    if (!key) return false;
    const found = locate(doc, key);
    if (found.length !== 1) return false;
    this.deps.highlight?.(found[0]!);
    return true;
  }

  /** Stops timers and pending requests when the screen goes away. */
  dispose(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.controller.abort();
    this.listeners.clear();
  }
}
