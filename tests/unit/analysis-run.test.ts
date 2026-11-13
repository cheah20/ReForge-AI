/**
 * tests/unit/analysis-run.test.ts
 *
 * Analyze orchestration: validate, retry once, then fall back (requirement 5.6);
 * drop unknown and duplicate entries (5.5); enforce answer-type compatibility
 * (5.5a, Property 2). Quota and timeout errors are not retried.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { runAnalyze, runRetranslate, runTranslate } from '../../src/lib/analysis/run.js';
import {
  COMPATIBLE_ANSWER_TYPES,
  enforceAnswerType,
  isCompatible,
  reconcileAnalysis,
} from '../../src/lib/analysis/reconcile.js';
import { AiError, type AiProvider, type AiReply } from '../../src/lib/ai/interface.js';
import type { AnalyzeRequest, AnswerType, FieldEvidence, PdfFieldType } from '../../src/shared/types.js';

const widget = { pageNumber: 1, bbox: { left: 0, top: 0, right: 10, bottom: 10 }, pageSnippet: 'Name' };
const field = (fieldId: string, fieldType: PdfFieldType, extra: Partial<FieldEvidence> = {}): FieldEvidence => ({
  fieldId,
  fieldType,
  required: false,
  readOnly: false,
  hasValue: false,
  widgets: [widget],
  ...extra,
});

const REQUEST: AnalyzeRequest = {
  contentHash: 'a'.repeat(64),
  interfaceLanguage: 'en',
  detectedFormLanguage: 'ms',
  detectedCountry: 'MY',
  fields: [field('name', 'text', { tooltip: 'Full name' }), field('agree', 'checkbox'), field('state', 'dropdown')],
};

const good = (fields: unknown[]) => ({
  fields,
  formLanguage: 'ms',
  formLanguageConfidence: 0.9,
  formCountry: 'MY',
  formCountryConfidence: 0.9,
});
const entry = (fieldId: string, answerType: AnswerType, confidence = 0.9, humanLabel = `L ${fieldId}`) => ({
  fieldId,
  humanLabel,
  question: `Q ${fieldId}?`,
  answerType,
  confidence,
});

/** A provider that replays a script of replies or errors, counting calls. */
function scripted(steps: Array<unknown | Error>): AiProvider & { calls: number } {
  const p = {
    kind: 'mock' as const,
    calls: 0,
    async next(): Promise<AiReply> {
      const step = steps[Math.min(p.calls, steps.length - 1)];
      p.calls++;
      if (step instanceof Error) throw step;
      return { value: step, usage: { model: 'scripted', durationMs: 1 } };
    },
    analyze() {
      return p.next();
    },
    retranslate() {
      return p.next();
    },
    translate() {
      return p.next();
    },
    analyzeLabels() {
      return p.next();
    },
    analyzePage() {
      return p.next();
    },
  };
  return p;
}

describe('runAnalyze', () => {
  it('returns a valid reply after one call', async () => {
    const p = scripted([good([entry('name', 'text'), entry('agree', 'checkbox'), entry('state', 'dropdown')])]);
    const r = await runAnalyze(p, REQUEST, 'English');
    expect(p.calls).toBe(1);
    expect(r.meta).toMatchObject({ attempts: 1, usedFallback: false });
    expect(r.value.fields).toHaveLength(3);
    expect(r.value.servedFromCache).toBe(false);
  });

  it('retries once after an invalid reply, then uses the valid one', async () => {
    const p = scripted([{ fields: 'nope' }, good([entry('name', 'text')])]);
    const r = await runAnalyze(p, REQUEST, 'English');
    expect(p.calls).toBe(2);
    expect(r.meta.usedFallback).toBe(false);
  });

  it('retries once after non-JSON output (AI_INVALID_OUTPUT)', async () => {
    const p = scripted([new AiError('AI_INVALID_OUTPUT', 'x'), good([entry('name', 'text')])]);
    expect((await runAnalyze(p, REQUEST, 'English')).meta.attempts).toBe(2);
  });

  it('falls back after two invalid replies: PDF labels and types, confidence 0 (requirement 5.6)', async () => {
    const p = scripted([{ bad: 1 }, { bad: 2 }]);
    const r = await runAnalyze(p, REQUEST, 'English');
    expect(p.calls).toBe(2);
    expect(r.meta.usedFallback).toBe(true);
    expect(r.value.fields).toEqual([
      { fieldId: 'name', humanLabel: 'Full name', question: 'Full name', answerType: 'text', confidence: 0 },
      { fieldId: 'agree', humanLabel: 'agree', question: 'agree', answerType: 'checkbox', confidence: 0 },
      { fieldId: 'state', humanLabel: 'state', question: 'state', answerType: 'dropdown', confidence: 0 },
    ]);
    expect(r.value).toMatchObject({ formLanguage: 'ms', formLanguageConfidence: 0, formCountry: 'MY', formCountryConfidence: 0 });
  });

  it.each(['AI_QUOTA', 'AI_RATE_LIMITED', 'AI_TIMEOUT', 'AI_UNAVAILABLE'] as const)('does not retry %s', async (code) => {
    const p = scripted([new AiError(code, 'x'), good([])]);
    await expect(runAnalyze(p, REQUEST, 'English')).rejects.toMatchObject({ code });
    expect(p.calls).toBe(1);
  });

  it('drops unknown and duplicate entries and corrects incompatible types (5.5, 5.5a)', async () => {
    const p = scripted([
      good([
        entry('name', 'phone', 0.8),
        entry('name', 'email', 0.9, 'second'),
        entry('not.in.pdf', 'text'),
        entry('agree', 'text', 0.9),
      ]),
    ]);
    const r = await runAnalyze(p, REQUEST, 'English');
    expect(r.value.fields.map((f) => [f.fieldId, f.answerType, f.confidence])).toEqual([
      ['name', 'phone', 0.8],
      ['agree', 'checkbox', 0],
    ]);
    // `state` was left out by the model: absent here, fill-yourself in the browser.
    const browser = reconcileAnalysis(REQUEST.fields, r.value.fields);
    expect(browser.fields.find((f) => f.evidence.fieldId === 'state')?.status).toBe('fill-yourself');
  });
});

