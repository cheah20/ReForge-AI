// @vitest-environment jsdom
/**
 * tests/unit/accessforge-retranslate.test.ts
 *
 * accessforge-skeleton task 25.6 (Slice 2): language switching after analysis.
 * - POST /api/pages/retranslate: an item count that differs from the request
 *   counts as an invalid reply; 503 and 504 error codes; bad bodies never reach
 *   the provider; the log carries allowed fields only.
 * - GET /api/pages/cached-plan: bundled plans only, 404 when none exists, no provider call.
 * - The Mirror keeps the earlier wording on every error code, makes no page-analysis
 *   request in `cached` and `heuristic` mode, and sends no canary value.
 * Validates: Requirements 7.7, 7.9, 13.1, 13.10
 */
import { describe, it, expect, vi } from 'vitest';
import { createHandler } from '../../src/worker/index.js';
import { AiError, type AiProvider, type AiReply } from '../../src/lib/ai/interface.js';
import { MockAiProvider } from '../../src/lib/ai/mock.js';
import { pagePlanKey, type PagePlanStore } from '../../src/worker/cache/page-plan-cache.js';
import { PageAnalyzeResponseSchema, PageRetranslateResponseSchema, type PageAnalyzeRequest, type PageAnalyzeResponse, type PageRetranslateRequest } from '../../src/shared/page-schemas.js';
import { ApiErrorSchema } from '../../src/shared/schemas.js';
import type { LogEntry } from '../../src/worker/http.js';
import { LoopRunner, type LoopDeps } from '../../src/frontend/accessforge/loop-runner.js';
import { ApiRequestError, type ApiReply } from '../../src/frontend/api.js';
import { fieldById, needsConfidenceCheck, type AgentState, type MirrorField } from '../../src/lib/accessforge/agent-machine.js';
import { TEMPLATES } from '../../src/worker/legacy/generated/templates.js';
import { fill } from '../../src/worker/legacy/render.js';
import { MODEL } from './accessforge-helpers.js';
import { ANSWERS, TODAY } from './accessforge-machine-helpers.js';

const ALLOWED_LOG_KEYS = ['requestId', 'route', 'status', 'durationMs', 'errorCode', 'aiMode', 'model', 'attempts', 'promptTokens', 'completionTokens', 'neurons', 'servedFromCache'];
const ORIGIN = window.location.origin;
const USAGE = { model: 'test-model', promptTokens: 1, completionTokens: 1, durationMs: 1 };

function provider(script: Array<unknown | AiError>): AiProvider & { retranslateCalls: number; analyzeCalls: number } {
  const p = {
    kind: 'real' as const,
    retranslateCalls: 0,
    analyzeCalls: 0,
    async retranslatePage(): Promise<AiReply> {
      const next = script[Math.min(p.retranslateCalls++, script.length - 1)];
      if (next instanceof AiError) throw next;
      return { value: next, usage: USAGE };
    },
    async analyzePage(): Promise<AiReply> {
      p.analyzeCalls++;
      throw new Error('the cached-plan route must not call the provider');
    },
    analyze: () => Promise.reject(new Error('unused')),
    retranslate: () => Promise.reject(new Error('unused')),
    translate: () => Promise.reject(new Error('unused')),
    analyzeLabels: () => Promise.reject(new Error('unused')),
  };
  return p;
}

