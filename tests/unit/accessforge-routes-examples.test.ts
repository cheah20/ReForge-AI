// @vitest-environment jsdom
/**
 * tests/unit/accessforge-routes-examples.test.ts
 *
 * accessforge-skeleton task 13.8: POST /api/pages/analyze through the Worker
 * handler with a scripted fake provider and an injected page-plan cache.
 * Validates: Requirements 6.3, 6.10, 7.1, 7.2, 7.8, 7.10, 13.5, 13.6, 13.11
 */

import { describe, it, expect } from 'vitest';
import { createHandler, providerFor, type Env } from '../../src/worker/index.js';
import { AiError, type AiProvider, type AiReply } from '../../src/lib/ai/interface.js';
import { MockAiProvider } from '../../src/lib/ai/mock.js';
import { pagePlanKey, type PagePlanStore } from '../../src/worker/cache/page-plan-cache.js';
import { PageAnalyzeResponseSchema, type PageModel } from '../../src/shared/page-schemas.js';
import { ApiErrorSchema } from '../../src/shared/schemas.js';
import type { LogEntry } from '../../src/worker/http.js';
import { MODEL } from './accessforge-helpers.js';

const ROUTE = '/api/pages/analyze';
const CANARY = 'PAGE_CANARY_8K3';
const ALLOWED_LOG_KEYS = ['requestId', 'route', 'status', 'durationMs', 'errorCode', 'aiMode', 'model', 'attempts', 'promptTokens', 'completionTokens', 'neurons', 'servedFromCache'];

const entry = (elementId: string, over: Record<string, unknown> = {}) => ({ elementId, humanLabel: 'Label', question: 'Question?', answerType: 'text', confidence: 0.9, ...over });
const VALID_REPLY = { entries: [entry('f0:text:nama'), entry('f0:text:nokp', { answerType: 'ic' }), entry('f0:submit:'), entry('f0:text:unknown')] };

function scripted(kind: 'real' | 'mock', script: Array<unknown | AiError>): AiProvider & { calls: number } {
  const p = {
    kind,
    calls: 0,
    async analyzePage(): Promise<AiReply> {
      const next = script[Math.min(p.calls++, script.length - 1)];
      if (next instanceof AiError) throw next;
      return { value: next, usage: { model: 'test-model', promptTokens: 10, completionTokens: 5, durationMs: 1 } };
    },
    retranslatePage: () => Promise.reject(new Error('unused')),
    analyze: () => Promise.reject(new Error('unused')),
    retranslate: () => Promise.reject(new Error('unused')),
    translate: () => Promise.reject(new Error('unused')),
    analyzeLabels: () => Promise.reject(new Error('unused')),
  };
  return p;
}

