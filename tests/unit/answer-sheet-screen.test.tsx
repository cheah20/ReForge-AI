// @vitest-environment jsdom
/**
 * tests/unit/answer-sheet-screen.test.tsx
 *
 * The Answer_Sheet screen (formbridge-any-document task 11.16): semantic table,
 * lang attributes, the Clerk_Summary, and Print as an Export_Action that runs
 * only from its own button with no network request.
 * Validates: Requirements 19.1, 19.2, 19.3, 19.5, 19.7, 19.10, 19.11, 19.12
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ApiClient } from '../../src/frontend/api.js';
import { AppContext } from '../../src/frontend/app-context.js';
import { I18nProvider } from '../../src/frontend/i18n.js';
import { AnswerSheet } from '../../src/frontend/screens/AnswerSheet.js';
import { createSession, createSessionStore, type FieldState, type SessionStore } from '../../src/frontend/state.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Spec {
  id: string;
  page: number;
  line: number;
  text: string;
  lang?: string;
  answer?: string;
  skipped?: boolean;
  signature?: boolean;
  translation?: string;
}

function field(s: Spec): FieldState {
  return {
    evidence: { fieldId: s.id, fieldType: s.signature ? 'signature' : 'text' },
    analysis: null,
    status: 'mapped',
    skipped: s.skipped ?? false,
    ...(s.answer !== undefined ? { normalizedOutput: s.answer } : {}),
    ...(s.translation ? { translation: { source: 'x', sourceLanguage: 'en', targetLanguage: 'ms', text: s.translation, approved: true } } : {}),
    origin: { labelId: s.id, pageNumber: s.page, lineIndex: s.line, text: s.text, textLang: s.lang ?? 'en', checkYourself: false },
  } as unknown as FieldState;
}

const FIELDS: Spec[] = [
  { id: 'p1-l0', page: 1, line: 0, text: 'Nama penuh:', lang: 'ms', answer: 'Aisha binti Omar' },
  { id: 'p1-l1', page: 1, line: 1, text: 'Reason for visit:', answer: 'Check-up', translation: 'Pemeriksaan' },
  { id: 'p1-l2', page: 1, line: 2, text: 'Signature:', signature: true },
  { id: 'p2-l0', page: 2, line: 0, text: 'Phone:', skipped: true },
];

let container: HTMLDivElement;
let root: Root;
let store: SessionStore;

function mount(interfaceLanguage: string, formLanguage: string, fields: Spec[], extra: Partial<Parameters<typeof AnswerSheet>[0]> = {}) {
  store = createSessionStore({ ...createSession(interfaceLanguage), formLanguage, fields: fields.map(field) });
  act(() => {
    root.render(
      <I18nProvider initialLanguage={interfaceLanguage} fontLoader={async () => true}>
        <AppContext.Provider value={{ store, api: {} as ApiClient }}>
          <AnswerSheet onBackToReview={() => {}} {...extra} />
        </AppContext.Provider>
      </I18nProvider>,
    );
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Answer_Sheet table (19.1, 19.7)', () => {
  it('has a heading, a caption, three column headers and one row per label with a th and td pair', () => {
    mount('en', 'ms', FIELDS);
    expect(container.querySelector('h1')?.textContent).toBe('Your answers');
    expect(container.querySelector('caption')?.textContent).toBe('Your answers, in the order of the form');
    expect([...container.querySelectorAll('thead th')].map((th) => th.getAttribute('scope'))).toEqual(['col', 'col', 'col']);
    const rows = [...container.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r.querySelectorAll('th[scope="row"]').length).toBe(1);
      expect(r.querySelectorAll('td').length).toBe(2);
    }
  });

  it('shows labels in page order with their own lang, answers in full, and the three statuses', () => {
    mount('en', 'ms', FIELDS);
    const rows = [...container.querySelectorAll('tbody tr')];
    expect(rows[0]!.querySelector('th')?.getAttribute('lang')).toBe('ms');
    expect(rows[0]!.textContent).toContain('Aisha binti Omar');
    expect(rows[2]!.textContent).toContain('To be signed on the paper form');
    expect(rows[3]!.textContent).toContain('Not answered');
    expect(rows[3]!.querySelector('td')?.textContent).toBe('2');
  });

  it('marks an approved translation as machine translated, in the sheet and the clerk summary', () => {
    mount('en', 'ms', FIELDS);
    const row = container.querySelectorAll('tbody tr')[1]!;
    expect(row.textContent).toContain('Pemeriksaan');
    expect(row.textContent).toContain('Machine translated');
    expect(row.querySelector('.answer-sheet__answer')?.getAttribute('lang')).toBe('ms');
    const clerkRow = container.querySelectorAll('.answer-sheet__clerk-row')[1]!;
    expect(clerkRow.textContent).toContain('Pemeriksaan');
    expect(clerkRow.textContent).toContain('Terjemahan mesin');
  });
});

describe('Clerk_Summary (19.2)', () => {
  it('is a section in the Form_Language with the statement and one entry per label', () => {
    mount('en', 'ms', FIELDS);
    const section = container.querySelector('section.answer-sheet__clerk')!;
    expect(section.getAttribute('lang')).toBe('ms');
    expect(section.querySelectorAll('.answer-sheet__clerk-row')).toHaveLength(4);
    expect(section.querySelector('h2')?.getAttribute('lang')).toBe('ms');
  });

  it('marks a string lang="en" when the Form_Language table lacks its key', () => {
    const locales = (lang: string, key: string) => (lang === 'xx' ? (key === 'document.clerk.title' ? 'Judul' : undefined) : key === 'document.clerk.statement' ? 'English statement' : key === 'document.clerk.title' ? 'English title' : `en:${key}`);
    mount('en', 'xx', FIELDS, { locales });
    expect(container.querySelector('#clerk-title')?.getAttribute('lang')).toBe('xx');
    const statement = container.querySelector('section.answer-sheet__clerk > p')!;
    expect(statement.getAttribute('lang')).toBe('en');
    expect(statement.textContent).toBe('English statement');
  });
});

describe('Print is an Export_Action (19.5, 19.11, 19.12)', () => {
  it('rendering does not print or fetch; the Print button prints once and fetches nothing', () => {
    const print = vi.fn();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      mount('en', 'ms', FIELDS, { print });
      expect(print).not.toHaveBeenCalled();
      const button = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Print')!;
      act(() => button.click());
      expect(print).toHaveBeenCalledTimes(1);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('hides the controls and the stamp from print, and keeps the sheet itself', () => {
    mount('en', 'ms', FIELDS);
    const hidden = [...container.querySelectorAll('.no-print')];
    expect(hidden.some((el) => el.querySelector('button'))).toBe(true);
    expect(container.querySelector('.stamp')?.classList.contains('no-print')).toBe(true);
    expect(container.querySelector('table')?.closest('.no-print')).toBeNull();
  });
});

describe('Rebuild (19.10)', () => {
  it('shows an edit made after the first render', () => {
    mount('en', 'ms', FIELDS);
    expect(container.textContent).toContain('Aisha binti Omar');
    act(() => {
      store.set((s) => ({ ...s, fields: s.fields.map((f) => (f.evidence.fieldId === 'p1-l0' ? ({ ...f, normalizedOutput: 'Aisha Binti Omar Zain' } as FieldState) : f)) }));
    });
    expect(container.textContent).toContain('Aisha Binti Omar Zain');
    expect(container.textContent).not.toContain('Aisha binti Omar ');
  });
});
