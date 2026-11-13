/**
 * tests/unit/analyze-labels-route.test.ts
 *
 * POST /api/documents/analyze-labels with the mock and scripted providers
 * (formbridge-any-document tasks 2.9 and 2.16): success, every Worker row of
 * the design's error table, the prompt guard and the AI-unavailable mapping.
 * Validates: Requirements 13.2, 13.3, 13.4, 13.7, 13.8, 13.11, 13.12, 24.3
 */

import { describe, it, expect } from 'vitest';
import { AiError } from '../../src/lib/ai/interface.js';
import { checkDataSection, PromptDelimiterError, LABEL_DATA_OPEN, LABEL_DATA_CLOSE, analyzeLabelsMessages } from '../../src/lib/ai/prompt.js';
import { ApiErrorSchema, LabelAnalysisResponseSchema } from '../../src/shared/schemas.js';
import { AI_MODE_HEADER, type Env } from '../../src/worker/index.js';
import { ANALYZE_LABELS_BODY_LIMIT } from '../../src/worker/routes/analyze-labels.js';
import { keptLabel, labelRequest, scriptedLabels, setupWorker, validEnvelope } from './document-test-helpers.js';

const LABELS = [keptLabel(1, 3, 'Nama penuh:'), keptLabel(1, 5, 'No. Kad Pengenalan:'), keptLabel(2, 0, 'Tandatangan:')];

async function expectError(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  const body = ApiErrorSchema.parse(await res.json());
  expect(body.error.code).toBe(code);
}