function setup(provider: AiProvider, opts: { env?: Env; pagePlans?: PagePlanStore } = {}) {
  const logs: LogEntry[] = [];
  const handler = createHandler({ provider, logger: (e) => logs.push(e), requestId: () => 'req-1', now: () => 1000, ...(opts.pagePlans ? { pagePlans: opts.pagePlans } : {}) });
  const call = (body: unknown) =>
    handler.fetch(
      new Request(`https://reforge.example${ROUTE}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
      opts.env ?? {},
    );
  return { call, logs };
}

const body = (over: Record<string, unknown> = {}, model: PageModel = MODEL) => ({ pageModel: model, interfaceLanguage: 'en', ...over });

const cachedPlan = (version: string, lang: string) => ({
  pageVersion: version,
  interfaceLanguage: lang,
  entries: [entry('f0:text:nama', { humanLabel: 'Cached name' }), entry('f0:select:tujuan', { answerType: 'ic', confidence: 0.8 })],
});
const STORE: PagePlanStore = { [pagePlanKey(MODEL.pageVersion, 'en')]: cachedPlan(MODEL.pageVersion, 'en') };

async function errorOf(res: Response) {
  return ApiErrorSchema.parse(await res.json()).error;
}

describe('decision table, Slice 1 rows', () => {
  it('mock provider, valid reply: mock mode with the validated plan', async () => {
    const { call } = setup(scripted('mock', [VALID_REPLY]));
    const res = await call(body());
    expect(res.status).toBe(200);
    const r = PageAnalyzeResponseSchema.parse(await res.json());
    expect(r.analysisMode).toBe('mock');
    expect(r.entries.map((e) => e.elementId)).toEqual(['f0:text:nama', 'f0:text:nokp']);
  });

  it('mock provider, invalid twice: 500 INTERNAL_ERROR, no mode claimed', async () => {
    const p = scripted('mock', [{ bad: 1 }]);
    const res = await setup(p, { pagePlans: STORE }).call(body());
    expect(res.status).toBe(500);
    expect((await errorOf(res)).code).toBe('INTERNAL_ERROR');
    expect(p.calls).toBe(2);
  });

  it('real provider, valid reply: live mode', async () => {
    const r = PageAnalyzeResponseSchema.parse(await (await setup(scripted('real', [VALID_REPLY])).call(body())).json());
    expect(r.analysisMode).toBe('live');
  });

  it('real provider fails: cached mode with the precomputed plan, validated against the submitted model', async () => {
    const { call, logs } = setup(scripted('real', [new AiError('AI_QUOTA', 'x')]), { pagePlans: STORE });
    const res = await call(body());
    expect(res.status).toBe(200);
    const r = PageAnalyzeResponseSchema.parse(await res.json());
    expect(r.analysisMode).toBe('cached');
    expect(r.entries[0]?.humanLabel).toBe('Cached name');
    // The incompatible type in the cached plan was replaced, confidence 0.
    expect(r.entries[1]).toMatchObject({ elementId: 'f0:select:tujuan', answerType: 'dropdown', confidence: 0 });
    expect(logs[0]).toMatchObject({ servedFromCache: true, status: 200 });
  });

  it('real provider fails and no cached plan matches: the heuristic plan, logged with a fixed code (Slice 2 row)', async () => {
    const { call, logs } = setup(scripted('real', [new AiError('AI_UNAVAILABLE', 'x')]), { pagePlans: {} });
    const res = await call(body());
    expect(res.status).toBe(200);
    const r = PageAnalyzeResponseSchema.parse(await res.json());
    expect(r.analysisMode).toBe('heuristic');
    expect(r.entries.length).toBeGreaterThan(0);
    expect(r.entries.every((e) => e.confidence === 0)).toBe(true);
    expect(logs[0]).toMatchObject({ status: 200, errorCode: 'AI_FALLBACK_HEURISTIC' });
    expect(logs[0]?.servedFromCache).toBeUndefined();
    // The log names no field, label or question.
    expect(JSON.stringify(logs[0])).not.toMatch(/nama|nokp|Label|question/i);
  });

  it('never uses a cached plan for another version or language: the heuristic plan instead', async () => {
    const other: PagePlanStore = {
      [pagePlanKey('b'.repeat(64), 'en')]: cachedPlan('b'.repeat(64), 'en'),
      [pagePlanKey(MODEL.pageVersion, 'zh-Hant')]: cachedPlan(MODEL.pageVersion, 'zh-Hant'),
    };
    const res = await setup(scripted('real', [new AiError('AI_TIMEOUT', 'x')]), { pagePlans: other }).call(body({ interfaceLanguage: 'zh-Hans' }));
    expect(res.status).toBe(200);
    const r = PageAnalyzeResponseSchema.parse(await res.json());
    expect(r.analysisMode).toBe('heuristic');
    expect(r.entries.some((e) => e.humanLabel === 'Cached name')).toBe(false);
  });
});

describe('retries', () => {
  it.each([
    ['an invalid reply', { entries: 'x' }],
    ['a timeout', new AiError('AI_TIMEOUT', 'x')],
  ])('retries exactly once after %s', async (_label, first) => {
    const p = scripted('real', [first, VALID_REPLY]);
    const { call, logs } = setup(p);
    expect((await call(body())).status).toBe(200);
    expect(p.calls).toBe(2);
    expect(logs[0]?.attempts).toBe(2);
  });

  it('does not retry after quota', async () => {
    const p = scripted('real', [new AiError('AI_QUOTA', 'x'), VALID_REPLY]);
    await setup(p, { pagePlans: {} }).call(body());
    expect(p.calls).toBe(1);
  });
});

describe('request validation', () => {
  it.each([
    ['an extra property', () => body({ extra: 1 })],
    ['51 entries', () => body({}, { ...MODEL, entries: Array.from({ length: 51 }, (_, i) => ({ ...MODEL.entries[0]!, elementId: `f0:text:n${i}`, name: `n${i}`, position: i })) })],
    ['a bad Page_Version', () => body({}, { ...MODEL, pageVersion: 'XYZ' })],
  ])('rejects %s with 400, schema paths only and no provider call', async (_label, make) => {
    const p = scripted('real', [VALID_REPLY]);
    const b = make();
    const withCanary = JSON.parse(JSON.stringify(b).replace('"Nama*"', `"${CANARY}"`));
    const res = await setup(p).call(withCanary);
    expect(res.status).toBe(400);
    const err = await errorOf(res);
    expect(err.code).toBe('BAD_REQUEST');
    expect(err.message).not.toContain(CANARY);
    expect(p.calls).toBe(0);
  });

  it('rejects an unsupported language with UNSUPPORTED_LANGUAGE and no provider call', async () => {
    const p = scripted('real', [VALID_REPLY]);
    const res = await setup(p).call(body({ interfaceLanguage: 'xx-Fake' }));
    expect((await errorOf(res)).code).toBe('UNSUPPORTED_LANGUAGE');
    expect(p.calls).toBe(0);
  });

  it('rejects a body over 48 KB with 413 before parsing', async () => {
    const p = scripted('real', [VALID_REPLY]);
    const res = await setup(p).call('x'.repeat(48 * 1024 + 1));
    expect(res.status).toBe(413);
    expect(p.calls).toBe(0);
  });
});

describe('logging and rate limiting', () => {
  it('logs only the allowed items and never page text', async () => {
    const model: PageModel = { ...MODEL, entries: MODEL.entries.map((e) => ({ ...e, neighbourText: CANARY })) };
    const { call, logs } = setup(scripted('real', [VALID_REPLY]));
    await call(body({}, model));
    expect(logs).toHaveLength(1);
    for (const key of Object.keys(logs[0]!)) expect(ALLOWED_LOG_KEYS).toContain(key);
    expect(JSON.stringify(logs)).not.toContain(CANARY);
    expect(logs[0]).toMatchObject({ route: ROUTE, status: 200, model: 'test-model', attempts: 1 });
  });

  it('is counted by RATE_LIMITER_ANALYZE with key route:ip and answers 429 when it is full', async () => {
    const keys: string[] = [];
    const env: Env = {
      RATE_LIMITER_ANALYZE: { limit: async ({ key }) => (keys.push(key), { success: false }) },
      RATE_LIMITER_TRANSLATE: { limit: async () => ({ success: true }) },
    };
    const p = scripted('real', [VALID_REPLY]);
    const res = await setup(p, { env }).call(body());
    expect(res.status).toBe(429);
    expect((await errorOf(res)).code).toBe('RATE_LIMITED');
    expect(keys).toEqual([`${ROUTE}:203.0.113.7`]);
    expect(p.calls).toBe(0);
  });

  it('is not blocked by a full RATE_LIMITER_TRANSLATE', async () => {
    const env: Env = {
      RATE_LIMITER_ANALYZE: { limit: async () => ({ success: true }) },
      RATE_LIMITER_TRANSLATE: { limit: async () => ({ success: false }) },
    };
    expect((await setup(scripted('real', [VALID_REPLY]), { env }).call(body())).status).toBe(200);
  });

  it('resolves the mock provider in the default test environment', () => {
    expect(providerFor({})).toBeInstanceOf(MockAiProvider);
  });

  it('answers end to end with the real mock provider in mock mode', async () => {
    const res = await setup(new MockAiProvider()).call(body({ interfaceLanguage: 'zh-Hans' }));
    const r = PageAnalyzeResponseSchema.parse(await res.json());
    expect(r.analysisMode).toBe('mock');
    expect(r.entries).toHaveLength(8);
  });
});
