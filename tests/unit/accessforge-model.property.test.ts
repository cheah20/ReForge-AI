// @vitest-environment jsdom
/**
 * tests/unit/accessforge-model.property.test.ts
 *
 * accessforge-skeleton tasks 27.11 and 27.12 (Slice 2): Property 16 (a
 * model-based test of the agent loop) and Property 17 (the Analysis_Mode names
 * the source of the plan). 100 runs each; fast-check prints the seed on failure.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { agentReducer, canConfirm, fieldById, needsConfidenceCheck, steps, type AgentEvent, type AgentState } from '../../src/lib/accessforge/agent-machine.js';
import { createHandler } from '../../src/worker/index.js';
import type { MirrorAnswer } from '../../src/lib/accessforge/transformations.js';
import { AiError, type AiProvider, type AiReply } from '../../src/lib/ai/interface.js';
import { pagePlanKey, type PagePlanStore } from '../../src/worker/cache/page-plan-cache.js';
import { PageAnalyzeResponseSchema } from '../../src/shared/page-schemas.js';
import type { LogEntry } from '../../src/worker/http.js';
import { MODEL, planFor } from './accessforge-helpers.js';
import { ANSWERS, TODAY, send, toFirstQuestion, type Run } from './accessforge-machine-helpers.js';

const RUNS = { numRuns: 100 };

// ---------------------------------------------------------------------------
// Property 16
// ---------------------------------------------------------------------------

type Op =
  | 'answer' | 'answerWrong' | 'back' | 'edit' | 'confirm' | 'cancel' | 'cancelYes' | 'cancelNo' | 'skip' | 'language' | 'timeout'
  | 'stale' | 'loadConfirmation' | 'loadError' | 'loadOther' | 'loadRegister' | 'tamperOn' | 'tamperOff' | 'tryAgain' | 'verified' | 'accept' | 'decline';

/** The events a user, the frame or a timer can plausibly produce in each phase, so the random walk goes deep instead of idling.
 */
const BY_PHASE: Record<string, Op[]> = {
  asking: ['answer', 'answer', 'answer', 'answer', 'answer', 'answer', 'accept', 'accept', 'decline', 'answerWrong', 'back', 'skip', 'language', 'cancel', 'stale', 'loadOther', 'tamperOn', 'tamperOff'],
  halted: ['answer', 'answer', 'tamperOff', 'back', 'cancel', 'stale'],
  review: ['confirm', 'confirm', 'confirm', 'confirm', 'confirm', 'edit', 'skip', 'cancel', 'language', 'timeout', 'tamperOn', 'tamperOff', 'loadOther', 'stale', 'loadRegister'],
  submitting: ['loadConfirmation', 'loadConfirmation', 'loadConfirmation', 'loadError', 'loadOther', 'timeout', 'stale', 'confirm'],
  verifyingResult: ['verified', 'verified', 'confirm', 'stale'],
  unknownOutcome: ['tryAgain', 'loadRegister', 'confirm', 'cancelYes'],
  cancelConfirm: ['cancelYes', 'cancelNo', 'answer', 'stale'],
};
const ANY: Op[] = ['loadRegister', 'confirm', 'answer', 'stale', 'language', 'tryAgain', 'cancelYes', 'cancelNo', 'cancel', 'verified', 'loadConfirmation', 'loadError', 'loadOther', 'back', 'skip', 'edit', 'timeout', 'accept', 'decline', 'tamperOn', 'tamperOff'];
const opFor = (phase: string, pick: number): Op => {
  const list = BY_PHASE[phase] ?? ANY;
  return list[pick % list.length]!;
};

const STALE_RESULTS = (gen: number, id: string): AgentEvent[] => [
  { type: 'ACTION_DONE', generation: gen, elementId: id },
  { type: 'READ_BACK_DONE', generation: gen, elementId: id, result: { kind: 'text', value: 'stale' } },
  { type: 'MODEL_READY', generation: gen, model: MODEL },
  { type: 'PLAN_READY', generation: gen, analysisMode: 'mock', plan: planFor() },
  { type: 'ANALYSIS_FAILED', generation: gen, code: 'AI_UNAVAILABLE' },
  { type: 'RESULT_VERIFIED', generation: gen, differences: [], reference: 'SR-DEMO-20261119-123456', originalText: null },
];

const clickCount = (r: Run) => r.effects.filter((e) => e.type === 'EXECUTE' && e.action.kind === 'click').length;

