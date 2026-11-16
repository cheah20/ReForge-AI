/**
 * tests/unit/accessforge-render.tsx
 *
 * A small render helper for the AccessForge component tests (jsdom), on
 * React's own `createRoot` and `act`, as the other component tests do.
 * Not a test file.
 */

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ApiClient } from '../../src/frontend/api.js';
import { AppContext } from '../../src/frontend/app-context.js';
import { I18nProvider } from '../../src/frontend/i18n.js';
import { createSession, createSessionStore } from '../../src/frontend/state.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface Rendered {
  container: HTMLElement;
  rerender(node: ReactNode): void;
  unmount(): void;
}

export function render(node: ReactNode): Rendered {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(node);
  });
  return {
    container,
    rerender: (next) => act(() => root.render(next)),
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/** Runs a DOM event or state change inside act. */
export function fire(fn: () => void): void {
  act(fn);
}

/** Sets an input's value the way React notices, then fires `input`. */
export function typeInto(el: Element, value: string): void {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

/** An API client that fails every call: the Mirror components must not use it. */
export const NO_API: ApiClient = {
  analyze: () => Promise.reject(new Error('no FormBridge call expected')),
  retranslate: () => Promise.reject(new Error('no FormBridge call expected')),
  translate: () => Promise.reject(new Error('no FormBridge call expected')),
};

/** The app's i18n and services around a node, as the App does. */
export function withApp(node: ReactNode, language = 'en'): ReactNode {
  return (
    <I18nProvider initialLanguage={language} fontLoader={async () => true}>
      <AppContext.Provider value={{ store: createSessionStore(createSession(language)), api: NO_API }}>{node}</AppContext.Provider>
    </I18nProvider>
  );
}
