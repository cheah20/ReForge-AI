/**
 * tests/unit/document-session.test.ts
 *
 * The Document_Path session (formbridge-any-document tasks 10.1, 10.2, 10.14):
 * Kept_Labels become ordinary wizard fields, a label without an analysis is
 * asked in Original_Label_Mode, answers are validated by the existing country
 * pack path, the three language settings stay separate, a new file discards
 * everything, and the leave-page warning follows the session.
 * Validates: Requirements 4.5, 4.8, 10.1, 10.2, 13.8, 13.9, 14.2, 15.1, 15.3, 16.2, 18.1, 20.3
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildDocumentFields, discardDocument, fieldFromKeptLabel, originalLabelQuestion, setOcrLanguage, startDocumentSession } from '../../src/frontend/document/session.js';
import { createLeaveGuard, hasUnsavedWork, onBeforeUnload, type LeaveTarget } from '../../src/frontend/document/leave-guard.js';
import { createSession, type SessionState } from '../../src/frontend/state.js';
import { documentReviewStatus, documentWizardTotal, undoRule, validateFieldAnswer, wizardSteps } from '../../src/frontend/wizard-logic.js';
import { buildCandidates, buildPage, createModel } from '../../src/lib/document/model.js';
import { initialReview, keptLabels, reduceReview } from '../../src/lib/document/review.js';
import { classifyByValueRules } from '../../src/lib/document/value-rules.js';
import { translate } from '../../src/packs/language/registry.js';
import type { LabelAnalysis } from '../../src/shared/types.js';

interface Mock {
  width: number;
  height: number;
  lines: Array<{ text: string; box: { left: number; top: number; right: number; bottom: number }; confidence: number }>;
}
const mock = (JSON.parse(readFileSync('fixtures/documents/expected.json', 'utf8')) as { fixtures: Array<{ file: string; pages?: Array<{ mock?: Mock }> }> }).fixtures.find((f) => f.file === 'clean-en.png')!.pages![0]!.mock!;

function modelAndKept(labels: string[]) {
  const page = buildPage({ pageNumber: 1, width: mock.width, height: mock.height, rotation: 0, textSource: 'ocr', lines: mock.lines });
  const model = createModel('png', [page], buildCandidates([page], null, 'eng', classifyByValueRules));
  let review = initialReview(model.candidates);
  for (const text of labels) {
    const item = review.find((i) => i.text === text)!;
    review = reduceReview(review, { type: 'toggle', labelId: item.labelId });
  }
  return { model, kept: keptLabels(review), page };
}

const analysis = (labelId: string, answerType: LabelAnalysis['answerType'], extra: Partial<LabelAnalysis> = {}): LabelAnalysis => ({
  fieldId: labelId,
  humanLabel: 'Human label',
  question: 'What is it?',
  answerType,
  confidence: 0.9,
  ...extra,
});

describe('Kept_Label to wizard field (10.1)', () => {
  const { model, kept, page } = modelAndKept(['Full name:', 'Phone number:', 'Reason for visit:', 'Signature:']);
  const idOf = (text: string) => kept.find((k) => k.text === text)!.labelId;
  const analyses = new Map<string, LabelAnalysis>([
    [idOf('Full name:'), analysis(idOf('Full name:'), 'text', { explanation: 'Your name as on your card.', example: 'Sam Example' })],
    [idOf('Phone number:'), analysis(idOf('Phone number:'), 'phone')],
    [idOf('Reason for visit:'), analysis(idOf('Reason for visit:'), 'description')],
    [idOf('Signature:'), analysis(idOf('Signature:'), 'signature')],
  ]);
  const fields = buildDocumentFields({ model, kept, analyses, interfaceLanguage: 'en' });
  const byText = (t: string) => fields.find((f) => f.origin!.text === t)!;

  it('makes one field per Kept_Label in page and reading order, with the Label_Id as the field id', () => {
    expect(fields.map((f) => f.evidence.fieldId)).toEqual(kept.map((k) => k.labelId));
    expect(new Set(fields.map((f) => f.evidence.fieldId)).size).toBe(4);
  });

  it('follows the mapping table: required, bounded, label as tooltip, the line as the widget, nothing prefilled', () => {
    const name = byText('Full name:');
    const line = page.lines.find((l) => l.text === 'Full name:')!;
    expect(name.evidence).toMatchObject({ fieldType: 'text', required: true, readOnly: false, hasValue: false, maxLength: 200, tooltip: 'Full name:' });
    expect(name.evidence.widgets).toEqual([{ pageNumber: 1, bbox: line.box, pageSnippet: '' }]);
    expect(name.status).toBe('mapped');
    expect(name.skipped).toBe(false);
    expect(byText('Reason for visit:').evidence.maxLength).toBe(2000);
    expect(byText('Signature:').evidence.fieldType).toBe('signature');
  });

  it('keeps the validated explanation and example in the local origin, never in the analysis', () => {
    const name = byText('Full name:');
    expect(name.origin).toMatchObject({ pageNumber: 1, text: 'Full name:', textLang: 'en', checkYourself: false, explanation: 'Your name as on your card.', example: 'Sam Example' });
    expect(name.analysis).toEqual({ fieldId: name.evidence.fieldId, humanLabel: 'Human label', question: 'What is it?', answerType: 'text', confidence: 0.9 });
    expect(byText('Phone number:').origin!.explanation).toBeUndefined();
  });

  it('a signature is asked nowhere: it is review-only and not counted in "Question n of m" (13.9, 15.1)', () => {
    expect(wizardSteps(fields)).toHaveLength(3);
    expect(documentWizardTotal(fields)).toBe(3);
    expect(documentReviewStatus(byText('Signature:'))).toBe('signYourself');
  });

  it('a label with no analysis is asked in Original_Label_Mode with its text quoted unchanged, and the others keep their AI question (13.8, 14.2)', () => {
    const partial = buildDocumentFields({ model, kept, analyses: new Map([[idOf('Phone number:'), analysis(idOf('Phone number:'), 'phone')]]), interfaceLanguage: 'en' });
    const name = partial.find((f) => f.origin!.text === 'Full name:')!;
    expect(name.analysis).toMatchObject({ answerType: 'text', confidence: 0, humanLabel: 'Full name:' });
    expect(name.analysis!.question).toBe(originalLabelQuestion('Full name:', 'en'));
    expect(name.analysis!.question).toContain('Full name:');
    expect(partial.find((f) => f.origin!.text === 'Phone number:')!.analysis!.question).toBe('What is it?');
  });

  it('the Original_Label_Mode sentence comes from the locale and quotes even a long label whole', () => {
    const long = 'Name of the parent or guardian of the patient and relation to the patient:';
    expect(originalLabelQuestion(long, 'ms')).toContain(long);
    expect(originalLabelQuestion(long, 'ms')).toBe(translate('ms', 'document.originalMode.question', { label: long }));
    const field = fieldFromKeptLabel({ kept: { labelId: 'p1-l0', text: long, pageNumber: 1, readingOrder: 0 }, box: { left: 0, top: 0, right: 5, bottom: 5 }, textLang: 'en', checkYourself: false }, 'en', null);
    expect([...field.analysis!.humanLabel].length).toBeLessThanOrEqual(40);
    expect(field.analysis!.question).toContain(long);
  });
});

describe('answers are checked by the existing pack path (16.2)', () => {
  const field = (answerType: LabelAnalysis['answerType'], text: string) =>
    fieldFromKeptLabel({ kept: { labelId: 'p1-l1', text, pageNumber: 1, readingOrder: 1 }, box: { left: 0, top: 0, right: 5, bottom: 5 }, textLang: 'en', checkYourself: false }, 'en', analysis('p1-l1', answerType));
  const check = (f: ReturnType<typeof field>, raw: string) => validateFieldAnswer(f, raw, { formCountry: 'MY' });

  it('a phone number is normalised by the Malaysian pack and a bad one is refused with the pack message', () => {
    const f = field('phone', 'Phone number:');
    expect(check(f, '0112345 6789')).toMatchObject({ valid: true, normalizedValue: '011-2345 6789' });
    expect(check(f, '12')).toMatchObject({ valid: false });
  });

  it('a plain text answer takes 1 to 200 code points and an empty one is refused', () => {
    const f = field('text', 'Full name:');
    expect(check(f, 'a'.repeat(200)).valid).toBe(true);
    expect(check(f, 'a'.repeat(201))).toMatchObject({ valid: false, messageKey: 'validation.maxLength' });
    expect(check(f, '')).toMatchObject({ valid: false, messageKey: 'validation.required' });
    expect(check(f, '   ')).toMatchObject({ valid: false });
  });

  it('a description takes up to 2,000 code points', () => {
    const f = field('description', 'Reason for visit:');
    expect(check(f, 'b'.repeat(2000)).valid).toBe(true);
    expect(check(f, 'b'.repeat(2001))).toMatchObject({ valid: false, messageKey: 'validation.maxLength' });
  });

  it('a date label that prints its format needs no format question', () => {
    const f = field('date', 'Date of birth (DD/MM/YYYY):');
    expect(check(f, '17/11/2026')).toMatchObject({ valid: true });
    expect(check(f, '31/02/1990')).toMatchObject({ valid: false });
  });
});

describe('review status and undo (15.3, 15.7, 18.1)', () => {
  const base = fieldFromKeptLabel({ kept: { labelId: 'p1-l1', text: 'Name:', pageNumber: 1, readingOrder: 1 }, box: { left: 0, top: 0, right: 5, bottom: 5 }, textLang: 'en', checkYourself: false }, 'en', analysis('p1-l1', 'text'));

  it('exactly one status: filled, skipped (also when nothing was answered) or sign yourself', () => {
    expect(documentReviewStatus({ ...base, normalizedOutput: 'Sam' })).toBe('filled');
    expect(documentReviewStatus({ ...base, normalizedOutput: 'Sam', skipped: true })).toBe('skipped');
    expect(documentReviewStatus(base)).toBe('skipped');
  });

  it('undo is offered when the answer differs from the one on arrival, and restores that one', () => {
    expect(undoRule('Sam', 'Sam')).toEqual({ available: false, restoreTo: 'Sam' });
    expect(undoRule('', 'Sam')).toEqual({ available: true, restoreTo: '' });
    expect(undoRule('Sam', '')).toEqual({ available: true, restoreTo: 'Sam' });
  });
});

describe('separate settings and a new file (10.1, 10.2, 4.8)', () => {
  const { model } = modelAndKept(['Full name:']);
  const withDoc = (): SessionState => ({
    ...createSession('zh-Hans'),
    formLanguage: 'ms',
    formCountry: 'MY',
    document: startDocumentSession(model, 'msa'),
    fields: [{ ...fieldFromKeptLabel({ kept: { labelId: 'p1-l0', text: 'Full name:', pageNumber: 1, readingOrder: 0 }, box: { left: 0, top: 0, right: 5, bottom: 5 }, textLang: 'ms', checkYourself: false }, 'zh-Hans', null), rawAnswer: 'Sam' }],
  });

  it('changing the OCR_Language leaves the interface language, the form language and the answers alone', () => {
    const next = setOcrLanguage(withDoc(), 'eng');
    expect(next.document!.ocrLanguage).toBe('eng');
    expect([next.interfaceLanguage, next.formLanguage, next.formCountry]).toEqual(['zh-Hans', 'ms', 'MY']);
    expect(next.fields[0]!.rawAnswer).toBe('Sam');
    expect(setOcrLanguage(createSession('en'), 'eng').document).toBeNull();
  });

  it('starts with nothing selected and nothing sent', () => {
    const d = startDocumentSession(model, 'eng');
    expect(d.review.every((i) => !i.selected)).toBe(true);
    expect(d).toMatchObject({ mode: 'ai', nothingSent: false });
  });

  it('a new file revokes every preview and clears the document, the fields and the answers but keeps the interface language', () => {
    const state = withDoc();
    const withPreview = { ...state, document: { ...state.document!, model: { ...model, pages: model.pages.map((p) => ({ ...p, preview: { url: 'blob:one', scale: 0.5 } })) } } };
    const revoke = vi.fn();
    const next = discardDocument(withPreview, revoke);
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:one');
    expect(next.document).toBeNull();
    expect(next.fields).toEqual([]);
    expect(next.formLanguage).toBe('');
    expect(next.interfaceLanguage).toBe('zh-Hans');
  });
});

describe('leave-page guard (10.14)', () => {
  function target() {
    const added: unknown[] = [];
    const removed: unknown[] = [];
    const t: LeaveTarget = { addEventListener: (_t, l) => void added.push(l), removeEventListener: (_t, l) => void removed.push(l) };
    return { t, added, removed };
  }
  const { model } = modelAndKept([]);
  const empty = createSession('en');
  const loaded: SessionState = { ...empty, document: startDocumentSession(model, 'eng') };
  const answered: SessionState = { ...empty, fields: [{ ...fieldFromKeptLabel({ kept: { labelId: 'p1-l0', text: 'Name:', pageNumber: 1, readingOrder: 0 }, box: { left: 0, top: 0, right: 5, bottom: 5 }, textLang: 'en', checkYourself: false }, 'en', null), rawAnswer: ' Sam ' }] };

  it('unsaved work is a loaded document or a non-empty answer', () => {
    expect(hasUnsavedWork(empty)).toBe(false);
    expect(hasUnsavedWork(loaded)).toBe(true);
    expect(hasUnsavedWork(answered)).toBe(true);
    expect(hasUnsavedWork({ ...answered, fields: [{ ...answered.fields[0]!, rawAnswer: '   ' }] })).toBe(false);
  });

  it('registers once while there is something to lose and removes once when there is not', () => {
    const { t, added, removed } = target();
    const guard = createLeaveGuard(t);
    guard.update(empty);
    expect(guard.active()).toBe(false);
    guard.update(loaded);
    guard.update(answered);
    guard.update(loaded);
    expect(added).toHaveLength(1);
    expect(guard.active()).toBe(true);
    guard.update(empty);
    guard.update(empty);
    expect(removed).toHaveLength(1);
    expect(removed[0]).toBe(added[0]);
    expect(guard.active()).toBe(false);
  });

  it('the handler asks the browser for its leave-page warning', () => {
    const event = { preventDefault: vi.fn(), returnValue: 'x' } as unknown as BeforeUnloadEvent;
    onBeforeUnload(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.returnValue).toBe('');
  });
});