/** An answer of the right kind that the rules refuse (the screen never sends the wrong kind). */
function wrongAnswer(id: string): MirrorAnswer {
  const kind = ANSWERS[id]!.kind;
  if (kind === 'date') return { kind: 'date', parts: { day: '32', month: '13', year: '0' } };
  if (kind === 'consent') return { kind: 'consent', checked: false };
  if (kind === 'option') return { kind: 'option', value: 'ZZ-not-an-option' };
  return { kind: 'text', value: '' };
}

function eventFor(op: Op, s: AgentState, pick: number): AgentEvent | null {
  const gen = s.generation;
  const fieldIds = s.fields.map((f) => f.elementId);
  switch (op) {
    case 'answer':
      return s.current ? { type: 'NEXT_PRESSED', answer: ANSWERS[s.current]!, today: TODAY } : null;
    case 'answerWrong':
      return s.current ? { type: 'NEXT_PRESSED', answer: wrongAnswer(s.current), today: TODAY } : null;
    case 'back':
      return { type: 'BACK_PRESSED' };
    case 'edit':
      return fieldIds.length ? { type: 'EDIT_PRESSED', elementId: fieldIds[pick % fieldIds.length]! } : null;
    case 'confirm':
      return { type: 'CONFIRM_PRESSED' };
    case 'cancel':
      return { type: 'CANCEL_PRESSED' };
    case 'cancelYes':
      return { type: 'CANCEL_CONFIRMED' };
    case 'cancelNo':
      return { type: 'CANCEL_DECLINED' };
    case 'skip':
      return { type: 'SKIP_PRESSED' };
    case 'language':
      return { type: 'LANGUAGE_SET', language: ['en', 'ms', 'zh-Hans'][pick % 3]! };
    case 'timeout':
      return { type: 'SUBMIT_TIMEOUT', attempt: pick % 3 === 0 ? s.submitAttempt : s.submitAttempt - 1 };
    case 'stale':
      return null; // handled separately
    case 'loadConfirmation':
      return { type: 'FRAME_LOADED', generation: gen + 1, page: 'confirmation', versionSupported: false };
    case 'loadError':
      return { type: 'FRAME_LOADED', generation: gen + 1, page: 'error', versionSupported: false, failingNames: ['nama'] };
    case 'loadOther':
      return { type: 'FRAME_LOADED', generation: gen + 1, page: pick % 2 ? 'home' : 'not-allowed', versionSupported: false };
    case 'loadRegister':
      return { type: 'FRAME_LOADED', generation: gen + 1, page: 'register', versionSupported: true };
    case 'tamperOn':
    case 'tamperOff':
      return null; // handled separately
    case 'tryAgain':
      return { type: 'TRY_AGAIN_PRESSED' };
    case 'verified':
      return { type: 'RESULT_VERIFIED', generation: gen, differences: pick % 2 ? [] : [{ kind: 'reference', reference: null }], reference: 'SR-DEMO-20261119-123456', originalText: null };
    case 'accept':
      return { type: 'LOW_CONFIDENCE_ACCEPTED' };
    case 'decline':
      return { type: 'LOW_CONFIDENCE_DECLINED' };
  }
}

const sameState = (a: AgentState, b: AgentState) => JSON.stringify(a) === JSON.stringify(b);

