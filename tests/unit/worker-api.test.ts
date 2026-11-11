/**
 * tests/unit/worker-api.test.ts
 *
 * Tasks 12, 15.3 and 16.3: the Worker routes end to end with the mock provider.
 * Covers status codes, body limits, rate limiting, the fixture cache fallback,
 * the shared error shape, and that logs never contain form content.
 * Validates: Requirements 5.1, 5.5a, 5.8, 8.6, 11.1, 12.1, 12.5, 12.6, 12.7
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { createHandler, AI_MODE_HEADER, providerFor, type Env } from '../../src/worker/index.js';
import { MockAiProvider } from '../../src/lib/ai/mock.js';
import { AiError, type AiProvider } from '../../src/lib/ai/interface.js';
import { extractFields } from '../../src/lib/pdf-extract/index.js';
import { cacheKey, bundledStore, lookupFixtureCache } from '../../src/worker/cache/fixture-cache.js';
import { AnalyzeResponseSchema, ApiErrorSchema } from '../../src/shared/schemas.js';
import type { LogEntry } from '../../src/worker/http.js';
import type { FieldEvidence } from '../../src/shared/types.js';

let clinic: { fields: FieldEvidence[]; hash: string };
beforeAll(async () => {
  const r = await extractFields(new Uint8Array(readFileSync('fixtures/clinic-registration.pdf')));
  if (!r.ok) throw new Error('fixture');
  clinic = { fields: r.fields, hash: r.fileHash };
});

const CANARY = 'PRIVATE_CANARY_5Z1';

function setup(opts: { provider?: AiProvider; env?: Env; cache?: Record<string, unknown> } = {}) {
  const logs: LogEntry[] = [];
  const handler = createHandler({
    provider: opts.provider ?? new MockAiProvider(),
    ...(opts.cache ? { cache: opts.cache } : {}),
    logger: (e) => logs.push(e),
    requestId: () => 'req-1',
    now: () => 1000,
  });
  const env: Env = opts.env ?? {};
  const call = (path: string, body?: unknown, init: RequestInit = {}) =>
    handler.fetch(
      new Request(`https://reforge.example${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' },
        ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
        ...init,
      }),
      env,
    );
  return { call, logs, handler, env };
}

const analyzeBody = (overrides: Record<string, unknown> = {}) => ({
  contentHash: clinic.hash,
  fields: clinic.fields,
  interfaceLanguage: 'zh-Hans',
  ...overrides,
});

async function expectError(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  const body = await res.json();
  expect(ApiErrorSchema.safeParse(body).success).toBe(true);
  expect((body as { error: { code: string } }).error.code).toBe(code);
}

describe('POST /api/forms/analyze', () => {
  it('returns a valid analysis for the clinic form and marks it as mock', async () => {
    const { call, logs } = setup();
    const res = await call('/api/forms/analyze', analyzeBody());
    expect(res.status).toBe(200);
    expect(res.headers.get(AI_MODE_HEADER)).toBe('mock');
    const body = AnalyzeResponseSchema.parse(await res.json());
    expect(body.fields).toHaveLength(22);
    expect(logs).toEqual([
      expect.objectContaining({ requestId: 'req-1', route: '/api/forms/analyze', status: 200, aiMode: 'mock', attempts: 1 }),
    ]);
  });

  it('rejects a request that fails the schema with 400 and names only paths', async () => {
    const { call } = setup();
    const res = await call('/api/forms/analyze', analyzeBody({ contentHash: `${CANARY}` }));
    await expectError(res.clone(), 400, 'BAD_REQUEST');
    expect(await res.text()).not.toContain(CANARY);
  });

  it('rejects invalid JSON with 400', async () => {
    await expectError(await setup().call('/api/forms/analyze', '{not json'), 400, 'INVALID_JSON');
  });

  it('rejects an unsupported interface language', async () => {
    await expectError(await setup().call('/api/forms/analyze', analyzeBody({ interfaceLanguage: 'xx' })), 400, 'UNSUPPORTED_LANGUAGE');
  });

  it('rejects a body over 32 KB with 413, with or without a content-length header', async () => {
    const big = JSON.stringify(analyzeBody({ padding: 'x'.repeat(33 * 1024) }));
    await expectError(await setup().call('/api/forms/analyze', big), 413, 'PAYLOAD_TOO_LARGE');
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(big));
        c.close();
      },
    });
    const res = await setup().call('/api/forms/analyze', undefined, { body: stream, duplex: 'half' } as RequestInit);
    await expectError(res, 413, 'PAYLOAD_TOO_LARGE');
  });

  it('applies the per-IP rate limit after validation', async () => {
    const keys: string[] = [];
    const env: Env = { RATE_LIMITER_ANALYZE: { limit: async ({ key }) => (keys.push(key), { success: false }) } };
    await expectError(await setup({ env }).call('/api/forms/analyze', analyzeBody()), 429, 'RATE_LIMITED');
    expect(keys).toEqual(['/api/forms/analyze:203.0.113.7']);
  });

  it('serves the fixture cache when the AI quota is exhausted', async () => {
    const cached = {
      fields: [{ fieldId: 'Text1', humanLabel: 'IC', question: 'IC?', answerType: 'ic', confidence: 0.9 }],
      formLanguage: 'ms',
      formLanguageConfidence: 0.9,
      formCountry: 'MY',
      formCountryConfidence: 0.9,
    };
    const quota = {
      kind: 'real',
      analyze: async () => {
        throw new AiError('AI_QUOTA', 'quota');
      },
    } as unknown as AiProvider;
    const { call, logs } = setup({ provider: quota, cache: { [cacheKey(clinic.hash, 'zh-Hans')]: cached } });
    const res = await call('/api/forms/analyze', analyzeBody());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...cached, servedFromCache: true });
    expect(logs[0]).toMatchObject({ servedFromCache: true, status: 200 });
  });

  it('answers 503 without a cache hit, 504 on timeout, and 503 for other AI failures', async () => {
    const failing = (code: AiError['code']): AiProvider =>
      ({ kind: 'real', analyze: async () => Promise.reject(new AiError(code, 'x')) }) as unknown as AiProvider;
    await expectError(await setup({ provider: failing('AI_QUOTA'), cache: {} }).call('/api/forms/analyze', analyzeBody()), 503, 'AI_UNAVAILABLE');
    await expectError(await setup({ provider: failing('AI_TIMEOUT'), cache: {} }).call('/api/forms/analyze', analyzeBody()), 504, 'AI_TIMEOUT');
    await expectError(await setup({ provider: failing('AI_UNAVAILABLE'), cache: {} }).call('/api/forms/analyze', analyzeBody()), 503, 'AI_UNAVAILABLE');
  });

  it('turns an unexpected exception into 500 INTERNAL_ERROR without leaking its message', async () => {
    const broken = { kind: 'real', analyze: async () => Promise.reject(new TypeError(CANARY)) } as unknown as AiProvider;
    const res = await setup({ provider: broken }).call('/api/forms/analyze', analyzeBody());
    await expectError(res.clone(), 500, 'INTERNAL_ERROR');
    expect(await res.text()).not.toContain(CANARY);
  });

  it('never logs request content', async () => {
    const { call, logs } = setup();
    const fields = clinic.fields.map((f, i) => (i === 0 ? { ...f, tooltip: CANARY } : f));
    await call('/api/forms/analyze', analyzeBody({ fields }));
    await call('/api/forms/translate', { text: CANARY, sourceLanguage: 'es', targetLanguage: 'en' });
    await call('/api/forms/analyze', analyzeBody({ interfaceLanguage: CANARY }));
    expect(logs).toHaveLength(3);
    expect(JSON.stringify(logs)).not.toContain(CANARY);
    for (const entry of logs) {
      expect(Object.keys(entry).every((k) =>
        ['requestId', 'route', 'status', 'durationMs', 'errorCode', 'aiMode', 'model', 'attempts', 'promptTokens', 'completionTokens', 'neurons', 'servedFromCache'].includes(k),
      )).toBe(true);
    }
  });
});

describe('POST /api/forms/retranslate and /api/forms/translate', () => {
  it('retranslates labels and questions only', async () => {
    const res = await setup().call('/api/forms/retranslate', {
      contentHash: clinic.hash,
      targetLanguage: 'ms',
      fields: [{ fieldId: 'Text1', humanLabel: 'IC number', question: 'What is your IC number?' }],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      fields: [{ fieldId: 'Text1', humanLabel: 'No. Kad Pengenalan', question: 'Apakah nombor kad pengenalan (MyKad) anda?' }],
    });
  });

  it('translates a description answer', async () => {
    const res = await setup().call('/api/forms/translate', {
      text: 'Tengo tos desde hace dos días.',
      sourceLanguage: 'es',
      targetLanguage: 'en',
    });
    expect(await res.json()).toEqual({ translation: 'I have had a cough for two days.' });
  });

  it('validates both bodies', async () => {
    await expectError(await setup().call('/api/forms/translate', { text: '', sourceLanguage: 'es', targetLanguage: 'en' }), 400, 'BAD_REQUEST');
    await expectError(await setup().call('/api/forms/translate', { text: 'a', sourceLanguage: 'es', targetLanguage: 'xx' }), 400, 'UNSUPPORTED_LANGUAGE');
    await expectError(await setup().call('/api/forms/retranslate', { contentHash: clinic.hash, targetLanguage: 'ms', fields: [] }), 400, 'BAD_REQUEST');
  });

  it('rejects a translate body over 16 KB', async () => {
    const res = await setup().call('/api/forms/translate', { text: 'x'.repeat(17 * 1024), sourceLanguage: 'es', targetLanguage: 'en' });
    await expectError(res, 413, 'PAYLOAD_TOO_LARGE');
  });

  // Task 16.4 (d)
  it('retranslate rejects an unsupported target language and a body over 48 KB', async () => {
    const field = { fieldId: 'Text1', humanLabel: 'IC number', question: 'What is your IC number?' };
    await expectError(
      await setup().call('/api/forms/retranslate', { contentHash: clinic.hash, targetLanguage: 'xx', fields: [field] }),
      400,
      'UNSUPPORTED_LANGUAGE',
    );
    const big = JSON.stringify({ contentHash: clinic.hash, targetLanguage: 'ms', fields: [field], padding: 'x'.repeat(49 * 1024) });
    await expectError(await setup().call('/api/forms/retranslate', big), 413, 'PAYLOAD_TOO_LARGE');
    // Just under the limit is read and validated, not rejected for size.
    const fits = JSON.stringify({ contentHash: clinic.hash, targetLanguage: 'ms', fields: [field], padding: 'x'.repeat(47 * 1024) });
    expect((await setup().call('/api/forms/retranslate', fits)).status).toBe(200);
  });

  // Task 16.4 (b), requirement 11.3
  it('neither route logs request text, labels, questions or the reply', async () => {
    const { call, logs } = setup();
    const translated = await call('/api/forms/translate', { text: `Saya batuk ${CANARY}`, sourceLanguage: 'ms', targetLanguage: 'en' });
    const retranslated = await call('/api/forms/retranslate', {
      contentHash: clinic.hash,
      targetLanguage: 'ms',
      fields: [{ fieldId: 'Text1', humanLabel: `Label ${CANARY}`, question: `Question ${CANARY}?` }],
    });
    expect(translated.status).toBe(200);
    expect(retranslated.status).toBe(200);
    // The canary really went through: the mock echoes unknown text into its reply.
    expect(JSON.stringify(await translated.json())).toContain(CANARY);
    expect(logs.map((l) => l.route)).toEqual(['/api/forms/translate', '/api/forms/retranslate']);
    expect(JSON.stringify(logs)).not.toContain(CANARY);
    const allowed = ['requestId', 'route', 'status', 'durationMs', 'errorCode', 'aiMode', 'model', 'attempts', 'promptTokens', 'completionTokens', 'neurons', 'servedFromCache'];
    for (const entry of logs) expect(Object.keys(entry).every((k) => allowed.includes(k))).toBe(true);
  });

  // Task 16.4 (c)
  describe('error mapping', () => {
    const failing = (code: AiError['code']): AiProvider =>
      ({
        kind: 'real',
        translate: async () => Promise.reject(new AiError(code, CANARY)),
        retranslate: async () => Promise.reject(new AiError(code, CANARY)),
      }) as unknown as AiProvider;
    /** Replies that never pass the schema: the route retries once, then gives up. */
    let invalidCalls = 0;
    const invalid = (): AiProvider =>
      ({
        kind: 'real',
        translate: async () => (invalidCalls++, { value: { nope: 1 }, usage: { model: 'm' } }),
        retranslate: async () => (invalidCalls++, { value: { nope: 1 }, usage: { model: 'm' } }),
      }) as unknown as AiProvider;

    const calls: Array<[string, unknown]> = [
      ['/api/forms/translate', { text: 'a', sourceLanguage: 'es', targetLanguage: 'en' }],
      ['/api/forms/retranslate', { contentHash: 'c'.repeat(64), targetLanguage: 'ms', fields: [{ fieldId: 'a', humanLabel: 'A', question: 'A?' }] }],
    ];

    it.each(calls)('%s: timeout is 504, other AI failures are 503, and the message never carries the error text', async (route, body) => {
      await expectError(await setup({ provider: failing('AI_TIMEOUT') }).call(route, body), 504, 'AI_TIMEOUT');
      for (const code of ['AI_QUOTA', 'AI_RATE_LIMITED', 'AI_UNAVAILABLE'] as const) {
        const res = await setup({ provider: failing(code) }).call(route, body);
        expect(await res.clone().text()).not.toContain(CANARY);
        await expectError(res, 503, 'AI_UNAVAILABLE');
      }
    });

    it.each(calls)('%s: two invalid replies give 503 after exactly one retry', async (route, body) => {
      invalidCalls = 0;
      const { call, logs } = setup({ provider: invalid() });
      await expectError(await call(route, body), 503, 'AI_UNAVAILABLE');
      expect(invalidCalls).toBe(2);
      expect(logs[0]).toMatchObject({ route, status: 503, errorCode: 'AI_UNAVAILABLE' });
    });
  });
});

