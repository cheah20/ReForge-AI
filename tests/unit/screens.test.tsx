// @vitest-environment jsdom
/**
 * tests/unit/screens.test.tsx
 *
 * Screen behaviour in the browser DOM (tasks 27.1, 28.1, 28.2, 31.1, 31.4, 31.5).
 * Validates: Requirements 2-L.7, 6.4, 7.1, 8.6, 9.5, 11.1, 13.3
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';
import type { ApiClient, ApiReply } from '../../src/frontend/api.js';
import { AppContext } from '../../src/frontend/app-context.js';
import { I18nProvider } from '../../src/frontend/i18n.js';
import { LanguagePicker } from '../../src/frontend/screens/LanguagePicker.js';
import { CJK_FORMS_SUPPORTED, ConfirmLanguage, isBlockedFormLanguage } from '../../src/frontend/screens/ConfirmLanguage.js';
import { QuestionWizard, resultOnChange, resultOnCommit } from '../../src/frontend/screens/QuestionWizard.js';
import { Upload, type Extractor } from '../../src/frontend/screens/Upload.js';
import { analyzeForm, confirmFormSettings, createSession, createSessionStore, type SessionStore } from '../../src/frontend/state.js';
import type { ChangeLanguage } from '../../src/frontend/use-change-language.js';
import { translate } from '../../src/packs/language/registry.js';
import type { AnalyzeRequest, AnswerType, FieldEvidence, TranslateRequest } from '../../src/shared/types.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HASH = 'd'.repeat(64);
const CANARY = 'CANARY-DESCRIPTION-4417';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const noFonts = async () => true;

class RecordingApi implements ApiClient {
  translateCalls: TranslateRequest[] = [];
  analyzeBodies: string[] = [];
  types = new Map<string, AnswerType>();
  async analyze(request: AnalyzeRequest) {
    this.analyzeBodies.push(JSON.stringify(request));
    return {
      aiMode: 'mock',
      data: {
        formLanguage: 'ms',
        formLanguageConfidence: 0.9,
        formCountry: 'MY',
        formCountryConfidence: 0.9,
        fields: request.fields.map((f) => ({
          fieldId: f.fieldId,
          humanLabel: `Label ${f.fieldId}`,
          question: `Question ${f.fieldId}?`,
          answerType: this.types.get(f.fieldId) ?? 'text',
          confidence: 0.9,
        })),
      },
    } satisfies ApiReply<unknown> as never;
  }
  async retranslate(): Promise<never> {
    throw new Error('not used');
  }
  async translate(request: TranslateRequest) {
    this.translateCalls.push(request);
    return { aiMode: 'mock', data: { translation: 'Sakit kepala sejak semalam.' } };
  }
}

function evidence(fieldId: string, extra: Partial<FieldEvidence> = {}): FieldEvidence {
  return {
    fieldId,
    fieldType: 'text',
    required: false,
    readOnly: false,
    hasValue: false,
    widgets: [{ pageNumber: 1, bbox: { left: 0, top: 10, right: 100, bottom: 0 }, pageSnippet: `PDF ${fieldId}` }],
    ...extra,
  };
}

function render(node: ReactNode, store: SessionStore, api: ApiClient, language = 'en') {
  act(() => {
    root.render(
      <I18nProvider initialLanguage={language} fontLoader={noFonts}>
        <AppContext.Provider value={{ store, api }}>{node}</AppContext.Provider>
      </I18nProvider>,
    );
  });
}

/** Type into a React-controlled input or textarea the way a browser does. */
function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function blur(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
}

function click(el: Element | null | undefined) {
  if (!el) throw new Error('element not found');
  act(() => {
    (el as HTMLElement).click();
  });
}

const buttonByText = (text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
/** Let pending reads and replies settle (file reading and extraction take a few async hops). */
const flush = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  });

async function analysedStore(api: RecordingApi, fields: FieldEvidence[], interfaceLanguage = 'en') {
  const store = createSessionStore(createSession(interfaceLanguage));
  await analyzeForm(fields, HASH, store, { api });
  confirmFormSettings(store, 'ms', 'MY');
  return store;
}

