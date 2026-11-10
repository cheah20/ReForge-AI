/**
 * tests/unit/schemas.test.ts
 *
 * Tests for src/shared/schemas.ts — boundary value acceptance and rejection.
 * Task 4.3: fieldId at 256/257 chars, humanLabel at 40/41, question at 120/121,
 * fields array at 30/31 items.
 */

import { describe, it, expect } from 'vitest';
import {
  FieldEvidenceSchema,
  FieldAnalysisSchema,
  AnalyzeRequestSchema,
  AnalyzeResponseSchema,
  RetranslateRequestSchema,
  TranslateRequestSchema,
  ApiErrorSchema,
} from '../../src/shared/schemas.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWidget(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    pageNumber: 1,
    bbox: { left: 0, top: 0, right: 100, bottom: 20 },
    pageSnippet: 'nearby text',
    ...overrides,
  };
}

function makeFieldEvidence(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    fieldId: 'patient.name',
    fieldType: 'text',
    required: false,
    readOnly: false,
    widgets: [makeWidget()],
    hasValue: false,
    ...overrides,
  };
}

function makeFieldAnalysis(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    fieldId: 'patient.name',
    humanLabel: 'Full name',
    question: 'What is your full name?',
    answerType: 'text',
    confidence: 0.95,
    ...overrides,
  };
}

function makeAnalyzeRequest(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    contentHash: 'a'.repeat(64),
    fields: [makeFieldEvidence()],
    interfaceLanguage: 'en',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// FieldEvidenceSchema — fieldId boundary
// ---------------------------------------------------------------------------

describe('FieldEvidenceSchema — fieldId boundary', () => {
  it('accepts fieldId of exactly 256 characters', () => {
    const result = FieldEvidenceSchema.safeParse(
      makeFieldEvidence({ fieldId: 'x'.repeat(256) }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects fieldId of 257 characters', () => {
    const result = FieldEvidenceSchema.safeParse(
      makeFieldEvidence({ fieldId: 'x'.repeat(257) }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects empty fieldId', () => {
    const result = FieldEvidenceSchema.safeParse(
      makeFieldEvidence({ fieldId: '' }),
    );
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FieldAnalysisSchema — humanLabel and question boundaries
// ---------------------------------------------------------------------------

describe('FieldAnalysisSchema — humanLabel boundary', () => {
  it('accepts humanLabel of exactly 40 characters', () => {
    const result = FieldAnalysisSchema.safeParse(
      makeFieldAnalysis({ humanLabel: 'x'.repeat(40) }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects humanLabel of 41 characters', () => {
    const result = FieldAnalysisSchema.safeParse(
      makeFieldAnalysis({ humanLabel: 'x'.repeat(41) }),
    );
    expect(result.success).toBe(false);
  });
});

describe('FieldAnalysisSchema — question boundary', () => {
  it('accepts question of exactly 120 characters', () => {
    const result = FieldAnalysisSchema.safeParse(
      makeFieldAnalysis({ question: 'x'.repeat(120) }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects question of 121 characters', () => {
    const result = FieldAnalysisSchema.safeParse(
      makeFieldAnalysis({ question: 'x'.repeat(121) }),
    );
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AnalyzeRequestSchema — fields array boundary (30/31)
// ---------------------------------------------------------------------------

describe('AnalyzeRequestSchema — fields array boundary', () => {
  it('accepts exactly 30 fields', () => {
    const fields = Array.from({ length: 30 }, (_, i) =>
      makeFieldEvidence({ fieldId: `field.${i}` }),
    );
    const result = AnalyzeRequestSchema.safeParse(
      makeAnalyzeRequest({ fields }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects 31 fields', () => {
    const fields = Array.from({ length: 31 }, (_, i) =>
      makeFieldEvidence({ fieldId: `field.${i}` }),
    );
    const result = AnalyzeRequestSchema.safeParse(
      makeAnalyzeRequest({ fields }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects empty fields array', () => {
    const result = AnalyzeRequestSchema.safeParse(
      makeAnalyzeRequest({ fields: [] }),
    );
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AnalyzeRequestSchema — contentHash must be exactly 64 hex chars
// ---------------------------------------------------------------------------

describe('AnalyzeRequestSchema — contentHash', () => {
  it('accepts 64-char hash', () => {
    const result = AnalyzeRequestSchema.safeParse(makeAnalyzeRequest());
    expect(result.success).toBe(true);
  });

  it('rejects 63-char hash', () => {
    const result = AnalyzeRequestSchema.safeParse(
      makeAnalyzeRequest({ contentHash: 'a'.repeat(63) }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects 65-char hash', () => {
    const result = AnalyzeRequestSchema.safeParse(
      makeAnalyzeRequest({ contentHash: 'a'.repeat(65) }),
    );
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AnalyzeResponseSchema — basic acceptance
// ---------------------------------------------------------------------------

describe('AnalyzeResponseSchema', () => {
  it('accepts a valid response', () => {
    const result = AnalyzeResponseSchema.safeParse({
      fields: [makeFieldAnalysis()],
      formLanguage: 'ms',
      formLanguageConfidence: 0.9,
      formCountry: 'MY',
      formCountryConfidence: 0.85,
    });
    expect(result.success).toBe(true);
  });

  it('accepts servedFromCache flag', () => {
    const result = AnalyzeResponseSchema.safeParse({
      fields: [],
      formLanguage: 'en',
      formLanguageConfidence: 1,
      formCountry: 'US',
      formCountryConfidence: 1,
      servedFromCache: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects confidence out of range', () => {
    const result = AnalyzeResponseSchema.safeParse({
      fields: [],
      formLanguage: 'en',
      formLanguageConfidence: 1.5,
      formCountry: 'US',
      formCountryConfidence: 0,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RetranslateRequestSchema
// ---------------------------------------------------------------------------

describe('RetranslateRequestSchema', () => {
  it('accepts a valid retranslate request', () => {
    const result = RetranslateRequestSchema.safeParse({
      contentHash: 'b'.repeat(64),
      fields: [{ fieldId: 'patient.name' }],
      targetLanguage: 'zh-Hans',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty fields array', () => {
    const result = RetranslateRequestSchema.safeParse({
      contentHash: 'b'.repeat(64),
      fields: [],
      targetLanguage: 'zh-Hans',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TranslateRequestSchema
// ---------------------------------------------------------------------------

describe('TranslateRequestSchema', () => {
  it('accepts valid translate request', () => {
    const result = TranslateRequestSchema.safeParse({
      text: 'Hello',
      sourceLanguage: 'zh-Hans',
      targetLanguage: 'ms',
    });
    expect(result.success).toBe(true);
  });

  it('rejects text longer than 2000 chars', () => {
    const result = TranslateRequestSchema.safeParse({
      text: 'x'.repeat(2001),
      sourceLanguage: 'en',
      targetLanguage: 'ms',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ApiErrorSchema
// ---------------------------------------------------------------------------

describe('ApiErrorSchema', () => {
  it('accepts valid error shape', () => {
    const result = ApiErrorSchema.safeParse({
      error: { code: 'AI_UNAVAILABLE', message: 'Service temporarily unavailable' },
    });
    expect(result.success).toBe(true);
  });
});
