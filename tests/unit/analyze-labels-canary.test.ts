/**
 * tests/unit/analyze-labels-canary.test.ts
 *
 * Canary test for the label analysis data path (formbridge-any-document task
 * 2.18). A Canary_Value in a Kept_Label goes through the route with a
 * recording logger: with the mock, with an invalid body, with a provider that
 * throws and with one that times out. The canary reaches the prompt only
 * between the data markers, and never a log entry or a response other than
 * the mock's own echo of the label it was asked about.
 * Validates: Requirements 13.13, 24.1, 24.3
 */

import { describe, it, expect } from 'vitest';
import { AiError } from '../../src/lib/ai/interface.js';
import { MockAiProvider } from '../../src/lib/ai/mock.js';
import { keptLabel, labelRequest, recording, scriptedLabels, setupWorker } from './document-test-helpers.js';

const CANARY = 'ZQXKEPT';
/** A value printed on a prefilled document that the user did not keep. It is never in the request. */
const PREFILLED = 'ZQXPREFILLED';

const kept = [keptLabel(1, 0, `${CANARY} name:`), keptLabel(1, 2, 'Phone no.:')];

describe('label analysis canary', () => {
  it('the canary is really in the request body (precondition)', () => {
    expect(JSON.stringify(labelRequest(kept))).toContain(CANARY);
  });

  it('reaches the prompt only between the data markers, and no log entry', async () => {
    const provider = recording(new MockAiProvider());
    const { call, logs } = setupWorker(provider);
    const res = await call(labelRequest(kept));
    expect(res.status).toBe(200);
    expect(provider.prompts).toHaveLength(1);
    const [system, user] = provider.prompts[0]!;
    expect(system!.content).not.toContain(CANARY);
    const inside = user!.content.slice(user!.content.indexOf('<form_data>'), user!.content.indexOf('</form_data>'));
    const outside = user!.content.replace(inside, '');
    expect(inside).toContain(CANARY);
    expect(outside).not.toContain(CANARY);
    expect(JSON.stringify(provider.prompts)).not.toContain(PREFILLED);
    expect(JSON.stringify(logs)).not.toContain(CANARY);
  });

  it.each([
    ['an invalid body', () => scriptedLabels([new Error('not called')]), { ...labelRequest(kept), extra: CANARY }],
    ['a provider that throws', () => scriptedLabels([new TypeError(CANARY)]), labelRequest(kept)],
    ['a provider that times out', () => scriptedLabels([new AiError('AI_TIMEOUT', CANARY)]), labelRequest(kept)],
    ['a provider that echoes the label in an invalid reply', () => scriptedLabels([{ value: { fields: CANARY } }]), labelRequest(kept)],
  ])('with %s, the canary is in no log entry and no response', async (_name, provider, body) => {
    const { call, logs } = setupWorker(provider());
    const res = await call(body);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await res.text()).not.toContain(CANARY);
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs)).not.toContain(CANARY);
  });
});
