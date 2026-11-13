/**
 * tests/unit/analyze-labels-binding.test.ts
 *
 * The label analysis route obeys the privacy steering rules for logs, error
 * messages and request fields (formbridge-any-document task 2.24).
 * Validates: Requirements 24.3, 24.10, 24.11
 */

import { describe, it, expect } from 'vitest';
import { AiError } from '../../src/lib/ai/interface.js';
import { MockAiProvider } from '../../src/lib/ai/mock.js';
import { LabelAnalysisRequestSchema } from '../../src/shared/schemas.js';
import { keptLabel, labelRequest, scriptedLabels, setupWorker } from './document-test-helpers.js';

/** The only log items the privacy steering allows. */
const ALLOWED_LOG_KEYS = new Set([
  'requestId',
  'route',
  'status',
  'durationMs',
  'errorCode',
  'aiMode',
  'model',
  'attempts',
  'promptTokens',
  'completionTokens',
  'neurons',
  'servedFromCache',
]);

const CANARY = 'ZQXBIND';
const labels = [keptLabel(1, 0, `${CANARY} Nama:`), keptLabel(1, 1, 'Poskod:')];

const cases: Array<[string, () => ReturnType<typeof setupWorker>, unknown]> = [
  ['success', () => setupWorker(new MockAiProvider()), labelRequest(labels)],
  ['bad request', () => setupWorker(), { labels: [{ ...labels[0], text: `${CANARY}${'y'.repeat(300)}` }], interfaceLanguage: 'en' }],
  ['unsupported language', () => setupWorker(), labelRequest(labels, { interfaceLanguage: 'xx' })],
  ['invalid JSON', () => setupWorker(), `{"labels":[{"text":"${CANARY}"`],
  ['AI unavailable', () => setupWorker(scriptedLabels([new AiError('AI_UNAVAILABLE', CANARY)])), labelRequest(labels)],
  ['AI timeout', () => setupWorker(scriptedLabels([new AiError('AI_TIMEOUT', CANARY)])), labelRequest(labels)],
  ['internal error', () => setupWorker(scriptedLabels([new RangeError(CANARY)])), labelRequest(labels)],
];

describe('binding to the privacy steering', () => {
  it.each(cases)('%s: one log entry with only allowed keys and no label text', async (_name, setup, body) => {
    const { call, logs } = setup();
    await call(body);
    expect(logs).toHaveLength(1);
    for (const key of Object.keys(logs[0]!)) expect(ALLOWED_LOG_KEYS.has(key)).toBe(true);
    expect(JSON.stringify(logs)).not.toContain(CANARY);
    expect(JSON.stringify(logs)).not.toContain('Poskod');
  });

  it.each(cases.slice(1))('%s: the error message names schema paths only', async (_name, setup, body) => {
    const res = await setup().call(body);
    const { error } = (await res.json()) as { error: { code: string; message: string } };
    expect(error.message).not.toContain(CANARY);
    expect(error.message).not.toContain('Poskod');
    if (error.code === 'BAD_REQUEST') expect(error.message).toContain('labels.0.text');
  });

  it('rejects any page-text or snippet field, so the Document_Path cannot send a widget snippet', () => {
    const base = labelRequest([keptLabel(1, 0, 'Nama:')]);
    expect(LabelAnalysisRequestSchema.safeParse(base).success).toBe(true);
    for (const extra of [{ pageSnippet: 'x' }, { nearbyText: 'x' }, { textLines: ['x'] }, { answers: ['x'] }, { image: 'data:' }]) {
      expect(LabelAnalysisRequestSchema.safeParse({ ...base, ...extra }).success).toBe(false);
    }
    for (const extra of [{ pageSnippet: 'x' }, { box: { left: 0, top: 0, right: 1, bottom: 1 } }, { confidence: 0.5 }]) {
      const withField = { ...base, labels: [{ ...base.labels[0], ...extra }] };
      expect(LabelAnalysisRequestSchema.safeParse(withField).success).toBe(false);
    }
  });
});
