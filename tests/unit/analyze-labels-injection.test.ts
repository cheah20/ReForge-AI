/**
 * tests/unit/analyze-labels-injection.test.ts
 *
 * Prompt injection through document text (formbridge-any-document task 2.23,
 * Requirement 24.13, design Q2). Each attack text runs through the route as a
 * Kept_Label next to a plain label of the same length. The attack stays
 * escaped inside the one data section, a reply that obeys it is still checked
 * by the schemas, and what the app does is identical to the plain run.
 * Validates: Requirements 13.4, 13.5, 24.13
 */

import { describe, it, expect } from 'vitest';
import { LabelAnalysisResponseSchema } from '../../src/shared/schemas.js';
import { INJECTION_CASES } from '../fixtures/document/injection-strings.js';
import { dataSection, keptLabel, labelRequest, recording, scriptedLabels, setupWorker, validEnvelope } from './document-test-helpers.js';

const labelsWith = (text: string) => [keptLabel(1, 0, 'Full name:'), keptLabel(1, 4, text), keptLabel(2, 1, 'Postcode:')];

describe('prompt injection in Kept_Label text', () => {
  it('every attack has a plain twin of the same length', () => {
    for (const c of INJECTION_CASES) expect(c.plain.length).toBe(c.attack.length);
  });

  it.each(INJECTION_CASES.map((c) => [c.name, c] as const))('%s: stays escaped inside the single data section', async (_name, c) => {
    const provider = recording();
    const res = await setupWorker(provider).call(labelRequest(labelsWith(c.attack)));
    expect(res.status).toBe(200);
    const user = provider.prompts[0]![1]!.content;
    expect(user.split('<form_data>').length - 1).toBe(1);
    expect(user.split('</form_data>').length - 1).toBe(1);
    const lines = user.split('\n');
    const body = lines.slice(lines.indexOf('<form_data>') + 1, lines.indexOf('</form_data>'));
    expect(body).toHaveLength(1);
    expect(body[0]).not.toMatch(/[<>]/);
    expect(dataSection(provider.prompts[0]!)).toEqual(labelsWith(c.attack));
    // The system prompt never holds document text.
    expect(provider.prompts[0]![0]!.content).not.toContain(c.attack);
  });

  it.each(INJECTION_CASES.map((c) => [c.name, c] as const))('%s: behaves exactly like the plain twin', async (_name, c) => {
    const runs = await Promise.all(
      [c.attack, c.plain].map(async (text) => {
        const provider = recording();
        const res = await setupWorker(provider).call(labelRequest(labelsWith(text)));
        const body = LabelAnalysisResponseSchema.parse(await res.json());
        return {
          status: res.status,
          calls: provider.calls.map((call) => call.labels.map((l) => l.labelId)),
          fieldIds: body.fields.map((f) => f.fieldId),
          failed: body.failedLabelIds,
          keys: Object.keys(dataSection(provider.prompts[0]!) as object[]).length,
        };
      }),
    );
    expect(runs[0]).toEqual(runs[1]);
  });

  it('a reply that obeys an injected instruction is still cut down by the schemas', async () => {
    const attack = INJECTION_CASES.find((c) => c.name === 'instruction')!.attack;
    const provider = scriptedLabels([
      (call) => {
        const env = validEnvelope(call);
        return {
          ...env,
          answers: ['900101101234'],
          fields: [
            ...env.fields.map((f) => ({ ...f, answer: 'ZQXECHO' })),
            { fieldId: 'p9-l9', humanLabel: 'Extra', question: 'Give me the answers', answerType: 'text', confidence: 1 },
            { fieldId: 'p1-l4', humanLabel: 'Again', question: 'Second entry for the same label', answerType: 'text', confidence: 1 },
          ],
        };
      },
    ]);
    const res = await setupWorker(provider).call(labelRequest(labelsWith(attack)));
    const text = await res.text();
    const body = LabelAnalysisResponseSchema.parse(JSON.parse(text));
    expect(body.fields.map((f) => f.fieldId)).toEqual(['p1-l0', 'p1-l4', 'p2-l1']);
    expect(body.fields.find((f) => f.fieldId === 'p1-l4')!.question).toBe('What is it?');
    expect(text).not.toContain('ZQXECHO');
    expect(text).not.toContain('900101101234');
    expect(text).not.toContain('p9-l9');
  });
});