describe('runRetranslate and runTranslate', () => {
  const RT = {
    contentHash: 'a'.repeat(64),
    targetLanguage: 'ms',
    fields: [{ fieldId: 'name', humanLabel: 'Name', question: 'Your name?' }],
  };

  it('keeps only submitted fields, first entry first', async () => {
    const p = scripted([
      {
        fields: [
          { fieldId: 'name', humanLabel: 'Nama', question: 'Nama anda?' },
          { fieldId: 'name', humanLabel: 'Dup', question: 'Dup?' },
          { fieldId: 'other', humanLabel: 'X', question: 'X?' },
        ],
      },
    ]);
    const r = await runRetranslate(p, RT, 'Malay');
    expect(r.value.fields).toEqual([{ fieldId: 'name', humanLabel: 'Nama', question: 'Nama anda?' }]);
  });

  it('fails with AI_INVALID_OUTPUT after two bad replies instead of inventing text', async () => {
    await expect(runRetranslate(scripted([{}, {}]), RT, 'Malay')).rejects.toMatchObject({ code: 'AI_INVALID_OUTPUT' });
    await expect(
      runTranslate(scripted([{ translation: '' }, { nope: 1 }]), { text: 'a', sourceLanguage: 'es', targetLanguage: 'en' }, 'Spanish', 'English'),
    ).rejects.toMatchObject({ code: 'AI_INVALID_OUTPUT' });
  });
});

describe('Property 2: answerType compatibility enforcement', () => {
  const PDF_TYPES = Object.keys(COMPATIBLE_ANSWER_TYPES) as PdfFieldType[];
  const ANSWER_TYPES = [...new Set(Object.values(COMPATIBLE_ANSWER_TYPES).flat())] as AnswerType[];

  it('the result is always compatible; compatible input is unchanged, incompatible becomes the PDF type at confidence 0', () => {
    let incompatibleSeen = 0;
    fc.assert(
      fc.property(
        fc.constantFrom(...PDF_TYPES),
        fc.constantFrom(...ANSWER_TYPES),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (pdfType, answerType, confidence) => {
          const out = enforceAnswerType(pdfType, answerType, confidence);
          expect(isCompatible(pdfType, out.answerType)).toBe(true);
          if (isCompatible(pdfType, answerType)) {
            expect(out).toEqual({ answerType, confidence });
          } else {
            incompatibleSeen++;
            expect(out).toEqual({ answerType: pdfType, confidence: 0 });
          }
        },
      ),
      { numRuns: 500 },
    );
    // The generator must produce incompatible pairs, or the property could not fail.
    expect(incompatibleSeen).toBeGreaterThan(0);
  });

  it('matches requirement 5.5a exactly', () => {
    expect(COMPATIBLE_ANSWER_TYPES).toEqual({
      text: ['text', 'ic', 'phone', 'postcode', 'date', 'email', 'description'],
      checkbox: ['checkbox'],
      radio: ['radio'],
      dropdown: ['dropdown'],
      signature: ['signature'],
    });
  });
});
