// @vitest-environment jsdom
/**
 * tests/unit/lazy-screen-failure.test.tsx
 *
 * Some screens are downloaded when first opened. A download that fails (a lost
 * connection, or a new deploy that replaced the file) must leave a message and
 * a way to try again, never a blank page.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { App } from '../../src/frontend/App.js';
import { ACCESSFORGE_PATH } from '../../src/shared/app-paths.js';
import { translate } from '../../src/packs/language/registry.js';
import { render, type Rendered } from './accessforge-render.js';

vi.mock('../../src/frontend/accessforge/RevivalScreen.js', () => {
  throw new Error('Failed to fetch dynamically imported module');
});

let view: Rendered | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
  vi.restoreAllMocks();
});

describe('a screen that cannot be downloaded', () => {
  it('shows a message and a try-again button instead of a blank page', async () => {
    // React reports the caught error on the console; that is expected here.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    view = render(<App initialLanguage="en" initialPath={ACCESSFORGE_PATH} />);
    const root = view.container;
    for (let i = 0; i < 100 && !root.querySelector('[data-load-failed]'); i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 100));
      });
    }
    expect(root.querySelector('[data-load-failed]')).not.toBeNull();
    expect(root.textContent).toContain(translate('en', 'error.generic'));
    expect(root.querySelector('[data-load-failed] button')!.textContent).toBe(translate('en', 'error.retry'));
  });
});