describe('rate limits (task 16.4 a; design: Common Worker behaviours)', () => {
  /** wrangler.jsonc with comments removed. */
  const wrangler = JSON.parse(
    readFileSync('wrangler.jsonc', 'utf8')
      .split('\n')
      .map((l) => l.replace(/^\s*\/\/.*$/, ''))
      .join('\n'),
  ) as { ratelimits: Array<{ name: string; namespace_id: string; simple: { limit: number; period: number } }> };

  it('configures 20 per minute for analysis and 60 per minute for translation, in separate namespaces', () => {
    const byName = Object.fromEntries(wrangler.ratelimits.map((r) => [r.name, r]));
    expect(byName['RATE_LIMITER_ANALYZE']?.simple).toEqual({ limit: 20, period: 60 });
    expect(byName['RATE_LIMITER_TRANSLATE']?.simple).toEqual({ limit: 60, period: 60 });
    expect(new Set(wrangler.ratelimits.map((r) => r.namespace_id)).size).toBe(wrangler.ratelimits.length);
  });

  it('counts each route with its own binding, keyed by route and IP', async () => {
    const seen: string[] = [];
    const limiter = (name: string) => ({ limit: async ({ key }: { key: string }) => (seen.push(`${name} ${key}`), { success: true }) });
    const env: Env = { RATE_LIMITER_ANALYZE: limiter('analyze'), RATE_LIMITER_TRANSLATE: limiter('translate') };
    const { call } = setup({ env });
    await call('/api/forms/analyze', analyzeBody());
    await call('/api/forms/translate', { text: 'a', sourceLanguage: 'es', targetLanguage: 'en' });
    await call('/api/forms/retranslate', { contentHash: clinic.hash, targetLanguage: 'ms', fields: [{ fieldId: 'Text1', humanLabel: 'IC', question: 'IC?' }] });
    expect(seen).toEqual([
      'analyze /api/forms/analyze:203.0.113.7',
      'translate /api/forms/translate:203.0.113.7',
      'translate /api/forms/retranslate:203.0.113.7',
    ]);
  });

  it('a full translation limit does not block analysis', async () => {
    const env: Env = {
      RATE_LIMITER_ANALYZE: { limit: async () => ({ success: true }) },
      RATE_LIMITER_TRANSLATE: { limit: async () => ({ success: false }) },
    };
    const { call } = setup({ env });
    await expectError(await call('/api/forms/translate', { text: 'a', sourceLanguage: 'es', targetLanguage: 'en' }), 429, 'RATE_LIMITED');
    expect((await call('/api/forms/analyze', analyzeBody())).status).toBe(200);
  });
});

