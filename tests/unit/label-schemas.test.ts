/**
 * tests/unit/label-schemas.test.ts
 *
 * Label analysis schemas (formbridge-any-document task 2.6): every bound of
 * Requirement 13.2 on both sides, strictness, Label_Id consistency and
 * uniqueness, the 13.6 explanation and example bounds, and error paths that
 * name schema paths, never submitted values.
 * Validates: Requirements 13.1, 13.2, 13.5, 13.6
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import {
  KeptLabelSchema,
  LABEL_ID_PATTERN,
  LabelAnalysisRequestSchema,
  LabelAnalysisResponseSchema,
  LabelAnalysisSchema,
  LabelAnswerTypeSchema,
  LabelBatchReplyEnvelopeSchema,
} from '../../src/shared/schemas.js';
import type { KeptLabel, LabelAnalysis, LabelAnalysisRequest } from '../../src/shared/types.js';

const label = (pageNumber: number, readingOrder: number, text = 'Full name'): KeptLabel => ({
  labelId: `p${pageNumber}-l${readingOrder}`,
  text,
  pageNumber,
  readingOrder,
});

const request = (labels: KeptLabel[], extra: Partial<LabelAnalysisRequest> = {}): LabelAnalysisRequest => ({
  labels,
  interfaceLanguage: 'zh-Hans',
  formLanguage: 'ms',
  formCountry: 'MY',
  ...extra,
});

/** `count` distinct, consistent labels spread over pages 1..5. */
const manyLabels = (count: number) => Array.from({ length: count }, (_, i) => label((i % 5) + 1, Math.floor(i / 5)));

const analysis = (extra: Partial<LabelAnalysis> = {}): LabelAnalysis => ({
  fieldId: 'p1-l0',
  humanLabel: 'Full name',
  question: 'What is your full name?',
  answerType: 'text',
  confidence: 0.9,
  ...extra,
});

/** Every issue path of a failed parse, joined with dots. */
function issuePaths(schema: z.ZodTypeAny, value: unknown): string[] {
  const r = schema.safeParse(value);
  expect(r.success).toBe(false);
  return r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
}

describe('LABEL_ID_PATTERN', () => {
  it.each(['p1-l0', 'p5-l9999', 'p3-l10', 'p2-l1'])('accepts %s', (id) => {
    expect(LABEL_ID_PATTERN.test(id)).toBe(true);
  });
  it.each(['p0-l0', 'p6-l0', 'p1-l10000', 'p1-l01', 'p1-l-1', 'P1-l0', 'p1-l', 'p1-l0 ', 'xp1-l0', 'p10-l0'])('rejects %s', (id) => {
    expect(LABEL_ID_PATTERN.test(id)).toBe(false);
  });
});

describe('KeptLabelSchema bounds (13.2)', () => {
  it('accepts text of 200 characters and rejects 201', () => {
    expect(KeptLabelSchema.safeParse(label(1, 0, 'a'.repeat(200))).success).toBe(true);
    expect(issuePaths(KeptLabelSchema, label(1, 0, 'a'.repeat(201)))).toEqual(['text']);
  });

  it('rejects empty and whitespace-only text', () => {
    expect(issuePaths(KeptLabelSchema, label(1, 0, ''))).toContain('text');
    expect(issuePaths(KeptLabelSchema, label(1, 0, '   '))).toEqual(['text']);
  });

  it('accepts page 1 and 5, rejects 0 and 6', () => {
    expect(KeptLabelSchema.safeParse(label(1, 0)).success).toBe(true);
    expect(KeptLabelSchema.safeParse(label(5, 0)).success).toBe(true);
    expect(issuePaths(KeptLabelSchema, { ...label(1, 0), pageNumber: 0 })).toEqual(['pageNumber']);
    expect(issuePaths(KeptLabelSchema, { ...label(5, 0), pageNumber: 6 })).toEqual(['pageNumber']);
  });

  it('accepts reading order 0 and 9999, rejects -1 and 10000', () => {
    expect(KeptLabelSchema.safeParse(label(1, 0)).success).toBe(true);
    expect(KeptLabelSchema.safeParse(label(1, 9999)).success).toBe(true);
    expect(issuePaths(KeptLabelSchema, { ...label(1, 0), readingOrder: -1 })).toEqual(['readingOrder']);
    expect(issuePaths(KeptLabelSchema, { ...label(1, 9999), readingOrder: 10000 })).toEqual(['readingOrder']);
  });

  it('rejects non-integer page and reading order', () => {
    expect(issuePaths(KeptLabelSchema, { ...label(1, 0), pageNumber: 1.5 })).toEqual(['pageNumber']);
    expect(issuePaths(KeptLabelSchema, { ...label(1, 0), readingOrder: 0.5 })).toEqual(['readingOrder']);
  });

  it('rejects an extra key such as a box (13.1)', () => {
    const r = KeptLabelSchema.safeParse({ ...label(1, 0), box: { left: 0, top: 0, right: 1, bottom: 1 } });
    expect(r.success).toBe(false);
    expect(r.success ? [] : r.error.issues.map((i) => i.code)).toEqual(['unrecognized_keys']);
  });
});

