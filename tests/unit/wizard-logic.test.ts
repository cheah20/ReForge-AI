/**
 * tests/unit/wizard-logic.test.ts
 *
 * Rules behind the wizard, review and download (tasks 31, 32, 33).
 * Validates: Requirements 6.2, 6.3, 7.5, 8.5, 8.6, 9.1, 10.3, 10.4
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { FieldEvidence, PdfFieldType } from '../../src/shared/types.js';
import type { FieldState } from '../../src/frontend/state.js';
import {
  answersForFill,
  CHECKED,
  constraintsFor,
  filledFileName,
  firstBlockingField,
  needsDateFormatChoice,
  reviewStatus,
  UNCHECKED,
  validateFieldAnswer,
  wizardSteps,
} from '../../src/frontend/wizard-logic.js';

function field(id: string, over: Partial<FieldState> = {}, ev: Partial<FieldEvidence> = {}): FieldState {
  const fieldType = ev.fieldType ?? 'text';
  return {
    evidence: {
      fieldId: id,
      fieldType,
      required: false,
      readOnly: false,
      hasValue: false,
      widgets: [{ pageNumber: 1, bbox: { left: 0, top: 10, right: 100, bottom: 0 }, pageSnippet: '' }],
      ...ev,
    },
    analysis: { fieldId: id, humanLabel: id, question: `${id}?`, answerType: fieldType === 'text' ? 'text' : fieldType, confidence: 0.9 },
    status: 'mapped',
    skipped: false,
    ...over,
  };
}

const OPTIONS = [
  { exportValue: 'SGR', displayLabel: 'Selangor' },
  { exportValue: 'KUL', displayLabel: 'Kuala Lumpur' },
];

describe('wizardSteps', () => {
  it('asks only answerable fields, in form order', () => {
    const fields = [
      field('a'),
      field('ro', {}, { readOnly: true }),
      field('sig', { status: 'fill-yourself' }, { fieldType: 'signature' }),
      field('multi', { status: 'fill-yourself' }, { fieldType: 'dropdown', multiSelect: true }),
      field('low', { status: 'low-confidence' }),
      field('b'),
    ];
    expect(wizardSteps(fields)).toEqual([0, 4, 5]);
  });
});

describe('validateFieldAnswer', () => {
  it('routes IC answers to the MY pack and writes the normalized value', () => {
    const f = field('ic', { analysis: { fieldId: 'ic', humanLabel: 'IC', question: 'IC?', answerType: 'ic', confidence: 0.9 } }, { maxLength: 12 });
    expect(validateFieldAnswer(f, '900101-10-1234', { formCountry: 'MY', today: new Date(2026, 10, 17) })).toEqual({
      valid: true,
      normalizedValue: '900101101234',
    });
    expect(validateFieldAnswer(f, '901301-10-1234', { formCountry: 'MY' }).valid).toBe(false);
  });

  it('routes ZIP answers to the US pack', () => {
    const f = field('zip', { analysis: { fieldId: 'zip', humanLabel: 'ZIP', question: 'ZIP?', answerType: 'postcode', confidence: 0.9 } });
    expect(validateFieldAnswer(f, '02108-1234', { formCountry: 'US' }).valid).toBe(true);
    expect(validateFieldAnswer(f, '021081234', { formCountry: 'US' }).valid).toBe(false);
  });

  it('accepts only the PDF export values for a choice field, never the display label', () => {
    const f = field('state', {}, { fieldType: 'dropdown', options: OPTIONS });
    expect(validateFieldAnswer(f, 'SGR', { formCountry: 'MY' })).toEqual({ valid: true, normalizedValue: 'SGR' });
    expect(validateFieldAnswer(f, 'Selangor', { formCountry: 'MY' })).toEqual({ valid: false, messageKey: 'validation.dropdown.invalid' });
    expect(validateFieldAnswer(field('r', {}, { fieldType: 'dropdown', options: OPTIONS, required: true }), '', { formCountry: 'MY' }).messageKey).toBe(
      'validation.required',
    );
  });

  it('a checkbox answer is checked or unchecked', () => {
    const f = field('box', {}, { fieldType: 'checkbox' });
    expect(validateFieldAnswer(f, CHECKED, { formCountry: 'MY' }).normalizedValue).toBe(CHECKED);
    expect(validateFieldAnswer(f, UNCHECKED, { formCountry: 'MY' }).normalizedValue).toBe(UNCHECKED);
  });

  it('a date asks for the format until the user confirms one, then uses it', () => {
    const date = { analysis: { fieldId: 'd', humanLabel: 'Date', question: 'Date?', answerType: 'date' as const, confidence: 0.9 } };
    const f = field('d', date);
    expect(needsDateFormatChoice(f)).toBe(true);
    expect(validateFieldAnswer(f, '03/04/2026', { formCountry: 'MY' }).needs).toBe('format');
    const chosen = { ...f, dateFormat: 'DD/MM/YYYY' as const };
    expect(needsDateFormatChoice(chosen)).toBe(false);
    expect(validateFieldAnswer(chosen, '2026-04-03', { formCountry: 'MY' }).normalizedValue).toBe('03/04/2026');
  });

  it('a format printed next to the field needs no question', () => {
    const f = field(
      'd',
      { analysis: { fieldId: 'd', humanLabel: 'Date', question: 'Date?', answerType: 'date', confidence: 0.9 } },
      { widgets: [{ pageNumber: 1, bbox: { left: 0, top: 10, right: 100, bottom: 0 }, pageSnippet: 'Date (MM/DD/YYYY)' }] },
    );
    expect(needsDateFormatChoice(f)).toBe(false);
    expect(constraintsFor(f).pageText).toBe('Date (MM/DD/YYYY)');
  });

  it('flags SSN fields from the PDF label', () => {
    const f = field('Text9', {}, { tooltip: 'Social Security Number' });
    expect(constraintsFor(f).ssn).toBe(true);
    expect(validateFieldAnswer(f, '123456789', { formCountry: 'US' }).normalizedValue).toBe('123-45-6789');
  });
});

describe('review status', () => {
  it('names each state in words', () => {
    expect(reviewStatus(field('a', { normalizedOutput: 'x' }))).toBe('filled');
    expect(reviewStatus(field('a', { skipped: true }))).toBe('skipped');
    expect(reviewStatus(field('a'))).toBe('unanswered');
    expect(reviewStatus(field('a', {}, { required: true }))).toBe('missingRequired');
    expect(reviewStatus(field('a', {}, { readOnly: true }))).toBe('readOnly');
    expect(reviewStatus(field('a', { status: 'fill-yourself' }))).toBe('fillYourself');
    expect(reviewStatus(field('a', { status: 'fill-yourself' }, { fieldType: 'signature' }))).toBe('signed');
  });

  it('a skipped required field does not block the download; an unanswered one does', () => {
    expect(firstBlockingField([field('a', { normalizedOutput: 'x' }), field('b', {}, { required: true })])).toBe(1);
    expect(firstBlockingField([field('b', { skipped: true }, { required: true })])).toBe(-1);
  });
});

describe('answersForFill', () => {
  it('maps each answer kind and leaves skipped and review-only fields out', () => {
    const fields = [
      field('name', { normalizedOutput: 'LIN MEI TEST' }),
      field('box', { normalizedOutput: CHECKED }, { fieldType: 'checkbox' }),
      field('box2', { normalizedOutput: UNCHECKED }, { fieldType: 'checkbox' }),
      field('state', { normalizedOutput: 'SGR' }, { fieldType: 'dropdown', options: OPTIONS }),
      field('gender', { normalizedOutput: 'F' }, { fieldType: 'radio' }),
      field('skip', { skipped: true }),
      field('ro', { normalizedOutput: 'x' }, { readOnly: true }),
      field('self', { normalizedOutput: 'x', status: 'fill-yourself' }),
    ];
    expect([...answersForFill(fields)]).toEqual([
      ['name', { kind: 'text', value: 'LIN MEI TEST' }],
      ['box', { kind: 'checkbox', state: 'checked' }],
      ['box2', { kind: 'checkbox', state: 'unchecked' }],
      ['state', { kind: 'choice', exportValue: 'SGR' }],
      ['gender', { kind: 'choice', exportValue: 'F' }],
    ]);
  });

  it('writes a description translation only after approval (8.6)', () => {
    const desc = { fieldId: 'd', humanLabel: 'D', question: 'D?', answerType: 'description' as const, confidence: 0.9 };
    const translation = { source: 'headache', sourceLanguage: 'en', targetLanguage: 'ms', text: 'sakit kepala', approved: false };
    const pending = field('d', { analysis: desc, normalizedOutput: 'headache', translation });
    expect(answersForFill([pending]).get('d')).toEqual({ kind: 'text', value: 'headache' });
    const approved = field('d', { analysis: desc, normalizedOutput: 'headache', translation: { ...translation, approved: true } });
    expect(answersForFill([approved]).get('d')).toEqual({ kind: 'text', value: 'sakit kepala' });
  });

  it('property: only answered, writable, unskipped fields are written, each exactly once with its own value', () => {
    const types: PdfFieldType[] = ['text', 'checkbox', 'radio', 'dropdown', 'signature'];
    const arbField = fc.record({
      type: fc.constantFrom(...types),
      readOnly: fc.boolean(),
      skipped: fc.boolean(),
      fillYourself: fc.boolean(),
      answer: fc.option(fc.constantFrom('', 'value', CHECKED, UNCHECKED, 'SGR'), { nil: undefined }),
    });
    let wrote = 0;
    let left = 0;
    fc.assert(
      fc.property(fc.array(arbField, { minLength: 1, maxLength: 12 }), (specs) => {
        const fields = specs.map((s, i) =>
          field(
            `f${i}`,
            { skipped: s.skipped, status: s.fillYourself || s.type === 'signature' ? 'fill-yourself' : 'mapped', ...(s.answer !== undefined ? { normalizedOutput: s.answer } : {}) },
            { fieldType: s.type, readOnly: s.readOnly },
          ),
        );
        const out = answersForFill(fields);
        fields.forEach((f, i) => {
          const s = specs[i]!;
          const writable = !s.readOnly && !s.skipped && !s.fillYourself && s.type !== 'signature' && !!s.answer;
          expect(out.has(f.evidence.fieldId)).toBe(writable);
          if (writable) {
            wrote++;
            const a = out.get(f.evidence.fieldId)!;
            if (s.type === 'text') expect(a).toEqual({ kind: 'text', value: s.answer });
            if (s.type === 'checkbox') expect(a).toEqual({ kind: 'checkbox', state: s.answer === CHECKED ? 'checked' : 'unchecked' });
            if (s.type === 'radio' || s.type === 'dropdown') expect(a).toEqual({ kind: 'choice', exportValue: s.answer });
          } else left++;
        });
      }),
      { numRuns: 200 },
    );
    expect(wrote).toBeGreaterThan(0);
    expect(left).toBeGreaterThan(0);
  });
});

describe('filledFileName', () => {
  it.each([
    ['clinic-registration.pdf', 'clinic-registration-filled.pdf'],
    ['Form.PDF', 'Form-filled.pdf'],
    ['a/b:c.pdf', 'a_b_c-filled.pdf'],
    ['.pdf', 'form-filled.pdf'],
  ])('%s -> %s', (input, out) => {
    expect(filledFileName(input)).toBe(out);
  });
});
