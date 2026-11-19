/**
 * tests/unit/document-label-client.test.ts
 *
 * The label analysis client (formbridge-any-document task 11.2) against the
 * real Worker handler with the mock provider, and against scripted failures:
 * batches one after another, partial and total failure, no retry here, and
 * results that carry codes only.
 * Validates: Requirements 13.8, 13.11, 14.1
 */

import { describe, it, expect, vi } from 'vitest';
import { createHandler } from '../../src/worker/index.js';
import { MockAiProvider } from '../../src/lib/ai/mock.js';
import { analyzeKeptLabels, ANALYZE_LABELS_PATH, type FetchFn } from '../../src/frontend/document/label-client.js';
import { buildLabelAnalysisRequests } from '../../src/lib/document/request.js';
import type { KeptLabelItem } from '../../src/lib/document/review.js';

const kept = (n: number, text = (i: number) => `Label ${i}:`): KeptLabelItem[] =>
  Array.from({ length: n }, (_, i) => ({ labelId: `p1-l${i}`, text: text(i), pageNumber: 1, readingOrder: i }));
const requests = (n: number, text?: (i: number) => string) => buildLabelAnalysisRequests(kept(n, text), { interfaceLanguage: 'en' });

function workerFetch(): FetchFn {
  const handler = createHandler({ provider: new MockAiProvider(), logger: () => {} });
  return (input, init) => handler.fetch(new Request(`https://app.test${input}`, init), {});
}

const errorResponse = (status: number, code: string) => new Response(JSON.stringify({ error: { code, message: 'x' } }), { status });

describe('against the real Worker with the mock provider', () => {
  it('sends the batches in order and returns one analysis per label, with the mock banner and the detection', async () => {
    const reqs = requests(61);
    const seen: Array<[number, number]> = [];
    const result = await analyzeKeptLabels(reqs, workerFetch(), (b, t) => seen.push([b, t]));
    expect(seen).toEqual([[1, 3], [2, 3], [3, 3]]);
    if (result.mode !== 'ai') throw new Error('expected ai');
    expect(result.analyses.size).toBe(61);
    expect(result.failedLabelIds).toEqual([]);
    expect(result.demoMode).toBe(true);
    expect(result.detection.formCountry).toBe('MY');
    expect(result.analyses.get('p1-l3')!.fieldId).toBe('p1-l3');
  });

  it('posts only the request body the builder made, to the label route', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const inner = workerFetch();
    const spy: FetchFn = (url, init) => (calls.push({ url, body: JSON.parse(String(init.body)) }), inner(url, init));
    const reqs = requests(2);
    await analyzeKeptLabels(reqs, spy);
    expect(calls).toEqual([{ url: ANALYZE_LABELS_PATH, body: reqs[0] }]);
  });
});

describe('failures (13.8, 14.1)', () => {
  it.each([
    ['a network error', () => Promise.reject(new TypeError('offline')), 'network'],
    ['a timeout', () => Promise.resolve(errorResponse(504, 'AI_TIMEOUT')), 'timeout'],
    ['a used-up quota', () => Promise.resolve(errorResponse(429, 'RATE_LIMITED')), 'quota'],
    ['the AI being unavailable', () => Promise.resolve(errorResponse(503, 'AI_UNAVAILABLE')), 'unavailable'],
    ['a reply that is not JSON', () => Promise.resolve(new Response('<html>', { status: 200 })), 'unavailable'],
    ['a reply that fails the schema', () => Promise.resolve(new Response(JSON.stringify({ fields: 'no' }), { status: 200 })), 'unavailable'],
  ] as const)('%s on every batch starts Original_Label_Mode with every label, with no retry', async (_name, respond, reason) => {
    const fetchFn = vi.fn(respond as unknown as FetchFn);
    const result = await analyzeKeptLabels(requests(5), fetchFn);
    expect(result).toEqual({ mode: 'original-label', reason, failedLabelIds: ['p1-l0', 'p1-l1', 'p1-l2', 'p1-l3', 'p1-l4'] });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('a failed second batch leaves its 1 label in Original_Label_Mode and keeps the 30 AI questions', async () => {
    const inner = workerFetch();
    let n = 0;
    const result = await analyzeKeptLabels(requests(31), (u, i) => (++n === 2 ? Promise.reject(new TypeError('x')) : inner(u, i)));
    if (result.mode !== 'ai') throw new Error('expected ai');
    expect(result.analyses.size).toBe(30);
    expect(result.failedLabelIds).toEqual(['p1-l30']);
  });

  it('a quota error stops the later batches without sending them', async () => {
    const fetchFn = vi.fn(async () => errorResponse(429, 'RATE_LIMITED'));
    const result = await analyzeKeptLabels(requests(61), fetchFn as unknown as FetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ mode: 'original-label', reason: 'quota' });
    expect((result as { failedLabelIds: string[] }).failedLabelIds).toHaveLength(61);
  });

  it('a label the reply left out is asked in Original_Label_Mode', async () => {
    const inner = workerFetch();
    const dropping: FetchFn = async (u, i) => {
      const res = await inner(u, i);
      const body = (await res.json()) as { fields: Array<{ fieldId: string }> };
      body.fields = body.fields.filter((f) => f.fieldId !== 'p1-l1');
      return new Response(JSON.stringify(body), { status: 200, headers: res.headers });
    };
    const result = await analyzeKeptLabels(requests(3), dropping);
    if (result.mode !== 'ai') throw new Error('expected ai');
    expect(result.failedLabelIds).toEqual(['p1-l1']);
    expect(result.analyses.has('p1-l1')).toBe(false);
  });

  it('results and errors hold no label text, even when the labels do', async () => {
    const CANARY = 'ZQXCLIENT';
    const text = (i: number) => `${CANARY} ${i}:`;
    for (const respond of [() => Promise.reject(new Error(CANARY)), () => Promise.resolve(errorResponse(503, 'AI_UNAVAILABLE'))]) {
      const result = await analyzeKeptLabels(requests(2, text), respond as unknown as FetchFn);
      expect(JSON.stringify(result)).not.toContain(CANARY);
    }
  });
});