describe('LabelAnalysisRequestSchema (13.1, 13.2)', () => {
  it('accepts a request with optional form settings left out', () => {
    expect(LabelAnalysisRequestSchema.safeParse({ labels: [label(1, 0)], interfaceLanguage: 'en' }).success).toBe(true);
  });

  it('accepts 1 and 150 labels, rejects 0 and 151', () => {
    expect(LabelAnalysisRequestSchema.safeParse(request(manyLabels(1))).success).toBe(true);
    expect(LabelAnalysisRequestSchema.safeParse(request(manyLabels(150))).success).toBe(true);
    expect(issuePaths(LabelAnalysisRequestSchema, request([]))).toEqual(['labels']);
    expect(issuePaths(LabelAnalysisRequestSchema, request(manyLabels(151)))).toEqual(['labels']);
  });

  it('rejects an extra top-level key such as contentHash or answers', () => {
    for (const extra of [{ contentHash: 'a'.repeat(64) }, { answers: ['x'] }]) {
      const r = LabelAnalysisRequestSchema.safeParse({ ...request([label(1, 0)]), ...extra });
      expect(r.success).toBe(false);
      expect(r.success ? [] : r.error.issues.map((i) => i.code)).toEqual(['unrecognized_keys']);
    }
  });

  it('rejects an extra key inside a label with the path of that label', () => {
    expect(issuePaths(LabelAnalysisRequestSchema, request([label(1, 0), { ...label(1, 1), value: 'x' } as KeptLabel]))).toEqual([
      'labels.1',
    ]);
  });

  it('rejects a Label_Id that does not match its page and reading order', () => {
    const r = LabelAnalysisRequestSchema.safeParse(request([label(1, 0), { ...label(1, 1), labelId: 'p1-l2' }]));
    expect(r.success).toBe(false);
    expect(r.success ? [] : r.error.issues.map((i) => [i.path.join('.'), i.message])).toEqual([
      ['labels', 'labelId must match pageNumber and readingOrder'],
    ]);
    expect(LabelAnalysisRequestSchema.safeParse(request([{ ...label(2, 3), pageNumber: 1 }])).success).toBe(false);
  });

  it('rejects duplicate Label_Ids', () => {
    const r = LabelAnalysisRequestSchema.safeParse(request([label(1, 0, 'Name'), label(1, 0, 'Address')]));
    expect(r.success).toBe(false);
    expect(r.success ? [] : r.error.issues.map((i) => [i.path.join('.'), i.message])).toEqual([
      ['labels', 'labelId values must be unique'],
    ]);
  });

  it('bounds the language tags (2..20) and the country (two capital letters)', () => {
    expect(LabelAnalysisRequestSchema.safeParse(request([label(1, 0)], { interfaceLanguage: 'a'.repeat(20) })).success).toBe(true);
    expect(issuePaths(LabelAnalysisRequestSchema, request([label(1, 0)], { interfaceLanguage: 'a'.repeat(21) }))).toEqual([
      'interfaceLanguage',
    ]);
    expect(issuePaths(LabelAnalysisRequestSchema, request([label(1, 0)], { interfaceLanguage: 'e' }))).toEqual(['interfaceLanguage']);
    expect(issuePaths(LabelAnalysisRequestSchema, request([label(1, 0)], { formLanguage: 'a'.repeat(21) }))).toEqual(['formLanguage']);
    expect(issuePaths(LabelAnalysisRequestSchema, request([label(1, 0)], { formCountry: 'my' }))).toEqual(['formCountry']);
    expect(issuePaths(LabelAnalysisRequestSchema, request([label(1, 0)], { formCountry: 'MYS' }))).toEqual(['formCountry']);
  });

  it('error issues name schema paths and never carry the submitted value', () => {
    const canary = 'CANARY-LABEL-7731'.padEnd(201, 'x');
    const r = LabelAnalysisRequestSchema.safeParse(request([label(1, 0, canary)]));
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues.map((i) => i.path.join('.'))).toEqual(['labels.0.text']);
    expect(JSON.stringify(r.error.issues)).not.toContain('CANARY-LABEL-7731');
  });
});

