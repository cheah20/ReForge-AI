/**
 * tests/unit/accessforge-render.tsx
 *
 * A small render helper for the AccessForge component tests (jsdom), on
 * React's own `createRoot` and `act`, as the other component tests do.
 * Not a test file.
 */

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

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