describe('routing', () => {
  it('answers 405 with Allow: POST for other methods', async () => {
    const res = await setup().call('/api/forms/analyze', undefined, { method: 'GET' });
    await expectError(res.clone(), 405, 'METHOD_NOT_ALLOWED');
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('answers unknown API paths with a JSON 404, never the SPA', async () => {
    const env: Env = { ASSETS: { fetch: async () => new Response('<html>spa</html>') } };
    await expectError(await setup({ env }).call('/api/nope', {}), 404, 'NOT_FOUND');
  });

  it('serves every other path from the static assets', async () => {
    const env: Env = { ASSETS: { fetch: async (r) => new Response(`asset ${new URL(r.url).pathname}`) } };
    const res = await setup({ env }).handler.fetch(new Request('https://reforge.example/review'), env);
    expect(await res.text()).toBe('asset /review');
  });
});

describe('provider selection (decision 11)', () => {
  const binding = { run: async () => ({}) };
  it('uses the mock unless AI_MODE is real and the binding exists', () => {
    expect(providerFor({}).kind).toBe('mock');
    expect(providerFor({ AI: binding }).kind).toBe('mock');
    expect(providerFor({ AI: binding, AI_MODE: 'real' }).kind).toBe('real');
  });
});

describe('fixture cache lookup', () => {
  const valid = { fields: [], formLanguage: 'ms', formLanguageConfidence: 1, formCountry: 'MY', formCountryConfidence: 1 };

  it('returns a cached analysis marked servedFromCache, or null', () => {
    const store = { [cacheKey('a'.repeat(64), 'ms')]: valid };
    expect(lookupFixtureCache('a'.repeat(64), 'ms', store)).toEqual({ ...valid, servedFromCache: true });
    expect(lookupFixtureCache('a'.repeat(64), 'en', store)).toBeNull();
  });

  it('ignores malformed hashes and invalid stored files', () => {
    expect(lookupFixtureCache('../etc', 'ms', { '../etc-ms': valid })).toBeNull();
    expect(lookupFixtureCache('b'.repeat(64), 'ms', { [cacheKey('b'.repeat(64), 'ms')]: { fields: 'bad' } })).toBeNull();
  });

  it('keys bundled files by their file name', () => {
    expect(Object.keys(bundledStore({ './precomputed/abc-zh-Hans.json': valid }))).toEqual(['abc-zh-Hans']);
  });
});
