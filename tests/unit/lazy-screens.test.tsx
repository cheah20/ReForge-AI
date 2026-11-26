// @vitest-environment jsdom
/**
 * tests/unit/lazy-screens.test.tsx
 *
 * The photo path and AccessForge are not part of the first download: App.tsx
 * loads their screens with `lazy()` and imports no module of theirs statically.
 * Opening AccessForge shows a short loading note, then the screen.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { App } from '../../src/frontend/App.js';
import { translate } from '../../src/packs/language/registry.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SOURCE = readFileSync('src/frontend/App.tsx', 'utf8');
const staticImports = [...SOURCE.matchAll(/^import (?!type )[^;]*? from '([^']+)';/gm)].map((m) => m[1]!);

describe('App.tsx imports', () => {
  it('has a real set of static imports to check', () => {
    expect(staticImports.length).toBeGreaterThan(10);
    expect(staticImports).toContain('./screens/Upload.js');
  });

  it('imports no AccessForge, document-pipeline or Answer_Sheet module statically', () => {
    const heavy = staticImports.filter((p) => /accessforge\/(?!scope)|\/document\/|document\/|AnswerSheet/.test(p) && !p.endsWith('/scope.js'));
    expect(heavy).toEqual([]);
  });

  it('loads each of those screens with lazy()', () => {
    for (const screen of ['RevivalScreen', 'DocumentReading', 'LabelReview', 'AnswerSheet']) {
      expect(SOURCE, screen).toMatch(new RegExp(`const ${screen} = lazy\\(\\(\\) => import\\(`));
    }
  });
});

describe('opening AccessForge', () => {
  let root: Root | null = null;
  let host: HTMLElement | null = null;
  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  it('shows the loading note first and the AccessForge screen once it has loaded', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<App initialLanguage="en" initialPath="/accessforge" />);
    });
    // The note is up while the chunk loads (the first load also transforms the module in this runner).
    expect(host.textContent).toContain(translate('en', 'app.loadingScreen'));
    for (let i = 0; i < 100 && !host.querySelector('.revival'); i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 100));
      });
    }
    expect(host.textContent).not.toContain(translate('en', 'app.loadingScreen'));
    expect(host.querySelector('.revival')).not.toBeNull();
    expect(host.textContent).toContain(translate('en', 'accessforge.start'));
  });

  it('has the loading note in every core locale', () => {
    for (const tag of ['en', 'ms', 'zh-Hans', 'zh-Hant', 'ta', 'es']) expect(translate(tag, 'app.loadingScreen').trim(), tag).not.toBe('app.loadingScreen');
  });
});