describe('POST /api/documents/analyze-labels', () => {
  it('returns one validated analysis per label from the mock, in order, and marks the reply as mock', async () => {
    const { call, logs } = setupWorker();
    const res = await call(labelRequest(LABELS, { interfaceLanguage: 'zh-Hans', formLanguage: 'ms', formCountry: 'MY' }));
    expect(res.status).toBe(200);
    expect(res.headers.get(AI_MODE_HEADER)).toBe('mock');
    const body = LabelAnalysisResponseSchema.parse(await res.json());
    expect(body.fields.map((f) => [f.fieldId, f.answerType])).toEqual([
      ['p1-l3', 'text'],
      ['p1-l5', 'ic'],
      ['p2-l0', 'signature'],
    ]);
    expect(body.failedLabelIds).toEqual([]);
    expect(body.formLanguage).toBe('ms');
    expect(body.formCountry).toBe('MY');
    expect(logs).toEqual([{ requestId: 'req-1', route: '/api/documents/analyze-labels', status: 200, durationMs: 0, aiMode: 'mock', attempts: 1, model: 'mock' }]);
  });

  it('asks the provider once per batch of 30 and returns every label of 31', async () => {
    const provider = scriptedLabels([(c) => validEnvelope(c)]);
    const labels = Array.from({ length: 31 }, (_, i) => keptLabel(1, i, `Label ${i}:`));
    const res = await setupWorker(provider).call(labelRequest(labels));
    const body = LabelAnalysisResponseSchema.parse(await res.json());
    expect(provider.calls.map((c) => c.labels.length)).toEqual([30, 1]);
    expect(body.fields).toHaveLength(31);
  });

  it('reports the ids of a batch that failed twice, and keeps the other batch', async () => {
    let n = 0;
    const provider = scriptedLabels([(c) => (n++ < 2 ? { fields: 'broken' } : validEnvelope(c))]);
    const labels = Array.from({ length: 31 }, (_, i) => keptLabel(1, i, `Label ${i}:`));
    const body = LabelAnalysisResponseSchema.parse(await (await setupWorker(provider).call(labelRequest(labels))).json());
    expect(body.failedLabelIds).toEqual(labels.slice(0, 30).map((l) => l.labelId));
    expect(body.fields.map((f) => f.fieldId)).toEqual(['p1-l30']);
  });

  it('answers 503 AI_UNAVAILABLE when every batch fails, 504 AI_TIMEOUT when every failure was a timeout', async () => {
    await expectError(await setupWorker(scriptedLabels([{ value: { nope: true } }])).call(labelRequest(LABELS)), 503, 'AI_UNAVAILABLE');
    await expectError(await setupWorker(scriptedLabels([new AiError('AI_QUOTA', 'q')])).call(labelRequest(LABELS)), 503, 'AI_UNAVAILABLE');
    await expectError(await setupWorker(scriptedLabels([new AiError('AI_UNAVAILABLE', 'u')])).call(labelRequest(LABELS)), 503, 'AI_UNAVAILABLE');
    const slow = scriptedLabels([new AiError('AI_TIMEOUT', 't')]);
    await expectError(await setupWorker(slow).call(labelRequest(LABELS)), 504, 'AI_TIMEOUT');
    expect(slow.calls).toHaveLength(2);
  });

  it('retries once after a timeout and uses the second reply', async () => {
    let n = 0;
    const provider = scriptedLabels([
      (c) => {
        if (n++ === 0) throw new AiError('AI_TIMEOUT', 't');
        return validEnvelope(c);
      },
    ]);
    const res = await setupWorker(provider).call(labelRequest(LABELS));
    expect(res.status).toBe(200);
    expect(provider.calls).toHaveLength(2);
  });

  it('does not retry and stops after a quota error', async () => {
    const provider = scriptedLabels([new AiError('AI_QUOTA', 'q')]);
    const labels = Array.from({ length: 61 }, (_, i) => keptLabel(1, i, `Label ${i}:`));
    await expectError(await setupWorker(provider).call(labelRequest(labels)), 503, 'AI_UNAVAILABLE');
    expect(provider.calls).toHaveLength(1);
  });

  it('turns an unexpected exception into 500 INTERNAL_ERROR', async () => {
    await expectError(await setupWorker(scriptedLabels([new TypeError('boom')])).call(labelRequest(LABELS)), 500, 'INTERNAL_ERROR');
  });

  it('rejects an unknown interface language, bad JSON, a GET and an oversized body before any provider call', async () => {
    const provider = scriptedLabels([new Error('must not be called')]);
    const { call } = setupWorker(provider);
    await expectError(await call(labelRequest(LABELS, { interfaceLanguage: 'xx-Unknown' })), 400, 'UNSUPPORTED_LANGUAGE');
    await expectError(await call('{"labels":'), 400, 'INVALID_JSON');
    const big = JSON.stringify(labelRequest(LABELS, { pad: 'x'.repeat(ANALYZE_LABELS_BODY_LIMIT) }));
    await expectError(await call(big), 413, 'PAYLOAD_TOO_LARGE');
    expect(provider.calls).toHaveLength(0);
  });

  it('accepts a body of 150 labels of 200 characters each under the body limit', async () => {
    const labels = Array.from({ length: 150 }, (_, i) => keptLabel(1 + (i % 5), i, 'x'.repeat(199) + ':'));
    expect(JSON.stringify(labelRequest(labels)).length).toBeLessThan(ANALYZE_LABELS_BODY_LIMIT);
    const res = await setupWorker(scriptedLabels([(c) => validEnvelope(c)])).call(labelRequest(labels));
    expect(res.status).toBe(200);
  });

  it('is counted by RATE_LIMITER_ANALYZE with key route:ip and answers 429 when it is full', async () => {
    const keys: string[] = [];
    const env: Env = {
      RATE_LIMITER_ANALYZE: { limit: async ({ key }) => (keys.push(key), { success: false }) },
      RATE_LIMITER_TRANSLATE: { limit: async () => ({ success: true }) },
    };
    await expectError(await setupWorker(undefined, env).call(labelRequest(LABELS)), 429, 'RATE_LIMITED');
    expect(keys).toEqual(['/api/documents/analyze-labels:203.0.113.7']);
  });
});

describe('prompt data section guard (task 2.9)', () => {
  it('accepts a message built by the label prompt builder', () => {
    const user = analyzeLabelsMessages({ labels: LABELS, interfaceLanguage: 'en', interfaceLanguageName: 'English' })[1]!.content;
    expect(() => checkDataSection(user, LABEL_DATA_OPEN, LABEL_DATA_CLOSE)).not.toThrow();
  });

  it('throws for a second marker, a marker that is not on its own line, or a reversed pair', () => {
    const ok = `x\n${LABEL_DATA_OPEN}\n[]\n${LABEL_DATA_CLOSE}`;
    expect(() => checkDataSection(ok, LABEL_DATA_OPEN, LABEL_DATA_CLOSE)).not.toThrow();
    for (const bad of [
      `${ok}\n${LABEL_DATA_OPEN}`,
      `x\n${LABEL_DATA_OPEN}\n["${LABEL_DATA_CLOSE}"]\n${LABEL_DATA_CLOSE}`,
      `x ${LABEL_DATA_OPEN}\n[]\n${LABEL_DATA_CLOSE}`,
      `x\n${LABEL_DATA_CLOSE}\n[]\n${LABEL_DATA_OPEN}`,
      'no markers at all',
    ]) {
      expect(() => checkDataSection(bad, LABEL_DATA_OPEN, LABEL_DATA_CLOSE)).toThrow(PromptDelimiterError);
    }
  });
});
