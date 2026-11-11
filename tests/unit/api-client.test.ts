/**
 * tests/unit/api-client.test.ts
 *
 * Browser API client: replies are schema-checked, errors keep only the code.
 * Validates: Requirements 5.4, 12.4 (demo mode flag from the Worker header)
 */

import { describe, it, expect } from 'vitest';
import { ApiRequestError, createApiClient } from '../../src/frontend/api.js';
import { createHandler } from '../../src/worker/index.js';
import { MockAiProvider } from '../../src/lib/ai/mock.js';

const HASH = 'c'.repeat(64);
const goodAnalyze = {
  fields: [{ fieldId: 'a', humanLabel: 'Name', question: 'What is your name?', answerType: 'text', confidence: 0.9 }],
  formLanguage: 'ms',
  formLanguageConfidence: 0.9,
  formCountry: 'MY',
  formCountryConfidence: 0.9,
};
const request = {
  contentHash: HASH,
  interfaceLanguage: 'en',
  fields: [
    {
      fieldId: 'a',
      fieldType: 'text' as const,
      required: false,
      readOnly: false,
      hasValue: false,
      widgets: [{ pageNumber: 1, bbox: { left: 0, top: 10, right: 10, bottom: 0 }, pageSnippet: 'Nama' }],
    },
  ],
};

function respond(body: unknown, status = 200, headers: Record<string, string> = {}) {
  const calls: Array<{ input: string; init: RequestInit }> = [];
  const fetchFn = async (input: string, init: RequestInit) => {
    calls.push({ input, init });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
  };
  return { client: createApiClient(fetchFn), calls };
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ApiRequestError) return err.code;
    throw err;
  }
  throw new Error('expected a rejection');
}

describe('createApiClient', () => {
  it('posts JSON to the analyze route and returns the parsed reply with the AI mode header', async () => {
    const { client, calls } = respond(goodAnalyze, 200, { 'x-reforge-ai-mode': 'mock' });
    const reply = await client.analyze(request);
    expect(reply).toEqual({ data: goodAnalyze, aiMode: 'mock' });
    expect(calls[0]!.input).toBe('/api/forms/analyze');
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual(request);
  });

  it('uses the retranslate and translate routes', async () => {
    const r = respond({ fields: [] });
    await r.client.retranslate({ contentHash: HASH, targetLanguage: 'ms', fields: [{ fieldId: 'a', humanLabel: 'N', question: 'Q?' }] });
    expect(r.calls[0]!.input).toBe('/api/forms/retranslate');
    const t = respond({ translation: 'Sakit kepala' });
    expect((await t.client.translate({ text: 'headache', sourceLanguage: 'en', targetLanguage: 'ms' })).data).toEqual({
      translation: 'Sakit kepala',
    });
    expect(t.calls[0]!.input).toBe('/api/forms/translate');
  });

  it('keeps only the error code from the shared error shape', async () => {
    const { client } = respond({ error: { code: 'AI_TIMEOUT', message: 'took too long' } }, 504);
    expect(await codeOf(client.analyze(request))).toBe('AI_TIMEOUT');
  });

  it('rejects a reply that does not match the schema instead of passing it to the UI', async () => {
    const { client } = respond({ ...goodAnalyze, formLanguageConfidence: 3 });
    expect(await codeOf(client.analyze(request))).toBe('INVALID_RESPONSE');
  });

  it('reports an error reply without the shared shape as INVALID_RESPONSE', async () => {
    const { client } = respond({ oops: true }, 500);
    expect(await codeOf(client.analyze(request))).toBe('INVALID_RESPONSE');
  });

  it('reports a non-JSON success body as INVALID_RESPONSE', async () => {
    const { client } = respond('<html>', 200);
    expect(await codeOf(client.analyze(request))).toBe('INVALID_RESPONSE');
  });

  it('reports a failed connection as NETWORK_ERROR', async () => {
    const client = createApiClient(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await codeOf(client.analyze(request))).toBe('NETWORK_ERROR');
  });

  it('works against the real Worker handler with the mock provider', async () => {
    const handler = createHandler({ provider: new MockAiProvider(), logger: () => {} });
    const client = createApiClient((input, init) => handler.fetch(new Request(`https://app.test${input}`, init), {}));
    const reply = await client.analyze(request);
    expect(reply.aiMode).toBe('mock');
    expect(reply.data.fields.map((f) => f.fieldId)).toEqual(['a']);
  });
});
