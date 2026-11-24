// @vitest-environment jsdom
/**
 * tests/unit/label-review.test.tsx
 *
 * formbridge-any-document task 11.22: the Label_Review screen. The instruction
 * stands above the list, the send button shows the selected count and follows
 * every toggle (one-item form included), nothing is sent with nothing selected,
 * a plain-text edit never selects, a value-like edit removes the item and shows
 * the notice, and clearing the text keeps the row.
 * Validates: Requirements 12.3, 12.5, 12.8, 12.11, 12.12, 12.14, 12.15, 12.16
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import type { ApiClient } from '../../src/frontend/api.js';
import { AppContext } from '../../src/frontend/app-context.js';
import { I18nProvider } from '../../src/frontend/i18n.js';
import { LabelReview } from '../../src/frontend/document/LabelReview.js';
import { startDocumentSession } from '../../src/frontend/document/session.js';
import { createSession, createSessionStore, type SessionStore } from '../../src/frontend/state.js';
import { buildCandidates, buildPage, createModel } from '../../src/lib/document/model.js';
import { classifyByValueRules } from '../../src/lib/document/value-rules.js';
import { translate } from '../../src/packs/language/registry.js';
import { fire, render, typeInto, type Rendered } from './accessforge-render.js';

const t = (key: string, params?: Record<string, string | number>) => translate('en', key, params);
const NO_API: ApiClient = { analyze: () => Promise.reject(new Error('unused')), retranslate: () => Promise.reject(new Error('unused')), translate: () => Promise.reject(new Error('unused')) };

/** A page of lines at 60 px apart, so none of them counts as sitting directly below another. */
function modelOf(texts: string[]) {
  const lines = texts.map((text, i) => ({ text, box: { left: 100, top: 100 + i * 200, right: 700, bottom: 140 + i * 200 }, confidence: 0.95 }));
  const page = buildPage({ pageNumber: 1, width: 1000, height: 4000, rotation: 0, textSource: 'ocr', lines });
  return createModel('jpeg', [page], buildCandidates([page], null, 'eng', classifyByValueRules));
}

interface Mounted {
  view: Rendered;
  store: SessionStore;
  fetchFn: ReturnType<typeof vi.fn>;
  onDone: ReturnType<typeof vi.fn>;
}

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.view.unmount();
  mounted = null;
});

function mount(texts: string[]): Mounted {
  const store = createSessionStore({ ...createSession('en'), document: startDocumentSession(modelOf(texts), 'eng') });
  const fetchFn = vi.fn(() => Promise.reject(new Error('the network must not be used here')));
  const onDone = vi.fn();
  const view = render(
    <I18nProvider initialLanguage="en" fontLoader={async () => true}>
      <AppContext.Provider value={{ store, api: NO_API }}>
        <LabelReview onDone={onDone} onBack={() => {}} fetchFn={fetchFn as never} />
      </AppContext.Provider>
    </I18nProvider>,
  );
  mounted = { view, store, fetchFn, onDone };
  return mounted;
}

const root = () => mounted!.view.container;
const rows = () => Array.from(root().querySelectorAll('ol.label-review > li'));
const rowFor = (text: string) => {
  // The collapsed group is a <details>: its rows are in the DOM whether or not it is open.
  const row = rows().find((r) => (r.querySelector('input[type="text"]') as HTMLInputElement).value === text);
  if (!row) throw new Error(`no row for ${text}`);
  return row;
};
const boxOf = (row: Element) => row.querySelector('input[type="checkbox"]') as HTMLInputElement;
const textOf = (row: Element) => row.querySelector('input[type="text"]') as HTMLInputElement;
const sendButton = () => Array.from(root().querySelectorAll('button')).find((b) => /^Send (this|these)/.test(b.textContent ?? ''))!;
const tick = (row: Element) => fire(() => boxOf(row).click());

const TEXTS = ['Clinic registration', 'Full name:', 'Email:', 'Date of birth:', 'Section B'];

