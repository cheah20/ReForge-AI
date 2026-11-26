// @vitest-environment jsdom
/**
 * tests/unit/document-screens.test.tsx
 *
 * formbridge-any-document task 11.21: the shared screens never show a
 * document-only element for a field of a fillable PDF, a status always carries
 * words and a decorative icon, and the Answer_Sheet cuts nothing short.
 * (The table, `lang` and print rules of the Answer_Sheet are in
 * answer-sheet-screen.test.tsx.)
 * Validates: Requirements 5.1, 19.7, 23.5
 */

import { describe, it, expect, afterEach } from 'vitest';
import type { ReactNode } from 'react';
import type { ApiClient } from '../../src/frontend/api.js';
import { AppContext } from '../../src/frontend/app-context.js';
import { I18nProvider } from '../../src/frontend/i18n.js';
import { StatusMessage, type StatusTone } from '../../src/frontend/components/StatusMessage.js';
import { AnswerSheet } from '../../src/frontend/screens/AnswerSheet.js';
import { QuestionWizard } from '../../src/frontend/screens/QuestionWizard.js';
import { ReviewScreen } from '../../src/frontend/screens/ReviewScreen.js';
import { createSession, createSessionStore, type FieldState, type SessionState } from '../../src/frontend/state.js';
import { getOwnLocaleStrings, translate } from '../../src/packs/language/registry.js';
import { render, type Rendered } from './accessforge-render.js';

const API: ApiClient = { analyze: () => Promise.reject(new Error('unused')), retranslate: () => Promise.reject(new Error('unused')), translate: () => Promise.reject(new Error('unused')) };

let view: Rendered | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

function show(node: ReactNode, state: Partial<SessionState>): HTMLElement {
  const store = createSessionStore({ ...createSession('en'), ...state });
  view = render(
    <I18nProvider initialLanguage="en" fontLoader={async () => true}>
      <AppContext.Provider value={{ store, api: API }}>{node}</AppContext.Provider>
    </I18nProvider>,
  );
  return view.container;
}

/** A field of a fillable PDF: no `origin`, so it did not come from a photo. */
function pdfField(id: string, answer?: string): FieldState {
  return {
    evidence: { fieldId: id, fieldType: 'text', tooltip: `Name ${id}`, required: false, readOnly: false, hasValue: false, widgets: [{ pageNumber: 1, bbox: { left: 0, top: 10, right: 100, bottom: 0 }, pageSnippet: `Name ${id}` }] },
    analysis: { fieldId: id, humanLabel: `Label ${id}`, question: `Question ${id}?`, answerType: 'text', confidence: 0.95 },
    status: 'mapped',
    skipped: false,
    ...(answer !== undefined ? { rawAnswer: answer, normalizedOutput: answer } : {}),
  };
}

/**
 * Every English string that only the photo path uses. Short strings are left out because an
 * ordinary word can appear in any screen.
 */
const en = getOwnLocaleStrings('en')!;
const DOCUMENT_ONLY = Object.entries(en)
  .filter(([key, text]) => key.startsWith('document.') && !text.includes('{') && text.length >= 18)
  .filter(([, text]) => !Object.entries(en).some(([k, other]) => !k.startsWith('document.') && other === text))
  .map(([, text]) => text);

function expectNoDocumentText(root: HTMLElement) {
  const shown = DOCUMENT_ONLY.filter((text) => root.textContent!.includes(text));
  expect(shown, 'photo-path text on a fillable-PDF screen').toEqual([]);
}

describe('a fillable-PDF field never shows a photo-path element (5.1)', () => {
  it('there is a real set of photo-path strings to look for', () => {
    expect(DOCUMENT_ONLY.length).toBeGreaterThan(30);
  });

  it('on a question', () => {
    const root = show(<QuestionWizard onDone={() => {}} onBackToStart={() => {}} />, { fields: [pdfField('a'), pdfField('b')], formLanguage: 'ms', formCountry: 'MY' });
    expect(root.querySelector('.question-card')).not.toBeNull();
    expectNoDocumentText(root);
  });

  it('on the review screen', () => {
    const root = show(<ReviewScreen onConfirm={() => {}} onBack={() => {}} />, { fields: [pdfField('a', 'Aisha'), pdfField('b', 'Omar')], formLanguage: 'ms', formCountry: 'MY' });
    expect(root.textContent).toContain(translate('en', 'review.privacyNotice'));
    expect(root.textContent).not.toContain(translate('en', 'document.reviewScreen.makeSheet'));
    expect(root.textContent).not.toContain(translate('en', 'review.privacyNotice.nothingSent'));
    expectNoDocumentText(root);
  });
});

describe('a status carries words and a decorative icon, never colour alone (23.5)', () => {
  it.each<StatusTone>(['error', 'success', 'caution', 'info'])('%s', (tone) => {
    const root = show(<StatusMessage tone={tone}>Something to read</StatusMessage>, {});
    const message = root.querySelector('p.status-message')!;
    expect(message.textContent).toBe('Something to read');
    const icon = message.querySelector('svg')!;
    expect(icon).not.toBeNull();
    expect(icon.getAttribute('aria-hidden')).toBe('true');
  });

  it('the four tones draw four different icons', () => {
    const shapes = (['error', 'success', 'caution', 'info'] as StatusTone[]).map((tone) => {
      const root = show(<StatusMessage tone={tone}>x</StatusMessage>, {});
      const d = root.querySelector('svg path')!.getAttribute('d')!;
      view!.unmount();
      view = null;
      return d;
    });
    expect(new Set(shapes).size).toBe(4);
  });
});

describe('the Answer_Sheet cuts nothing short (19.7)', () => {
  it('shows a very long label and a very long answer in full, in the table and in the summary', () => {
    const label = `${'Alamat surat menyurat '.repeat(8)}:`.trim();
    const answer = `${'Jalan Rekaan Ungu '.repeat(100)}END`;
    const field = {
      ...pdfField('p1-l0', answer),
      origin: { labelId: 'p1-l0', pageNumber: 1, lineIndex: 0, text: label, textLang: 'ms', checkYourself: false },
    } as FieldState;
    const root = show(<AnswerSheet onBackToReview={() => {}} />, { fields: [field], formLanguage: 'ms' });
    const row = root.querySelector('table tbody tr')!;
    expect(row.querySelector('th')!.textContent).toBe(label);
    expect(row.textContent).toContain(answer);
    expect(root.querySelector('.answer-sheet__clerk-list')!.textContent).toContain(answer);
    expect(row.textContent).not.toContain('…');
  });
});
