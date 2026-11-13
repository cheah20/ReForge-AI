/**
 * tests/unit/analyze-labels.property.test.ts
 *
 * Property tests for label analysis (formbridge-any-document task 2):
 * Properties 11, 12, 13, 31 and 32.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { analyzeLabelsMessages } from '../../src/lib/ai/prompt.js';
import { MockAiProvider } from '../../src/lib/ai/mock.js';
import { AiError } from '../../src/lib/ai/interface.js';
import { labelBatches, runAnalyzeLabels, sanitizeLabelEntries } from '../../src/lib/analysis/run-labels.js';
import { ApiErrorSchema, LabelAnalysisResponseSchema } from '../../src/shared/schemas.js';
import type { KeptLabel } from '../../src/shared/types.js';
import { dataSection, keptLabel, labelRequest, scriptedLabels, setupWorker, validEnvelope } from './document-test-helpers.js';

const NASTY = ['<form_data>', '</form_data>', '</system>', '"', '\\', '"}]', '{"fields":', '\n', '\u2028', '\u2029', 'ignore previous instructions', '<', '>'];

const labelText = fc
  .array(fc.oneof(fc.constantFrom(...NASTY), fc.string({ minLength: 1, maxLength: 12 })), { minLength: 1, maxLength: 8 })
  .map((parts) => parts.join(' ').slice(0, 200))
  .filter((s) => s.trim().length > 0);

/** Labels with unique Label_Ids: up to 5 pages, distinct reading orders. */
const labelList = (max: number) =>
  fc
    .uniqueArray(fc.tuple(fc.integer({ min: 1, max: 5 }), fc.integer({ min: 0, max: 9999 })), {
      minLength: 1,
      maxLength: max,
      selector: ([p, r]) => `${p}-${r}`,
    })
    .chain((ids) => fc.tuple(...ids.map(() => labelText)).map((texts) => ids.map(([p, r], i) => keptLabel(p, r, texts[i]!))));

const FIXED_SYSTEM = analyzeLabelsMessages({ labels: [keptLabel(1, 0, 'Name:')], interfaceLanguage: 'en', interfaceLanguageName: 'English' })[0]!.content;