describe('LanguagePicker (task 27.1)', () => {
  function picker(store: SessionStore, api: ApiClient) {
    let current = 'en';
    const changeLanguage: ChangeLanguage = { busy: false, errorKey: null, change: async (tag) => void (current = tag) };
    render(<LanguagePicker changeLanguage={changeLanguage} onContinue={() => {}} onTrySample={() => {}} />, store, api);
    return () => current;
  }

  it('lists every registry language by native name with its own lang, and badges experimental ones', () => {
    picker(createSessionStore(), new RecordingApi());
    const names = [...container.querySelectorAll('.language-option__name')].map((n) => [n.textContent, n.getAttribute('lang')]);
    expect(names).toContainEqual(['Bahasa Melayu', 'ms']);
    expect(names).toContainEqual(['English', 'en']);
    const indonesian = [...container.querySelectorAll('.language-option')].find((o) => o.querySelector('[lang="id"]'));
    expect(indonesian?.textContent).toContain(translate('en', 'language.picker.experimental'));
    const malay = [...container.querySelectorAll('.language-option')].find((o) => o.querySelector('[lang="ms"]'));
    expect(malay?.querySelector('.badge')).toBeNull();
  });

  it('switches the language when a language is picked, and the larger-text option scales the page', () => {
    const current = picker(createSessionStore(), new RecordingApi());
    click(container.querySelector('input[value="ms"]'));
    expect(current()).toBe('ms');
    const box = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    click(box);
    expect(document.documentElement.dataset['textSize']).toBe('large');
    click(box);
    expect(document.documentElement.dataset['textSize']).toBeUndefined();
  });
});