describe('Label_Review', () => {
  it('shows the instruction above the list, and nothing is ticked at the start', () => {
    mount(TEXTS);
    const instruction = Array.from(root().querySelectorAll('p')).find((p) => p.textContent === t('document.review.instruction'));
    expect(instruction).toBeDefined();
    const list = root().querySelector('ol.label-review')!;
    expect(instruction!.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rows().length).toBeGreaterThan(0);
    expect(rows().every((r) => !boxOf(r).checked)).toBe(true);
  });

  it('the send button names the selected count and follows every toggle, in the one-item form too', () => {
    mount(TEXTS);
    expect(sendButton().textContent).toBe(t('document.review.send.other', { count: 0 }));
    tick(rowFor('Full name:'));
    expect(sendButton().textContent).toBe(t('document.review.send.one', { count: 1 }));
    tick(rowFor('Email:'));
    expect(sendButton().textContent).toBe(t('document.review.send.other', { count: 2 }));
    tick(rowFor('Full name:'));
    expect(sendButton().textContent).toBe(t('document.review.send.one', { count: 1 }));
    tick(rowFor('Email:'));
    expect(sendButton().textContent).toBe(t('document.review.send.other', { count: 0 }));
  });

  it('with nothing selected, sending shows the select-at-least-one message and sends nothing', () => {
    const m = mount(TEXTS);
    expect(root().textContent).not.toContain(t('document.review.selectAtLeastOne'));
    fire(() => sendButton().click());
    expect(root().textContent).toContain(t('document.review.selectAtLeastOne'));
    const withoutAi = Array.from(root().querySelectorAll('button')).find((b) => b.textContent === t('document.review.noAi'))!;
    fire(() => withoutAi.click());
    expect(m.fetchFn).not.toHaveBeenCalled();
    expect(m.onDone).not.toHaveBeenCalled();
  });

  it('editing an unselected item to plain label text leaves it unselected', () => {
    mount(TEXTS);
    const row = rowFor('Section B');
    expect(boxOf(row).checked).toBe(false);
    typeInto(textOf(row), 'Part B of the form');
    const after = rowFor('Part B of the form');
    expect(boxOf(after).checked).toBe(false);
    expect(sendButton().textContent).toBe(t('document.review.send.other', { count: 0 }));
  });

  it('a value-like edit takes the item out, shows the value-not-sent notice on that row, and cannot be ticked', () => {
    mount(TEXTS);
    tick(rowFor('Email:'));
    expect(boxOf(rowFor('Email:')).checked).toBe(true);
    typeInto(textOf(rowFor('Email:')), 'aisha@example.com');
    const row = rowFor('aisha@example.com');
    expect(boxOf(row).checked).toBe(false);
    expect(boxOf(row).disabled).toBe(true);
    expect(row.textContent).toContain(t('document.review.valueNotSent'));
    expect(sendButton().textContent).toBe(t('document.review.send.other', { count: 0 }));
  });

  it('clearing the text keeps the row, unselected, with the empty notice', () => {
    mount(TEXTS);
    const before = rows().length;
    tick(rowFor('Full name:'));
    typeInto(textOf(rowFor('Full name:')), '');
    const row = rows().find((r) => textOf(r).value === '')!;
    expect(row).toBeDefined();
    expect(boxOf(row).checked).toBe(false);
    expect(row.textContent).toContain(t('document.review.emptyText'));
    expect(rows().length).toBe(before);
  });

  it('sends only the ticked words, edited as the user left them, and nothing else from the page', async () => {
    const store = createSessionStore({ ...createSession('en'), document: startDocumentSession(modelOf(TEXTS), 'eng') });
    const calls: Array<{ url: string; body: string }> = [];
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body) });
      return new Response('{}', { status: 500 });
    });
    const view = render(
      <I18nProvider initialLanguage="en" fontLoader={async () => true}>
        <AppContext.Provider value={{ store, api: NO_API }}>
          <LabelReview onDone={() => {}} onBack={() => {}} fetchFn={fetchFn as never} />
        </AppContext.Provider>
      </I18nProvider>,
    );
    mounted = { view, store, fetchFn: fetchFn as never, onDone: vi.fn() };
    tick(rowFor('Full name:'));
    typeInto(textOf(rowFor('Full name:')), 'Full name of applicant:');
    await act(async () => {
      sendButton().click();
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('/api/documents/analyze-labels');
    expect(calls[0]!.body).toContain('Full name of applicant:');
    for (const other of ['Clinic registration', 'Email:', 'Date of birth:', 'Section B']) expect(calls[0]!.body).not.toContain(other);
  });

  it('continuing without AI sends nothing and moves on, with the review marked as nothing sent', () => {
    const m = mount(TEXTS);
    tick(rowFor('Full name:'));
    const withoutAi = Array.from(root().querySelectorAll('button')).find((b) => b.textContent === t('document.review.noAi'))!;
    fire(() => withoutAi.click());
    expect(m.fetchFn).not.toHaveBeenCalled();
    expect(m.onDone).toHaveBeenCalledTimes(1);
    expect(m.store.get().document?.nothingSent).toBe(true);
    expect(m.store.get().fields).toHaveLength(1);
  });
});