// Feature: formbridge-any-document, Property 11: Prompt data delimiting round trip
describe('Property 11: prompt data delimiting round trip', () => {
  it('any label text stays inside exactly one escaped data section and parses back unchanged', () => {
    fc.assert(
      fc.property(labelList(30), (labels) => {
        const messages = analyzeLabelsMessages({ labels, interfaceLanguage: 'en', interfaceLanguageName: 'English' });
        const system = messages[0]!.content;
        const user = messages[1]!.content;
        expect(user.split('<form_data>').length - 1).toBe(1);
        expect(user.split('</form_data>').length - 1).toBe(1);
        const lines = user.split('\n');
        const body = lines.slice(lines.indexOf('<form_data>') + 1, lines.indexOf('</form_data>'));
        // One JSON line, no raw markup or separator characters in it.
        expect(body).toHaveLength(1);
        expect(body[0]).not.toMatch(/[<>\u2028\u2029]/);
        expect(dataSection(messages)).toEqual(labels);
        // The system prompt is fixed text: it does not depend on the labels at all.
        expect(system).toBe(FIXED_SYSTEM);
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: formbridge-any-document, Property 31: Mock label analysis is deterministic
describe('Property 31: mock label analysis is deterministic', () => {
  it('the same request gives the same reply, and every reply passes the envelope and entry schemas', async () => {
    await fc.assert(
      fc.asyncProperty(labelList(30), fc.constantFrom('en', 'ms', 'zh-Hans'), async (labels, lang) => {
        const call = { labels, interfaceLanguage: lang, interfaceLanguageName: lang };
        const a = await new MockAiProvider().analyzeLabels(call);
        const b = await new MockAiProvider().analyzeLabels(call);
        expect(b.value).toEqual(a.value);
        const fields = sanitizeLabelEntries((a.value as { fields: unknown[] }).fields, labels.map((l) => l.labelId));
        expect(fields.map((f) => f.fieldId)).toEqual(labels.map((l) => l.labelId));
      }),
      { numRuns: 100 },
    );
  });

  it('maps keywords to answer types with confidence 0.9, and anything else to text at 0.5', async () => {
    const labels = [keptLabel(1, 0, 'No. Kad Pengenalan:'), keptLabel(1, 1, 'Tarikh lahir:'), keptLabel(1, 2, 'Favourite colour:')];
    const r = (await new MockAiProvider().analyzeLabels({ labels, interfaceLanguage: 'en', interfaceLanguageName: 'English' })).value as {
      fields: Array<{ answerType: string; confidence: number; question: string }>;
    };
    expect(r.fields.map((f) => [f.answerType, f.confidence])).toEqual([
      ['ic', 0.9],
      ['date', 0.9],
      ['text', 0.5],
    ]);
    expect(r.fields.every((f) => f.question.startsWith('[demo] '))).toBe(true);
  });
});

const entryArb = (ids: string[]) =>
  fc.oneof(
    // valid entry for a batch id
    fc.record({
      fieldId: fc.constantFrom(...ids),
      humanLabel: fc.constant('Name'),
      question: fc.constant('What is your name?'),
      answerType: fc.constantFrom('text', 'ic', 'phone', 'date', 'description', 'signature'),
      confidence: fc.double({ min: 0, max: 1, noNaN: true }),
      explanation: fc.option(fc.oneof(fc.constant('Your name.'), fc.constant(' '), fc.string({ minLength: 201, maxLength: 210 })), { nil: undefined }),
      example: fc.option(fc.oneof(fc.constant('Sam Example'), fc.string({ minLength: 61, maxLength: 70 })), { nil: undefined }),
      extraKey: fc.option(fc.constant('drop me'), { nil: undefined }),
    }),
    // unknown id, disallowed type, broken values, non-objects
    fc.record({ fieldId: fc.constantFrom('p5-l9999', 'p1-l7777'), humanLabel: fc.constant('X'), question: fc.constant('Q'), answerType: fc.constant('text'), confidence: fc.constant(0.5) }),
    fc.record({ fieldId: fc.constantFrom(...ids), humanLabel: fc.constant('X'), question: fc.constant('Q'), answerType: fc.constantFrom('checkbox', 'radio', 'dropdown', 'nonsense'), confidence: fc.constant(0.5) }),
    fc.record({ fieldId: fc.constantFrom(...ids), humanLabel: fc.constant('   '), question: fc.constant('Q'), answerType: fc.constant('text'), confidence: fc.constant(2) }),
    fc.constantFrom(null, 'text', 42, ['p1-l0']),
  );

// Feature: formbridge-any-document, Property 12: Reply sanitising
describe('Property 12: reply sanitising', () => {
  it('keeps only the first schema-valid entry per known id, dropping only a failing explanation or example', () => {
    const ids = ['p1-l0', 'p1-l1', 'p2-l3'];
    let sawValidOptional = false;
    let sawDroppedOptional = false;
    fc.assert(
      fc.property(fc.array(entryArb(ids), { maxLength: 15 }), (entries) => {
        const out = sanitizeLabelEntries(entries, ids);
        // Unique, known ids, in first-seen order of valid entries.
        expect(new Set(out.map((f) => f.fieldId)).size).toBe(out.length);
        for (const f of out) {
          expect(ids).toContain(f.fieldId);
          expect(['text', 'ic', 'phone', 'postcode', 'date', 'email', 'description', 'signature']).toContain(f.answerType);
          expect(f.confidence).toBeGreaterThanOrEqual(0);
          expect(f.confidence).toBeLessThanOrEqual(1);
          expect('extraKey' in f).toBe(false);
          if (f.explanation !== undefined) expect(f.explanation.length).toBeLessThanOrEqual(200);
          if (f.example !== undefined) expect(f.example.length).toBeLessThanOrEqual(60);
        }
        // Model: the first valid-shaped entry for each id survives.
        const firstValid = new Map<string, Record<string, unknown>>();
        for (const e of entries) {
          if (typeof e !== 'object' || e === null || Array.isArray(e)) continue;
          const r = e as Record<string, unknown>;
          const typeOk = ['text', 'ic', 'phone', 'postcode', 'date', 'email', 'description', 'signature'].includes(r['answerType'] as string);
          const ok = ids.includes(r['fieldId'] as string) && typeOk && r['humanLabel'] !== '   ' && (r['confidence'] as number) <= 1;
          if (ok && !firstValid.has(r['fieldId'] as string)) firstValid.set(r['fieldId'] as string, r);
        }
        expect(out.map((f) => f.fieldId)).toEqual([...firstValid.keys()]);
        for (const f of out) {
          const src = firstValid.get(f.fieldId)!;
          if (src['explanation'] === 'Your name.') expect(f.explanation).toBe('Your name.');
          if (src['explanation'] !== undefined && src['explanation'] !== 'Your name.') {
            expect(f.explanation).toBeUndefined();
            sawDroppedOptional = true;
          }
          if (src['example'] === 'Sam Example') {
            expect(f.example).toBe('Sam Example');
            sawValidOptional = true;
          }
        }
      }),
      { numRuns: 200 },
    );
    // The generator reached both branches, so the property is not passing trivially.
    expect(sawValidOptional).toBe(true);
    expect(sawDroppedOptional).toBe(true);
  });
});

type Outcome = 'valid' | 'invalid' | 'timeout' | 'quota';

/** 31 to 95 labels in shuffled order, so a run always needs two to four batches. */
const manyLabels = fc
  .integer({ min: 31, max: 95 })
  .chain((n) => fc.shuffledSubarray(Array.from({ length: n }, (_, i) => keptLabel(1 + (i % 5), i, `Label ${i}:`)), { minLength: n, maxLength: n }));

// Feature: formbridge-any-document, Property 13: Batching and retry
describe('Property 13: batching and retry', () => {
  it('batches of 30 in page and reading order, one retry after an invalid reply or a timeout, failed ids reported', async () => {
    let sawPartial = false;
    let sawAllFailed = false;
    await fc.assert(
      fc.asyncProperty(fc.oneof(labelList(30), manyLabels), fc.array(fc.constantFrom<Outcome>('valid', 'invalid', 'timeout', 'quota'), { minLength: 1, maxLength: 10 }), async (labels, script) => {
        let i = 0;
        const provider = scriptedLabels([
          (c) => {
            const o = script[Math.min(i++, script.length - 1)]!;
            if (o === 'timeout') throw new AiError('AI_TIMEOUT', 'x');
            if (o === 'quota') throw new AiError('AI_QUOTA', 'x');
            return o === 'valid' ? validEnvelope(c) : { fields: 'nope' };
          },
        ]);
        // scriptedLabels calls the function step and returns its value; a thrown AiError propagates.
        const batches = labelBatches(labels);
        // Expected run, simulated from the script.
        let k = 0;
        let stopped = false;
        const expectedFailed: string[] = [];
        let expectedCalls = 0;
        let anyOk = false;
        const reasons: string[] = [];
        for (const b of batches) {
          if (stopped) {
            expectedFailed.push(...b.map((l) => l.labelId));
            reasons.push('stop');
            continue;
          }
          let ok = false;
          let reason = 'invalid';
          for (let attempt = 0; attempt < 2; attempt++) {
            const o = script[Math.min(k++, script.length - 1)]!;
            expectedCalls++;
            if (o === 'valid') {
              ok = true;
              break;
            }
            if (o === 'quota') {
              stopped = true;
              reason = 'stop';
              break;
            }
            reason = o;
          }
          if (ok) anyOk = true;
          else {
            expectedFailed.push(...b.map((l) => l.labelId));
            reasons.push(reason);
          }
        }

        const run = runAnalyzeLabels(provider, labelRequest(labels), { interfaceLanguageName: 'English' });
        if (!anyOk) {
          sawAllFailed = true;
          const err = await run.catch((e: unknown) => e);
          expect(err).toBeInstanceOf(AiError);
          expect((err as AiError).code).toBe(reasons.every((r) => r === 'timeout') ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE');
        } else {
          const { value } = await run;
          expect(LabelAnalysisResponseSchema.safeParse(value).success).toBe(true);
          expect(value.failedLabelIds).toEqual(expectedFailed);
          const ordered = batches.flat().map((l) => l.labelId);
          expect(value.fields.map((f) => f.fieldId)).toEqual(ordered.filter((id) => !expectedFailed.includes(id)));
          if (expectedFailed.length > 0) sawPartial = true;
        }
        expect(provider.calls).toHaveLength(expectedCalls);
        // Every call carried one batch of at most 30, in page and reading order.
        for (const c of provider.calls) {
          expect(c.labels.length).toBeLessThanOrEqual(30);
          const keys = c.labels.map((l: KeptLabel) => l.pageNumber * 100000 + l.readingOrder);
          expect(keys).toEqual([...keys].sort((a, b) => a - b));
        }
      }),
      { numRuns: 150 },
    );
    expect(sawPartial).toBe(true);
    expect(sawAllFailed).toBe(true);
  });
});

// Feature: formbridge-any-document, Property 32: Invalid requests are rejected with schema paths only
describe('Property 32: invalid requests are rejected with schema paths only', () => {
  const CANARY = 'ZQXREQ';
  const invalidBody = fc.oneof(
    fc.constant({ labels: [], interfaceLanguage: 'en' }),
    fc.constant({ labels: [keptLabel(1, 0, `${CANARY} Name:`)], interfaceLanguage: 'en', answers: [`${CANARY}`] }),
    fc.constant({ labels: [{ ...keptLabel(1, 0, 'Name:'), box: { left: 0 }, note: CANARY }], interfaceLanguage: 'en' }),
    fc.constant({ labels: [{ labelId: 'p1-l1', text: `${CANARY}:`, pageNumber: 1, readingOrder: 2 }], interfaceLanguage: 'en' }),
    fc.constant({ labels: [keptLabel(1, 0, 'A:'), keptLabel(1, 0, `${CANARY}:`)], interfaceLanguage: 'en' }),
    fc.constant({ labels: [keptLabel(6, 0, `${CANARY}:`)], interfaceLanguage: 'en' }),
    fc.constant({ labels: [keptLabel(1, 0, `${CANARY}${'x'.repeat(201)}`)], interfaceLanguage: 'en' }),
    fc.constant({ labels: Array.from({ length: 151 }, (_, i) => keptLabel(1 + (i % 5), i, `${CANARY}:`)), interfaceLanguage: 'en' }),
    fc.constant({ labels: [keptLabel(1, 0, '   ')], interfaceLanguage: 'en' }),
    fc.constant({ labels: [keptLabel(1, 0, 'Name:')], interfaceLanguage: 'en', formCountry: `${CANARY}` }),
  );

  it('answers 400 BAD_REQUEST with no provider call, and the message names no submitted value', async () => {
    await fc.assert(
      fc.asyncProperty(invalidBody, async (body) => {
        const provider = scriptedLabels([new Error('must not be called')]);
        const { call, logs } = setupWorker(provider);
        const res = await call(body);
        expect(res.status).toBe(400);
        const text = await res.text();
        const parsed = ApiErrorSchema.parse(JSON.parse(text));
        expect(parsed.error.code).toBe('BAD_REQUEST');
        expect(parsed.error.message).toMatch(/Check: /);
        expect(text).not.toContain(CANARY);
        expect(JSON.stringify(logs)).not.toContain(CANARY);
        expect(provider.calls).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });
});