describe('Upload (tasks 28.1, 28.2)', () => {
  function choose(extractor: Extractor, onContinue = () => {}) {
    render(<Upload extractor={extractor} onContinue={onContinue} />, createSessionStore(), new RecordingApi(), 'ms');
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File([new Uint8Array([37, 80, 68, 70])], 'clinic-registration.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    act(() => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    return input;
  }

  it('shows the privacy notice in the interface language before any file is chosen', () => {
    render(<Upload extractor={async () => ({ ok: false, code: 'NO_FIELDS', messageKey: 'upload.error.noFields' })} onContinue={() => {}} />, createSessionStore(), new RecordingApi(), 'ms');
    expect(container.textContent).toContain(translate('ms', 'upload.privacyNotice'));
    expect(buttonByText(translate('ms', 'upload.acknowledge'))).toBeUndefined();
  });

  it('shows a rejection in the interface language with "Try another file", which resets the input', async () => {
    const input = choose(async () => ({ ok: false, code: 'ENCRYPTED', messageKey: 'upload.error.encrypted' }));
    await flush();
    expect(container.textContent).toContain(translate('ms', 'upload.error.encrypted'));
    expect(buttonByText(translate('ms', 'upload.acknowledge'))).toBeUndefined();
    click(buttonByText(translate('ms', 'upload.error.tryAnother')));
    expect(container.textContent).not.toContain(translate('ms', 'upload.error.encrypted'));
    expect(document.activeElement).toBe(input);
  });

  it('treats a reader that throws as an invalid PDF instead of crashing', async () => {
    choose(async () => {
      throw new Error('boom');
    });
    await flush();
    expect(container.textContent).toContain(translate('ms', 'upload.error.invalidPdf'));
  });

  it('lists the fields found and continues only when the user presses the acknowledgement', async () => {
    const got: string[] = [];
    choose(
      async () => ({ ok: true, fields: [evidence('a', { tooltip: 'Nama penuh' }), evidence('b')], fileHash: HASH, pageCount: 1 }),
      ((form: { contentHash: string }) => got.push(form.contentHash)) as never,
    );
    await flush();
    expect(container.textContent).toContain(translate('ms', 'upload.found', { count: 2, pages: 1 }));
    expect([...container.querySelectorAll('.field-list li')].map((l) => l.textContent)).toEqual(['Nama penuh', 'b']);
    expect(got).toEqual([]);
    click(buttonByText(translate('ms', 'upload.acknowledge')));
    expect(got).toEqual([HASH]);
  });
});

describe('QuestionWizard (tasks 31.1, 31.4)', () => {
  it('rejects a wrong IC with a linked, announced message, then accepts a correct one and keeps it on Back', async () => {
    const api = new RecordingApi();
    api.types.set('Text1', 'ic');
    const store = await analysedStore(api, [evidence('patient.fullName'), evidence('Text1', { maxLength: 12 })]);
    let done = 0;
    render(<QuestionWizard onDone={() => done++} onBackToStart={() => {}} />, store, api);

    expect(container.textContent).toContain(translate('en', 'wizard.step', { current: 1, total: 2 }));
    type(container.querySelector('input')!, 'LIN MEI TEST');
    click(buttonByText('Next'));
    expect(container.textContent).toContain(translate('en', 'wizard.step', { current: 2, total: 2 }));
    expect(document.activeElement?.tagName).toBe('H1');

    const ic = container.querySelector<HTMLInputElement>('input')!;
    type(ic, '901301-10-1234');
    blur(ic);
    click(buttonByText('Next'));
    expect(ic.getAttribute('aria-invalid')).toBe('true');
    const message = container.querySelector('.validation-message')!;
    expect(message.getAttribute('aria-live')).toBe('polite');
    expect(ic.getAttribute('aria-describedby')!.split(' ')).toContain(message.id);
    expect(message.textContent).toBe(translate('en', 'validation.ic.invalidDate'));
    expect(done).toBe(0);

    type(ic, '900101-10-1234');
    click(buttonByText('Next'));
    expect(done).toBe(1);
    const saved = store.get().fields.find((f) => f.evidence.fieldId === 'Text1')!;
    expect(saved).toMatchObject({ rawAnswer: '900101-10-1234', normalizedOutput: '900101101234' });

    click(buttonByText('Back'));
    expect(container.querySelector<HTMLInputElement>('input')!.value).toBe('LIN MEI TEST');
  });

  it('"Skip this field" moves on and leaves the field to be untouched', async () => {
    const api = new RecordingApi();
    const store = await analysedStore(api, [evidence('a'), evidence('b')]);
    render(<QuestionWizard onDone={() => {}} onBackToStart={() => {}} />, store, api);
    click(buttonByText('Skip this field'));
    expect(store.get().fields[0]).toMatchObject({ skipped: true });
    expect(store.get().fields[0]!.normalizedOutput).toBeUndefined();
    expect(container.textContent).toContain(translate('en', 'wizard.step', { current: 2, total: 2 }));
  });
});

describe('Chinese-language forms are blocked until task 41 ships CJK fonts (5.3a, task 14)', () => {
  it('flags every Chinese tag and nothing else', () => {
    expect(CJK_FORMS_SUPPORTED).toBe(false);
    for (const tag of ['zh-Hans', 'zh-Hant', 'zh', 'zh-CN']) expect(isBlockedFormLanguage(tag), tag).toBe(true);
    for (const tag of ['ms', 'en', 'ta', 'es']) expect(isBlockedFormLanguage(tag), tag).toBe(false);
  });

  it('shows the message and cannot continue when the form language is Chinese; Malay continues', async () => {
    const api = new RecordingApi();
    const store = await analysedStore(api, [evidence('a')], 'zh-Hans');
    store.set((s) => ({ ...s, formLanguage: 'zh-Hans' }));
    let confirmed = 0;
    render(<ConfirmLanguage onConfirmed={() => confirmed++} />, store, api, 'zh-Hans');
    const message = translate('zh-Hans', 'confirm.cjkUnsupported');
    expect(container.textContent).toContain(message);
    const submit = buttonByText(translate('zh-Hans', 'confirm.continue'))!;
    expect(submit.disabled).toBe(true);
    act(() => submit.closest('form')!.requestSubmit());
    expect(confirmed).toBe(0);
    // Submitting while blocked did not confirm a Chinese output language.
    expect(store.get().formLanguage).toBe('zh-Hans');

    // The first select is the form language (the generic is avoided: Worker and DOM types clash on HTMLSelectElement).
    const select = container.querySelector('select') as unknown as { value: string; dispatchEvent(e: Event): boolean };
    act(() => {
      select.value = 'ms';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.textContent).not.toContain(message);
    act(() => buttonByText(translate('zh-Hans', 'confirm.continue'))!.click());
    expect(confirmed).toBe(1);
    expect(store.get().formLanguage).toBe('ms');
  });
});

describe('error message timing (found by the Nov 17 browser test)', () => {
  const bad = { valid: false, messageKey: 'validation.ic.invalidDate' };
  const good = { valid: true, normalizedValue: '900101101234' };

  it('a blur never removes an error, so the Next button does not move under the pointer', () => {
    expect(resultOnCommit('ic', '900101-10-1234', good, bad)).toBe(bad);
    expect(resultOnCommit('ic', '', good, bad)).toBe(bad);
    expect(resultOnCommit('ic', '901301-10-1234', bad, null)).toBe(bad);
    expect(resultOnCommit('ic', '900101-10-1234', good, null)).toBeNull();
  });

  it('typing a valid answer clears the error at once; a new error waits for blur or Next', () => {
    expect(resultOnChange(good, bad)).toBeNull();
    expect(resultOnChange(bad, bad)).toBe(bad);
    expect(resultOnChange(bad, null)).toBeNull();
  });

  it('choices update at once', () => {
    expect(resultOnCommit('radio', 'F', good, bad)).toBe(good);
  });

  it('in the wizard, the error is gone before the field loses focus once the IC is corrected', async () => {
    const api = new RecordingApi();
    api.types.set('Text1', 'ic');
    const store = await analysedStore(api, [evidence('Text1')]);
    render(<QuestionWizard onDone={() => {}} onBackToStart={() => {}} />, store, api);
    const ic = container.querySelector<HTMLInputElement>('input')!;
    type(ic, '901301-10-1234');
    click(buttonByText('Next'));
    expect(container.querySelector('.validation-message')!.textContent).toBe(translate('en', 'validation.ic.invalidDate'));
    type(ic, '900101-10-123');
    expect(container.querySelector('.validation-message')!.textContent).toBe(translate('en', 'validation.ic.invalidDate'));
    type(ic, '900101-10-1234');
    expect(container.querySelector('.validation-message')!.textContent).toBe('');
    blur(ic);
    expect(container.querySelector('.validation-message')!.textContent).toBe('');
  });
});

describe('translate button gate (task 31.5, requirements 8.6, 11.1)', () => {
  it('sends the description only when "Translate my answer" is pressed, exactly once', async () => {
    const api = new RecordingApi();
    api.types.set('medical.description', 'description');
    const store = await analysedStore(api, [evidence('medical.description')], 'en');
    render(<QuestionWizard onDone={() => {}} onBackToStart={() => {}} />, store, api);

    const box = container.querySelector('textarea')!;
    type(box, CANARY);
    blur(box);
    type(box, `${CANARY} more`);
    blur(box);
    await flush();
    expect(api.translateCalls).toHaveLength(0);
    for (const body of api.analyzeBodies) expect(body).not.toContain(CANARY);

    const button = buttonByText('Translate my answer')!;
    click(button);
    click(button); // a second press while the first is running sends nothing
    await flush();
    expect(api.translateCalls).toEqual([{ text: `${CANARY} more`, sourceLanguage: 'en', targetLanguage: 'ms' }]);

    // The translation is shown for approval, marked as machine translated, and not yet used.
    const field = () => store.get().fields[0]!;
    expect(field().translation).toMatchObject({ text: 'Sakit kepala sejak semalam.', approved: false });
    expect(container.textContent).toContain(translate('en', 'wizard.machineTranslated'));
    click(buttonByText('Use this translation'));
    expect(field().translation?.approved).toBe(true);
    expect(api.translateCalls).toHaveLength(1);
  });

  it('offers no translate button when the answer language is already the form language', async () => {
    const api = new RecordingApi();
    api.types.set('d', 'description');
    const store = await analysedStore(api, [evidence('d')], 'ms');
    render(<QuestionWizard onDone={() => {}} onBackToStart={() => {}} />, store, api, 'ms');
    type(container.querySelector('textarea')!, 'Batuk dua hari');
    expect(buttonByText(translate('ms', 'wizard.translate'))).toBeUndefined();
  });
});
