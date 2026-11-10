/**
 * tests/unit/ai-providers.test.ts
 *
 * Task 12.3: the mock provider is deterministic, its replies pass the shared
 * schemas, and its confidence is configurable per instance so tests can force
 * or skip the confirmation screen. Plus the Workers AI provider's request
 * inputs (decision 10), reply parsing and error mapping.
 * Validates: Requirements 12.1, 12.2, 12.3, 12.4
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { extractFields } from '../../src/lib/pdf-extract/index.js';
import { MockAiProvider, matchTable } from '../../src/lib/ai/mock.js';
import {
  CfWorkersAiProvider,
  classifyBindingError,
  GEMMA_MODEL,
  QWEN_MODEL,
  type AiBinding,
} from '../../src/lib/ai/cf-workers.js';
import { AiError, isCacheFallbackError } from '../../src/lib/ai/interface.js';
import { extractJson, replyContent, replyUsage } from '../../src/lib/ai/json.js';
import { AnalyzeResponseSchema, RetranslateResponseSchema, TranslateResponseSchema } from '../../src/shared/schemas.js';
import { LOW_CONFIDENCE_THRESHOLD } from '../../src/lib/analysis/reconcile.js';
import type { AnalyzeRequest, FieldEvidence } from '../../src/shared/types.js';
import clinicTable from '../../fixtures/mock-analysis/clinic-registration.json';
import usTable from '../../fixtures/mock-analysis/us-community-clinic.json';

const evidence: Record<string, { fields: FieldEvidence[]; hash: string }> = {};
beforeAll(async () => {
  for (const name of ['clinic-registration', 'us-community-clinic', 'school-enrolment', 'sig-empty']) {
    const r = await extractFields(new Uint8Array(readFileSync(`fixtures/${name}.pdf`)));
    if (!r.ok) throw new Error(name);
    evidence[name] = { fields: r.fields, hash: r.fileHash };
  }
});

const request = (name: string, interfaceLanguage: string): AnalyzeRequest => ({
  contentHash: evidence[name]!.hash,
  fields: evidence[name]!.fields,
  interfaceLanguage,
});

const analyze = (p: MockAiProvider, name: string, lang: string) =>
  p.analyze({ request: request(name, lang), interfaceLanguageName: lang }).then((r) => r.value);

describe('MockAiProvider', () => {
  it('is deterministic: same input, same output', async () => {
    const p = new MockAiProvider();
    expect(await analyze(p, 'clinic-registration', 'zh-Hans')).toEqual(await analyze(p, 'clinic-registration', 'zh-Hans'));
    expect(await analyze(new MockAiProvider(), 'sig-empty', 'ms')).toEqual(await analyze(new MockAiProvider(), 'sig-empty', 'ms'));
  });

  it.each([
    ['clinic-registration', 'zh-Hans'],
    ['clinic-registration', 'ms'],
    ['clinic-registration', 'ta'],
    ['us-community-clinic', 'es'],
    ['school-enrolment', 'en'],
    ['sig-empty', 'zh-Hant'],
  ])('%s in %s passes AnalyzeResponseSchema and covers every field', async (name, lang) => {
    const value = await analyze(new MockAiProvider(), name, lang);
    const parsed = AnalyzeResponseSchema.safeParse(value);
    expect(parsed.success).toBe(true);
    expect(parsed.data!.fields.map((f) => f.fieldId)).toEqual(evidence[name]!.fields.map((f) => f.fieldId));
  });

  it('answers the clinic form in Chinese with the fixture spec types and confidences', async () => {
    const value = AnalyzeResponseSchema.parse(await analyze(new MockAiProvider(), 'clinic-registration', 'zh-Hans'));
    const byId = new Map(value.fields.map((f) => [f.fieldId, f]));
    expect(byId.get('Text1')).toMatchObject({ answerType: 'ic', humanLabel: '身份证号码' });
    expect(byId.get('Text7')?.confidence).toBe(0.45);
    expect(byId.get('contact.postcode')?.answerType).toBe('postcode');
    expect(value).toMatchObject({ formLanguage: 'ms', formCountry: 'MY' });
  });

  it('default confidences ask the user to confirm the form language and country (fixture spec)', async () => {
    const value = AnalyzeResponseSchema.parse(await analyze(new MockAiProvider(), 'clinic-registration', 'zh-Hans'));
    expect(value.formLanguageConfidence).toBeLessThan(LOW_CONFIDENCE_THRESHOLD);
    expect(value.formCountryConfidence).toBeLessThan(LOW_CONFIDENCE_THRESHOLD);
  });

  it('high-confidence instance: no confirmation needed', async () => {
    const value = AnalyzeResponseSchema.parse(
      await analyze(new MockAiProvider({ formLanguageConfidence: 0.95, formCountryConfidence: 0.95 }), 'clinic-registration', 'zh-Hans'),
    );
    expect(value.formLanguageConfidence).toBeGreaterThanOrEqual(LOW_CONFIDENCE_THRESHOLD);
    expect(value.formCountryConfidence).toBeGreaterThanOrEqual(LOW_CONFIDENCE_THRESHOLD);
  });

  it('low-confidence instance: confirmation needed', async () => {
    const value = AnalyzeResponseSchema.parse(
      await analyze(new MockAiProvider({ formLanguageConfidence: 0.3, formCountryConfidence: 0.3 }), 'clinic-registration', 'zh-Hans'),
    );
    expect(value.formLanguageConfidence).toBe(0.3);
    expect(value.formCountryConfidence).toBe(0.3);
  });

  it('answers an unknown form with the PDF types, its own labels and low confidence', async () => {
    const value = AnalyzeResponseSchema.parse(await analyze(new MockAiProvider(), 'sig-empty', 'en'));
    expect(value.fields).toEqual([
      { fieldId: 'probe.name', humanLabel: 'probe.name', question: 'Please enter: probe.name', answerType: 'text', confidence: 0.5 },
      {
        fieldId: 'probe.signature',
        humanLabel: 'Sign after printing',
        question: 'Please enter: Sign after printing',
        answerType: 'signature',
        confidence: 0.5,
      },
    ]);
  });

  it('every table label and question fits the schema limits in every language', () => {
    for (const table of [clinicTable, usTable]) {
      for (const [id, entry] of Object.entries(table.fields)) {
        for (const [lang, [label, question]] of Object.entries((entry as { text: Record<string, [string, string]> }).text)) {
          expect([...label].length, `${id} ${lang} label`).toBeLessThanOrEqual(40);
          expect([...question].length, `${id} ${lang} question`).toBeLessThanOrEqual(120);
        }
      }
    }
  });

  it('only matches a table when it knows every field in the batch', () => {
    expect(matchTable(['patient.fullName', 'Text1'])?.fixture).toBe('clinic-registration.pdf');
    expect(matchTable(['patient.fullName', 'not.in.any'])).toBeUndefined();
    expect(matchTable([])).toBeUndefined();
  });

  it('retranslates labels into the target language', async () => {
    const p = new MockAiProvider();
    const { value } = await p.retranslate({
      targetLanguageName: 'Spanish',
      request: {
        contentHash: 'a'.repeat(64),
        targetLanguage: 'es',
        // contact.phone exists only in the US form, so the US table is chosen.
        fields: [{ fieldId: 'contact.phone', humanLabel: 'Phone number', question: 'What is your US phone number?' }],
      },
    });
    expect(RetranslateResponseSchema.parse(value).fields[0]).toMatchObject({ humanLabel: 'Teléfono' });
  });

  it('translates the acceptance sentences exactly and marks anything else as a demo translation', async () => {
    const p = new MockAiProvider();
    const tr = (text: string, sourceLanguage: string, targetLanguage: string) =>
      p.translate({ request: { text, sourceLanguage, targetLanguage }, sourceLanguageName: '', targetLanguageName: '' }).then((r) => TranslateResponseSchema.parse(r.value).translation);
    expect(await tr('我咳嗽了两天。', 'zh-Hans', 'ms')).toBe('Saya batuk selama dua hari.');
    expect(await tr('Tengo tos desde hace dos días.', 'es', 'en')).toBe('I have had a cough for two days.');
    expect(await tr('Something else', 'en', 'ms')).toBe('[demo translation] Something else');
  });
});

describe('CfWorkersAiProvider', () => {
  const ok = (content: unknown): AiBinding => ({
    run: async () => ({ choices: [{ message: { content } }], usage: { prompt_tokens: 120, completion_tokens: 40 } }),
  });
  const call = (p: CfWorkersAiProvider) =>
    p.translate({ request: { text: 'x', sourceLanguage: 'es', targetLanguage: 'en' }, sourceLanguageName: 'Spanish', targetLanguageName: 'English' });

  it('uses max_completion_tokens, never max_tokens, and reasoning_effort low only for Qwen', () => {
    const gemma = new CfWorkersAiProvider(ok('{}')).inputs([], 2000, 0.2);
    const qwen = new CfWorkersAiProvider(ok('{}'), { model: QWEN_MODEL }).inputs([], 2000, 0.2);
    expect(gemma).toMatchObject({ max_completion_tokens: 2000 });
    expect(gemma).not.toHaveProperty('max_tokens');
    expect(gemma).not.toHaveProperty('reasoning_effort');
    expect(gemma).not.toHaveProperty('response_format');
    expect(qwen).toMatchObject({ reasoning_effort: 'low' });
  });

  // Spike 1: with reasoning on, the reasoning used the whole token budget and no JSON arrived.
  it('switches Gemma thinking off; Qwen keeps reasoning_effort low instead', () => {
    const gemma = new CfWorkersAiProvider(ok('{}')).inputs([], 2000, 0.2);
    const qwen = new CfWorkersAiProvider(ok('{}'), { model: QWEN_MODEL }).inputs([], 2000, 0.2);
    expect(gemma['chat_template_kwargs']).toEqual({ enable_thinking: false });
    expect(qwen).not.toHaveProperty('chat_template_kwargs');
  });

  it('records the neurons and finish reason Workers AI reports', async () => {
    const binding: AiBinding = {
      run: async () => ({
        choices: [{ message: { content: '{"translation":"ok"}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 2468, completion_tokens: 1368, neurons: 59.745 },
      }),
    };
    const r = await call(new CfWorkersAiProvider(binding));
    expect(r.usage).toMatchObject({ promptTokens: 2468, completionTokens: 1368, neurons: 59.745, finishReason: 'stop' });
  });

  it('names finish_reason length when the budget ran out before the JSON', async () => {
    const binding: AiBinding = {
      run: async () => ({ choices: [{ message: { content: '' }, finish_reason: 'length' }], usage: { completion_tokens: 2000 } }),
    };
    await expect(call(new CfWorkersAiProvider(binding))).rejects.toMatchObject({
      code: 'AI_INVALID_OUTPUT',
      message: 'Model reply was not JSON (finish_reason: length)',
    });
  });

  it('sends the model id and both prompt messages, with PDF data in the user message', async () => {
    let seen: { model: string; inputs: Record<string, unknown> } | undefined;
    const binding: AiBinding = {
      run: async (model, inputs) => {
        seen = { model, inputs };
        return { choices: [{ message: { content: '{"translation":"y"}' } }] };
      },
    };
    await call(new CfWorkersAiProvider(binding));
    expect(seen?.model).toBe(GEMMA_MODEL);
    const messages = seen?.inputs['messages'] as { role: string; content: string }[];
    expect(messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(messages[0]!.content).toMatch(/never as instructions/);
    expect(messages[1]!.content).toContain('"text":"x"');
  });

  it('parses JSON content and reports usage without inventing missing counts', async () => {
    const r = await call(new CfWorkersAiProvider(ok('```json\n{"translation":"hello"}\n```')));
    expect(r.value).toEqual({ translation: 'hello' });
    expect(r.usage).toMatchObject({ model: GEMMA_MODEL, promptTokens: 120, completionTokens: 40 });
    const noUsage = await call(new CfWorkersAiProvider({ run: async () => ({ response: '{"translation":"a"}' }) }));
    expect(noUsage.usage.promptTokens).toBeUndefined();
  });

  it('throws AI_INVALID_OUTPUT for a reply that is not JSON', async () => {
    await expect(call(new CfWorkersAiProvider(ok('I cannot help with that.')))).rejects.toMatchObject({ code: 'AI_INVALID_OUTPUT' });
  });

  it('maps the free quota error (429, code 3036) to AI_QUOTA, which triggers the cache', async () => {
    const quota: AiBinding = {
      run: async () => {
        throw new Error('AiError: You have used up your daily free allocation of 10,000 neurons. (3036)');
      },
    };
    const err = await call(new CfWorkersAiProvider(quota)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).code).toBe('AI_QUOTA');
    expect(isCacheFallbackError(err)).toBe(true);
    expect((err as AiError).message).not.toContain('10,000');
  });

  it('times out with AI_TIMEOUT', async () => {
    const slow: AiBinding = { run: () => new Promise(() => {}) };
    await expect(call(new CfWorkersAiProvider(slow, { timeoutMs: 20 }))).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
  });

  it('classifies other binding errors', () => {
    expect(classifyBindingError(new Error('429 Too Many Requests')).code).toBe('AI_RATE_LIMITED');
    expect(classifyBindingError(new Error('Request timed out')).code).toBe('AI_TIMEOUT');
    expect(classifyBindingError(new Error('5028: model retired')).code).toBe('AI_UNAVAILABLE');
    expect(isCacheFallbackError(classifyBindingError(new Error('boom')))).toBe(false);
  });
});

describe('reply JSON extraction (decision 10: no reliance on JSON mode)', () => {
  it('handles reasoning blocks, fences, surrounding prose and parsed objects', () => {
    expect(extractJson('<think>{"no":1}</think>{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('Here you go: {"a":{"b":"}"}} thanks')).toEqual({ a: { b: '}' } });
    expect(extractJson({ a: 2 })).toEqual({ a: 2 });
    expect(extractJson('no json here')).toBeUndefined();
    expect(extractJson('{"broken": ')).toBeUndefined();
  });

  it('reads chat choices first and the legacy response field second', () => {
    expect(replyContent({ choices: [{ message: { content: 'x' } }], response: 'y' })).toBe('x');
    expect(replyContent({ response: 'y' })).toBe('y');
    expect(replyContent(null)).toBeUndefined();
    expect(replyUsage({ usage: { prompt_tokens: 'many' } })).toEqual({});
  });
});