describe('LabelAnalysisSchema (13.5, 13.6)', () => {
  it('accepts every label answer type and rejects the choice types', () => {
    for (const t of LabelAnswerTypeSchema.options) expect(LabelAnalysisSchema.safeParse(analysis({ answerType: t })).success).toBe(true);
    expect(LabelAnswerTypeSchema.options).toEqual(['text', 'ic', 'phone', 'postcode', 'date', 'email', 'description', 'signature']);
    for (const t of ['checkbox', 'radio', 'dropdown']) {
      expect(issuePaths(LabelAnalysisSchema, { ...analysis(), answerType: t })).toEqual(['answerType']);
    }
  });

  it('requires a Label_Id in the fieldId position', () => {
    expect(issuePaths(LabelAnalysisSchema, analysis({ fieldId: 'patient.fullName' }))).toEqual(['fieldId']);
  });

  it('accepts confidence 0 and 1, rejects values outside', () => {
    expect(LabelAnalysisSchema.safeParse(analysis({ confidence: 0 })).success).toBe(true);
    expect(LabelAnalysisSchema.safeParse(analysis({ confidence: 1 })).success).toBe(true);
    expect(issuePaths(LabelAnalysisSchema, analysis({ confidence: -0.01 }))).toEqual(['confidence']);
    expect(issuePaths(LabelAnalysisSchema, analysis({ confidence: 1.01 }))).toEqual(['confidence']);
  });

  it('accepts an explanation of 200 characters and rejects 201', () => {
    expect(LabelAnalysisSchema.safeParse(analysis({ explanation: 'e'.repeat(200) })).success).toBe(true);
    expect(issuePaths(LabelAnalysisSchema, analysis({ explanation: 'e'.repeat(201) }))).toEqual(['explanation']);
  });

  it('accepts an example of 60 characters and rejects 61', () => {
    expect(LabelAnalysisSchema.safeParse(analysis({ example: 'x'.repeat(60) })).success).toBe(true);
    expect(issuePaths(LabelAnalysisSchema, analysis({ example: 'x'.repeat(61) }))).toEqual(['example']);
  });

  it('keeps the Fillable_Path bounds on humanLabel (40) and question (120)', () => {
    expect(LabelAnalysisSchema.safeParse(analysis({ humanLabel: 'h'.repeat(40), question: 'q'.repeat(120) })).success).toBe(true);
    expect(issuePaths(LabelAnalysisSchema, analysis({ humanLabel: 'h'.repeat(41) }))).toEqual(['humanLabel']);
    expect(issuePaths(LabelAnalysisSchema, analysis({ question: 'q'.repeat(121) }))).toEqual(['question']);
  });
});

describe('LabelBatchReplyEnvelopeSchema and LabelAnalysisResponseSchema', () => {
  const envelope = { formLanguage: 'ms', formLanguageConfidence: 0.8, formCountry: 'MY', formCountryConfidence: 0.8 };

  it('the batch envelope accepts 30 unchecked entries and rejects 31', () => {
    expect(LabelBatchReplyEnvelopeSchema.safeParse({ ...envelope, fields: Array.from({ length: 30 }, () => ({ any: 1 })) }).success).toBe(
      true,
    );
    expect(issuePaths(LabelBatchReplyEnvelopeSchema, { ...envelope, fields: Array.from({ length: 31 }, () => 1) })).toEqual(['fields']);
  });

  it('the response accepts 150 analyses and 150 failed ids, and rejects 151 of either', () => {
    const ids = manyLabels(151).map((l) => l.labelId);
    const fields = ids.map((id) => analysis({ fieldId: id }));
    expect(LabelAnalysisResponseSchema.safeParse({ ...envelope, fields: fields.slice(0, 150), failedLabelIds: [] }).success).toBe(true);
    expect(LabelAnalysisResponseSchema.safeParse({ ...envelope, fields: [], failedLabelIds: ids.slice(0, 150) }).success).toBe(true);
    expect(issuePaths(LabelAnalysisResponseSchema, { ...envelope, fields, failedLabelIds: [] })).toEqual(['fields']);
    expect(issuePaths(LabelAnalysisResponseSchema, { ...envelope, fields: [], failedLabelIds: ids })).toEqual(['failedLabelIds']);
  });

  it('the response rejects a failed id that is not a Label_Id', () => {
    expect(issuePaths(LabelAnalysisResponseSchema, { ...envelope, fields: [], failedLabelIds: ['name'] })).toEqual(['failedLabelIds.0']);
  });
});
