// @vitest-environment jsdom
/**
 * tests/unit/i18n.test.tsx
 *
 * Task 5.3: the i18n provider translates with English fallback, keeps
 * <html lang> and <html dir> in step with the language, and loads the
 * language's UI font when it is selected.
 * Validates: Requirements 2-L.1, 2-L.3, 13.4
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nProvider, useTranslation, type I18nValue } from '../../src/frontend/i18n.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let current: I18nValue;
let fontCalls: string[];

function Probe() {
  current = useTranslation();
  return <p>{current.t('wizard.next')}</p>;
}

function render(initialLanguage: string) {
  act(() => {
    root.render(
      <I18nProvider
        initialLanguage={initialLanguage}
        fontLoader={async (family) => {
          fontCalls.push(family);
          return true;
        }}
      >
        <Probe />
      </I18nProvider>,
    );
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  fontCalls = [];
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('I18nProvider', () => {
  it('renders strings in the initial language and sets <html lang>', () => {
    render('ms');
    expect(container.textContent).toBe('Seterusnya');
    expect(document.documentElement.lang).toBe('ms');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('switches language, updates <html lang> and loads that language’s UI font', () => {
    render('en');
    act(() => current.setLanguage('zh-Hans'));
    expect(document.documentElement.lang).toBe('zh-Hans');
    expect(container.textContent).not.toBe('Next');
    expect(fontCalls).toEqual(['Noto Sans', 'Noto Sans SC']);
  });

  it('falls back to English for a key the experimental locale lacks', () => {
    render('id');
    expect(current.t('validation.zip.invalid')).toBe('Please enter a valid ZIP code (e.g. 12345 or 12345-6789).');
    expect(current.t('wizard.next')).toBe('Berikutnya');
  });

  it('falls back to English for an unknown language tag', () => {
    render('xx-Unknown');
    expect(current.language).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    act(() => current.setLanguage('also-unknown'));
    expect(current.language).toBe('en');
  });

  it('fills placeholders', () => {
    render('es');
    expect(current.t('wizard.step', { current: 3, total: 14 })).toBe('Pregunta 3 de 14');
  });

  it('useTranslation outside the provider is an error', () => {
    function Lonely() {
      useTranslation();
      return null;
    }
    const spy = console.error;
    console.error = () => {};
    try {
      expect(() => act(() => root.render(<Lonely />))).toThrow(/inside <I18nProvider>/);
    } finally {
      console.error = spy;
    }
  });
});