// Feature: accessforge-skeleton, Property 16: One confirm press, at most one submit, no stale effects, and only verified fields count as filled
describe('Property 16: one confirm press, at most one submit, no stale effects, and only verified fields count as filled', () => {
  it('holds over random event sequences', () => {
    const seen = { reviews: 0, clicks: 0, stops: 0 };
    fc.assert(
      fc.property(fc.boolean(), fc.array(fc.record({ walk: fc.nat(1000), pick: fc.nat(20), wild: fc.nat(9) }), { minLength: 8, maxLength: 60 }), (happy, script) => {
        let r = toFirstQuestion();
        // Half of the walks start at the review screen, so submission and its failure paths are reached often.
        if (happy) {
          for (let i = 0; i < 20 && r.state.phase === 'asking'; i++) r = send(r, { type: 'NEXT_PRESSED', answer: ANSWERS[r.state.current!]!, today: TODAY });
        }
        for (const { walk, pick, wild } of script) {
          // One step in ten is any event at all, whatever the phase.
          const op = wild === 0 ? ANY[walk % ANY.length]! : opFor(r.state.phase, walk);
          const before = r.state;
          const staleBefore = before.generation;

          if (op === 'tamperOn') {
            r.frame.tamper = (_id, v) => (typeof v === 'string' ? `${v}!` : v === true ? false : v);
            continue;
          }
          if (op === 'tamperOff') {
            r.frame.tamper = null;
            continue;
          }
          if (op === 'stale') {
            if (staleBefore < 1) continue;
            const id = before.fields[pick % Math.max(1, before.fields.length)]?.elementId ?? 'f0:text:nama';
            for (const ev of STALE_RESULTS(staleBefore - 1, id)) {
              const step = agentReducer(before, ev);
              expect(sameState(step.state, before), `a result of an older generation changed the state: ${ev.type}`).toBe(true);
              expect(step.effects).toEqual([]);
            }
            continue;
          }

          const event = eventFor(op, before, pick);
          if (!event) continue;
          const tampered = r.frame.tamper !== null;
          r = send(r, event);
          const after = r.state;
          if (after.phase === 'review') seen.reviews++;
          if (after.phase === 'stopped') seen.stops++;

          // A submit click: only after a confirm press made in the review state, with consent given and nothing pending or in mismatch.
          const clicks = clickCount(r);
          seen.clicks += clicks;
          expect(clicks).toBeLessThanOrEqual(1);
          if (clicks > 0) {
            expect(event.type).toBe('CONFIRM_PRESSED');
            expect(before.phase).toBe('review');
            expect(canConfirm(before)).toEqual({ ok: true });
            expect(before.submissionDone || before.confirmationReceived).toBe(false);
            // Every mapped field read back equal to its Intended_Value at that moment.
            expect(tampered).toBe(false);
            for (const f of before.fields.filter((x) => x.status === 'filled')) {
              expect(r.frame.values.get(f.elementId)).toEqual(f.intended);
            }
          }
          // No click while a submission is in progress or after a confirmation.
          if (before.submissionDone || before.confirmationReceived) expect(clicks).toBe(0);

          // A language change never changes answers, the step or statuses.
          if (event.type === 'LANGUAGE_SET') {
            expect(JSON.stringify(after.fields)).toBe(JSON.stringify(before.fields));
            expect(after.current).toBe(before.current);
            expect(after.phase).toBe(before.phase);
          }

          // A stopped loop (a disallowed or wrong-stage load) emits no Action until the user acts again.
          if (event.type === 'FRAME_LOADED' && after.phase === 'stopped') {
            expect(r.effects.filter((e) => e.type === 'EXECUTE')).toEqual([]);
          }

          // `filled` means the latest read-back equals the Intended_Value (checked right after a user answer, without tampering).
          if (!tampered && (event.type === 'NEXT_PRESSED' || event.type === 'SKIP_PRESSED') && after.phase !== 'halted') {
            for (const f of after.fields) {
              if (f.status === 'filled' && f.intended !== undefined && r.frame.values.has(f.elementId)) {
                expect(r.frame.values.get(f.elementId), `filled field ${f.elementId} differs from the frame`).toEqual(f.intended);
              }
            }
          }
          // An answer that would leave the open step never leaves a low-confidence step unchecked.
          if (after.current) {
            const field = fieldById(after, after.current);
            if (field && needsConfidenceCheck(field)) expect(steps(after)).toContain(after.current);
          }
        }
      }),
      RUNS,
    );
    // The run is not vacuous: it reached the review screen, clicked and stopped.
    expect(seen.reviews).toBeGreaterThan(0);
    expect(seen.clicks).toBeGreaterThan(0);
    expect(seen.stops).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Property 17
// ---------------------------------------------------------------------------

const ROUTE = '/api/pages/analyze';
type Outcome = 'valid' | 'invalid' | 'timeout' | 'quota' | 'rateLimit' | 'other';
const OUTCOMES: Outcome[] = ['valid', 'invalid', 'timeout', 'quota', 'rateLimit', 'other'];

const planEntry = (elementId: string) => ({ elementId, humanLabel: 'Label', question: 'Question?', answerType: 'text', confidence: 0.9 });
const VALID_REPLY = { entries: [planEntry('f0:text:nama'), planEntry('f0:text:nokp')] };

function reply(o: Outcome): unknown | AiError {
  switch (o) {
    case 'valid':
      return VALID_REPLY;
    case 'invalid':
      return { entries: 'x' };
    case 'timeout':
      return new AiError('AI_TIMEOUT', 'x');
    case 'quota':
      return new AiError('AI_QUOTA', 'x');
    case 'rateLimit':
      return new AiError('AI_RATE_LIMITED', 'x');
    case 'other':
      return new AiError('AI_UNAVAILABLE', 'x');
  }
}

function scripted(kind: 'real' | 'mock', script: Outcome[]): AiProvider & { calls: number } {
  const p = {
    kind,
    calls: 0,
    async analyzePage(): Promise<AiReply> {
      const next = reply(script[Math.min(p.calls++, script.length - 1)]!);
      if (next instanceof AiError) throw next;
      return { value: next, usage: { model: 'test-model', promptTokens: 1, completionTokens: 1, durationMs: 1 } };
    },
    retranslatePage: () => Promise.reject(new Error('unused')),
    analyze: () => Promise.reject(new Error('unused')),
    retranslate: () => Promise.reject(new Error('unused')),
    translate: () => Promise.reject(new Error('unused')),
    analyzeLabels: () => Promise.reject(new Error('unused')),
  };
  return p;
}

const cachedPlan = (version: string, lang: string) => ({ pageVersion: version, interfaceLanguage: lang, entries: [{ ...planEntry('f0:text:nama'), humanLabel: 'Cached name' }] });

// Feature: accessforge-skeleton, Property 17: The Analysis_Mode always names the source of the plan
describe('Property 17: the Analysis_Mode always names the source of the plan', () => {
  it('follows the decision table, retries exactly when the first attempt was invalid or timed out, and never uses another version or language', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<'real' | 'mock'>('real', 'mock'),
        fc.array(fc.constantFrom(...OUTCOMES), { minLength: 2, maxLength: 2 }),
        fc.constantFrom<'none' | 'exact' | 'otherVersion' | 'otherLanguage'>('none', 'exact', 'otherVersion', 'otherLanguage'),
        fc.constantFrom('en', 'zh-Hans'),
        async (kind, outcomes, cache, language) => {
          const provider = scripted(kind, outcomes);
          const otherLanguage = language === 'en' ? 'zh-Hans' : 'en';
          const store: PagePlanStore =
            cache === 'exact'
              ? { [pagePlanKey(MODEL.pageVersion, language)]: cachedPlan(MODEL.pageVersion, language) }
              : cache === 'otherVersion'
                ? { [pagePlanKey('b'.repeat(64), language)]: cachedPlan('b'.repeat(64), language) }
                : cache === 'otherLanguage'
                  ? { [pagePlanKey(MODEL.pageVersion, otherLanguage)]: cachedPlan(MODEL.pageVersion, otherLanguage) }
                  : {};
          const logs: LogEntry[] = [];
          const handler = createHandler({ provider, logger: (e) => logs.push(e), requestId: () => 'req', now: () => 1, pagePlans: store });
          const res = await handler.fetch(
            new Request(`https://reforge.example${ROUTE}`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' },
              body: JSON.stringify({ pageModel: MODEL, interfaceLanguage: language }),
            }),
            {},
          );

          const [first, second] = outcomes as [Outcome, Outcome];
          const retried = first === 'invalid' || first === 'timeout';
          expect(provider.calls).toBe(retried ? 2 : 1);
          const success = first === 'valid' || (retried && second === 'valid');

          if (success) {
            expect(res.status).toBe(200);
            const r = PageAnalyzeResponseSchema.parse(await res.json());
            expect(r.analysisMode).toBe(kind === 'mock' ? 'mock' : 'live');
            expect(logs[0]?.servedFromCache).toBeUndefined();
            return;
          }
          if (kind === 'mock') {
            expect(res.status).toBe(500);
            return;
          }
          expect(res.status).toBe(200);
          const r = PageAnalyzeResponseSchema.parse(await res.json());
          if (cache === 'exact') {
            expect(r.analysisMode).toBe('cached');
            expect(r.entries[0]?.humanLabel).toBe('Cached name');
            expect(logs[0]?.servedFromCache).toBe(true);
          } else {
            expect(r.analysisMode).toBe('heuristic');
            expect(r.entries.some((e) => e.humanLabel === 'Cached name')).toBe(false);
            expect(logs[0]?.errorCode).toBe('AI_FALLBACK_HEURISTIC');
          }
        },
      ),
      RUNS,
    );
  });
});