function api(p: AiProvider, pagePlans?: PagePlanStore) {
  const logs: LogEntry[] = [];
  const handler = createHandler({ provider: p, logger: (e) => logs.push(e), requestId: () => 'req-1', now: () => 1000, ...(pagePlans ? { pagePlans } : {}) });
  const send = (path: string, init: RequestInit = {}) =>
    handler.fetch(new Request(`https://reforge.example${path}`, { headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' }, ...init }), {});
  return { send, logs };
}
const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
const REQUEST: PageRetranslateRequest = {
  targetLanguage: 'ms',
  items: [
    { humanLabel: 'Full name', question: 'What is your full name?' },
    { humanLabel: 'IC number', question: 'What is your IC number?' },
  ],
};
const GOOD = { items: [{ humanLabel: 'Nama penuh', question: 'Apakah nama penuh anda?' }, { humanLabel: 'No. KP', question: 'Apakah nombor KP anda?' }] };

describe('POST /api/pages/retranslate', () => {
  it('returns the items of a valid reply in request order', async () => {
    const { send } = api(provider([GOOD]));
    const res = await send('/api/pages/retranslate', post(REQUEST));
    expect(res.status).toBe(200);
    expect(PageRetranslateResponseSchema.parse(await res.json()).items.map((i) => i.humanLabel)).toEqual(['Nama penuh', 'No. KP']);
  });

  it('counts a reply with fewer or more items as invalid, retries once, then answers 503', async () => {
    for (const bad of [{ items: GOOD.items.slice(0, 1) }, { items: [...GOOD.items, GOOD.items[0]] }]) {
      const p = provider([bad]);
      const res = await api(p).send('/api/pages/retranslate', post(REQUEST));
      expect(res.status).toBe(503);
      expect(ApiErrorSchema.parse(await res.json()).error.code).toBe('AI_UNAVAILABLE');
      expect(p.retranslateCalls).toBe(2);
    }
  });

  it('recovers when the second attempt is valid', async () => {
    const p = provider([{ items: [] }, GOOD]);
    const res = await api(p).send('/api/pages/retranslate', post(REQUEST));
    expect(res.status).toBe(200);
    expect(p.retranslateCalls).toBe(2);
  });

  it('answers 504 on a timeout and 503 on quota, without retrying a quota failure', async () => {
    const slow = provider([new AiError('AI_TIMEOUT', 'x')]);
    const timeout = await api(slow).send('/api/pages/retranslate', post(REQUEST));
    expect(timeout.status).toBe(504);
    expect(ApiErrorSchema.parse(await timeout.json()).error.code).toBe('AI_TIMEOUT');
    expect(slow.retranslateCalls).toBe(2);
    const quota = provider([new AiError('AI_QUOTA', 'x')]);
    const res = await api(quota).send('/api/pages/retranslate', post(REQUEST));
    expect(res.status).toBe(503);
    expect(quota.retranslateCalls).toBe(1);
  });

  it('rejects a body with a Page_Model, an Element_Id or no items before any provider call', async () => {
    const p = provider([GOOD]);
    const { send } = api(p);
    const bodies = [
      { ...REQUEST, pageModel: MODEL },
      { targetLanguage: 'ms', items: [{ ...REQUEST.items[0], elementId: 'f0:text:nama' }] },
      { targetLanguage: 'ms', items: [] },
      { items: REQUEST.items },
    ];
    for (const b of bodies) {
      const res = await send('/api/pages/retranslate', post(b));
      expect(res.status, JSON.stringify(Object.keys(b))).toBe(400);
    }
    expect(p.retranslateCalls).toBe(0);
  });

  it('rejects an unknown language and a GET', async () => {
    const p = provider([GOOD]);
    const { send } = api(p);
    expect((await send('/api/pages/retranslate', post({ ...REQUEST, targetLanguage: 'xx-unknown' }))).status).toBe(400);
    const get = await send('/api/pages/retranslate', { method: 'GET' });
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
    expect(p.retranslateCalls).toBe(0);
  });

  it('logs allowed fields only', async () => {
    const { send, logs } = api(provider([GOOD]));
    await send('/api/pages/retranslate', post(REQUEST));
    expect(logs).toHaveLength(1);
    expect(Object.keys(logs[0]!).filter((k) => !ALLOWED_LOG_KEYS.includes(k))).toEqual([]);
    expect(JSON.stringify(logs)).not.toContain('Full name');
    expect(logs[0]).toMatchObject({ route: '/api/pages/retranslate', status: 200, attempts: 1 });
  });
});

describe('GET /api/pages/cached-plan', () => {
  const plan = (lang: string) => ({
    pageVersion: MODEL.pageVersion,
    interfaceLanguage: lang,
    entries: [{ elementId: 'f0:text:nama', humanLabel: 'Nama', question: 'Apakah nama anda?', answerType: 'text', confidence: 0.9 }],
  });
  const STORE: PagePlanStore = { [pagePlanKey(MODEL.pageVersion, 'ms')]: plan('ms') };
  const url = (version: string, lang: string) => `/api/pages/cached-plan?version=${version}&lang=${lang}`;

  it('returns the saved plan for exactly that version and language, with no provider call', async () => {
    const p = provider([GOOD]);
    const { send, logs } = api(p, STORE);
    const res = await send(url(MODEL.pageVersion, 'ms'));
    expect(res.status).toBe(200);
    const body = PageAnalyzeResponseSchema.parse(await res.json());
    expect(body.analysisMode).toBe('cached');
    expect(body.entries.map((e) => e.question)).toEqual(['Apakah nama anda?']);
    expect(p.analyzeCalls + p.retranslateCalls).toBe(0);
    expect(logs[0]).toMatchObject({ servedFromCache: true });
  });

  it('answers 404 for another language or another version, 400 for a bad query, 405 for a POST', async () => {
    const { send } = api(provider([GOOD]), STORE);
    expect((await send(url(MODEL.pageVersion, 'zh-Hans'))).status).toBe(404);
    expect((await send(url('0'.repeat(64), 'ms'))).status).toBe(404);
    expect((await send(url('not-a-version', 'ms'))).status).toBe(400);
    expect((await send('/api/pages/cached-plan')).status).toBe(400);
    expect((await send(`${url(MODEL.pageVersion, 'ms')}&extra=1`)).status).toBe(400);
    const wrong = await send(url(MODEL.pageVersion, 'ms'), { method: 'POST', body: '{}' });
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get('allow')).toBe('GET');
  });
});

// ---------------------------------------------------------------------------
// The Mirror
// ---------------------------------------------------------------------------
const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');
class FakeFrame {
  doc: Document | null = null;
  url = new URL('/legacy/register', ORIGIN);
  src = '';
  get contentDocument() {
    return this.doc;
  }
  get contentWindow() {
    return { location: this.url };
  }
}
const mock = new MockAiProvider();
async function mockAnalyze(request: PageAnalyzeRequest, mode: PageAnalyzeResponse['analysisMode']): Promise<ApiReply<PageAnalyzeResponse>> {
  const reply = await mock.analyzePage({ request, interfaceLanguageName: request.interfaceLanguage });
  return { data: { analysisMode: mode, entries: (reply.value as { entries: PageAnalyzeResponse['entries'] }).entries }, aiMode: 'mock' };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

async function started(mode: PageAnalyzeResponse['analysisMode'], extra: Partial<LoopDeps> = {}) {
  const analyze = vi.fn((request: PageAnalyzeRequest) => mockAnalyze(request, mode));
  const frame = new FakeFrame();
  frame.doc = parse(fill(TEMPLATES.register, {}));
  const runner = new LoopRunner({ frame: () => frame as unknown as HTMLIFrameElement, appOrigin: ORIGIN, analyze, setTimer: () => 0, clearTimer: () => {}, ...extra }, 'en');
  runner.onFrameLoad();
  runner.dispatch({ type: 'REVIVE_PRESSED' });
  runner.dispatch({ type: 'NOTICE_ACKNOWLEDGED' });
  await flush();
  return { runner, frame, analyze };
}

/** Everything the language switch must leave alone. */
function frozen(s: AgentState) {
  return {
    phase: s.phase,
    current: s.current,
    mode: s.analysisMode,
    fields: s.fields.map((f: MirrorField) => ({ id: f.elementId, status: f.status, answer: f.answer, intended: f.intended, type: f.plan?.answerType, confidence: f.plan?.confidence })),
  };
}
const wording = (s: AgentState) => s.fields.flatMap((f) => (f.plan ? [`${f.plan.humanLabel}|${f.plan.question}`] : []));
function answerFirst(runner: LoopRunner) {
  const s = runner.get();
  if (needsConfidenceCheck(fieldById(s, s.current!)!)) runner.dispatch({ type: 'LOW_CONFIDENCE_ACCEPTED' });
  runner.dispatch({ type: 'NEXT_PRESSED', answer: ANSWERS[runner.get().current!]!, today: TODAY });
}

describe('the Mirror after a language switch', () => {
  it('live and mock mode: new wording only, from a request that carries wording and language', async () => {
    const bodies: PageRetranslateRequest[] = [];
    const retranslate: NonNullable<LoopDeps['retranslate']> = async (request) => {
      bodies.push(request);
      const reply = await mock.retranslatePage({ request, targetLanguageName: 'Simplified Chinese' });
      return { data: reply.value as { items: PageRetranslateRequest['items'] }, aiMode: 'mock' };
    };
    const { runner, analyze } = await started('mock', { retranslate });
    answerFirst(runner);
    const before = frozen(runner.get());
    const oldWording = wording(runner.get());
    runner.dispatch({ type: 'LANGUAGE_SET', language: 'zh-Hans' });
    expect(runner.get().translating).toBe(true);
    await flush();
    const after = runner.get();
    expect(frozen(after)).toEqual(before);
    expect(wording(after)).not.toEqual(oldWording);
    expect(after.fields.filter((f) => f.plan).every((f) => f.wordingLanguage === 'zh-Hans')).toBe(true);
    expect(after.translating).toBe(false);
    expect(after.translateFailed).toBe(false);
    expect(bodies).toHaveLength(1);
    expect(Object.keys(bodies[0]!).sort()).toEqual(['items', 'targetLanguage']);
    expect(bodies[0]!.items.map((i) => Object.keys(i).sort())).toEqual(bodies[0]!.items.map(() => ['humanLabel', 'question']));
    expect(analyze).toHaveBeenCalledTimes(1);
  });

  it.each(['AI_UNAVAILABLE', 'AI_TIMEOUT', 'RATE_LIMITED', 'NETWORK_ERROR', 'INVALID_RESPONSE', 'PAYLOAD_TOO_LARGE'])('keeps the earlier wording, its language and every answer on %s', async (code) => {
    const { runner } = await started('mock', { retranslate: () => Promise.reject(new ApiRequestError(code)) });
    answerFirst(runner);
    const before = frozen(runner.get());
    const oldWording = wording(runner.get());
    runner.dispatch({ type: 'LANGUAGE_SET', language: 'ms' });
    await flush();
    const after = runner.get();
    expect(wording(after)).toEqual(oldWording);
    expect(after.fields.filter((f) => f.plan).every((f) => f.wordingLanguage === 'en')).toBe(true);
    expect(frozen(after)).toEqual(before);
    expect(after.translateFailed).toBe(true);
    expect(after.translating).toBe(false);
  });

  it('keeps the earlier wording when the reply has a different item count', async () => {
    const { runner } = await started('mock', { retranslate: async () => ({ data: { items: [{ humanLabel: 'a', question: 'b' }] }, aiMode: null }) });
    const oldWording = wording(runner.get());
    runner.dispatch({ type: 'LANGUAGE_SET', language: 'ms' });
    await flush();
    expect(wording(runner.get())).toEqual(oldWording);
    expect(runner.get().translateFailed).toBe(true);
  });

  it('cached mode: reads the saved plan for the new language and runs no new page analysis', async () => {
    const cachedPlan = vi.fn(async (_version: string, language: string, _o: { signal: AbortSignal }): Promise<ApiReply<PageAnalyzeResponse>> => {
      const reply = await mock.analyzePage({ request: { pageModel: runnerModel(), interfaceLanguage: language }, interfaceLanguageName: language });
      return { data: { analysisMode: 'cached', entries: (reply.value as { entries: PageAnalyzeResponse['entries'] }).entries }, aiMode: null };
    });
    const retranslate = vi.fn();
    const { runner, analyze } = await started('cached', { cachedPlan, retranslate: retranslate as unknown as NonNullable<LoopDeps['retranslate']> });
    function runnerModel() {
      return runner.get().model!;
    }
    const before = frozen(runner.get());
    runner.dispatch({ type: 'LANGUAGE_SET', language: 'ms' });
    await flush();
    expect(cachedPlan).toHaveBeenCalledTimes(1);
    expect(cachedPlan.mock.calls[0]!.slice(0, 2)).toEqual([runner.get().model!.pageVersion, 'ms']);
    expect(retranslate).not.toHaveBeenCalled();
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(frozen(runner.get())).toEqual(before);
    expect(runner.get().fields.filter((f) => f.plan).every((f) => f.wordingLanguage === 'ms')).toBe(true);
  });

  it('cached mode: no saved plan for the new language keeps the earlier wording and tells the user', async () => {
    const cachedPlan = vi.fn(() => Promise.reject(new ApiRequestError('NOT_FOUND')));
    const { runner, analyze } = await started('cached', { cachedPlan });
    const oldWording = wording(runner.get());
    runner.dispatch({ type: 'LANGUAGE_SET', language: 'ta' });
    await flush();
    expect(wording(runner.get())).toEqual(oldWording);
    expect(runner.get().translateFailed).toBe(true);
    expect(analyze).toHaveBeenCalledTimes(1);
  });

  it('heuristic mode: rebuilds the questions in the browser with no network call', async () => {
    const retranslate = vi.fn();
    const cachedPlan = vi.fn();
    const { runner, analyze } = await started('heuristic', { retranslate: retranslate as unknown as NonNullable<LoopDeps['retranslate']>, cachedPlan: cachedPlan as unknown as NonNullable<LoopDeps['cachedPlan']> });
    const before = frozen(runner.get());
    const oldQuestions = runner.get().fields.flatMap((f) => (f.plan ? [f.plan.question] : []));
    runner.dispatch({ type: 'LANGUAGE_SET', language: 'ms' });
    const after = runner.get();
    expect(retranslate).not.toHaveBeenCalled();
    expect(cachedPlan).not.toHaveBeenCalled();
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(after.translateFailed).toBe(false);
    expect(frozen(after)).toEqual(before);
    expect(after.fields.flatMap((f) => (f.plan ? [f.plan.question] : []))).not.toEqual(oldQuestions);
  });

  it('switching back to the language the wording is already in sends nothing', async () => {
    const retranslate = vi.fn();
    const { runner } = await started('mock', { retranslate: retranslate as unknown as NonNullable<LoopDeps['retranslate']> });
    runner.dispatch({ type: 'LANGUAGE_SET', language: 'en' });
    expect(retranslate).not.toHaveBeenCalled();
    expect(runner.get().translating).toBe(false);
  });

  it('ignores an answer that arrives for a page load that has since replaced the document', async () => {
    let release: (v: ApiReply<{ items: PageRetranslateRequest['items'] }>) => void = () => {};
    const retranslate: NonNullable<LoopDeps['retranslate']> = () => new Promise((resolve) => (release = resolve));
    const { runner, frame } = await started('mock', { retranslate });
    const oldWording = wording(runner.get());
    runner.dispatch({ type: 'LANGUAGE_SET', language: 'ms' });
    frame.doc = parse(fill(TEMPLATES.register, {}));
    runner.onFrameLoad();
    release({ data: { items: runner.get().fields.filter((f) => f.plan).map(() => ({ humanLabel: 'x', question: 'y' })) }, aiMode: null });
    await flush();
    expect(wording(runner.get())).toEqual(oldWording);
  });

  it('sends neither the typed answer nor the value typed into the old page (canary)', async () => {
    const ANSWER = 'ANSWER_CANARY_77Q';
    const FRAME = 'FRAME_CANARY_41Z';
    const bodies: string[] = [];
    const retranslate: NonNullable<LoopDeps['retranslate']> = async (request) => {
      bodies.push(JSON.stringify(request));
      const reply = await mock.retranslatePage({ request, targetLanguageName: 'Malay' });
      return { data: reply.value as { items: PageRetranslateRequest['items'] }, aiMode: 'mock' };
    };
    const { runner, frame } = await started('mock', { retranslate });
    (frame.doc!.querySelector('input[name="nokp"]') as HTMLInputElement).value = FRAME;
    runner.dispatch({ type: 'NEXT_PRESSED', answer: { kind: 'text', value: ANSWER }, today: TODAY });
    // The canaries really are in the state and in the page.
    expect(JSON.stringify(runner.get().fields.map((f) => f.answer))).toContain(ANSWER);
    expect(frame.doc!.documentElement.innerHTML.length).toBeGreaterThan(0);
    expect((frame.doc!.querySelector('input[name="nokp"]') as HTMLInputElement).value).toBe(FRAME);
    runner.dispatch({ type: 'LANGUAGE_SET', language: 'ms' });
    await flush();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toContain(ANSWER);
    expect(bodies[0]).not.toContain(FRAME);
  });
});
