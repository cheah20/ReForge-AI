// @vitest-environment jsdom
/**
 * tests/unit/sample-form.test.tsx
 *
 * Task 28.5: "Try a sample form". SAMPLE_FORM_PATH and the picker button open
 * fixtures/clinic-registration.pdf on the upload screen as if the user had
 * chosen it. Privacy is unchanged: nothing is sent before the acknowledgement.
 * Validates: Requirements 1.3, 9.5, 11.4, 14.1 (and accessforge-skeleton 11.5)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { App } from '../../src/frontend/App.js';
import type { ApiClient } from '../../src/frontend/api.js';
import { createHandler } from '../../src/worker/index.js';
import { MockAiProvider } from '../../src/lib/ai/mock.js';
import { extractFields, sha256Hex } from '../../src/lib/pdf-extract/index.js';
import { translate } from '../../src/packs/language/registry.js';
import { SAMPLE_FORM_PATH } from '../../src/shared/app-paths.js';
import { createApiClient } from '../../src/frontend/api.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SAMPLE = new Uint8Array(readFileSync(path.resolve(__dirname, '../../fixtures/clinic-registration.pdf')));

describe('SAMPLE_FORM_PATH', () => {
  it('is a same-origin path with no query string or fragment, outside /legacy/', () => {
    expect(SAMPLE_FORM_PATH.startsWith('/')).toBe(true);
    expect(SAMPLE_FORM_PATH.startsWith('//')).toBe(false);
    expect(SAMPLE_FORM_PATH).not.toMatch(/[?#]/);
    expect(SAMPLE_FORM_PATH.startsWith('/legacy')).toBe(false);
    expect(SAMPLE_FORM_PATH.startsWith('/api')).toBe(false);
    const url = new URL(SAMPLE_FORM_PATH, 'https://reforge.example');
    expect(url.origin).toBe('https://reforge.example');
    expect(url.pathname).toBe(SAMPLE_FORM_PATH);
  });
});

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

/** The real Worker with the mock provider, recording every request body. */
function recordingApi() {
  const handler = createHandler({ provider: new MockAiProvider(), logger: () => {} });
  const bodies: string[] = [];
  const api: ApiClient = createApiClient(async (input, init) => {
    bodies.push(`${input} ${String(init.body)}`);
    return handler.fetch(new Request(`https://app.test${input}`, init), {});
  });
  return { api, bodies };
}

function renderApp(initialPath: string) {
  const { api, bodies } = recordingApi();
  const extracted: Uint8Array[] = [];
  let sampleLoads = 0;
  act(() => {
    root.render(
      <App
        api={api}
        initialLanguage="zh-Hans"
        initialPath={initialPath}
        loadSample={async () => {
          sampleLoads++;
          return SAMPLE.slice();
        }}
        // Real field extraction; page text is left out because pdf.js needs a browser worker.
        extractor={async (bytes) => {
          extracted.push(bytes);
          return extractFields(bytes, { loadPageText: async () => new Map() });
        }}
      />,
    );
  });
  return { bodies, extracted, sampleLoads: () => sampleLoads };
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await act(async () => new Promise((r) => setTimeout(r, 10)));
  expect(check()).toBe(true);
};
const t = (key: string, params?: Record<string, string | number>) => translate('zh-Hans', key, params);
const button = (text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);

async function expectSampleReady(run: ReturnType<typeof renderApp>) {
  await until(() => container.textContent!.includes(t('upload.found', { count: 22, pages: 1 })));
  expect(container.querySelector('h1')?.textContent).toBe(t('upload.title'));
  expect(container.textContent).toContain(t('upload.privacyNotice'));
  // The very same bytes as the fixture went through the normal reader.
  expect(run.extracted).toHaveLength(1);
  expect(await sha256Hex(run.extracted[0]!)).toBe(await sha256Hex(SAMPLE));
  // Reading the sample sent nothing.
  expect(run.bodies).toEqual([]);
}

describe('"Try a sample form" (task 28.5)', () => {
  it('opening SAMPLE_FORM_PATH starts on the upload screen with the clinic form read, and sends nothing', async () => {
    const run = renderApp(SAMPLE_FORM_PATH);
    await expectSampleReady(run);
    expect(run.sampleLoads()).toBe(1);
  });

  it('the picker button opens the same sample', async () => {
    const run = renderApp('/');
    expect(container.querySelector('h1')?.textContent).toBe(t('language.picker.title'));
    expect(run.sampleLoads()).toBe(0);
    act(() => button(t('language.picker.trySample'))!.click());
    await expectSampleReady(run);
  });

  it('analysis starts only when the user presses the acknowledgement, and carries evidence, not the PDF', async () => {
    const run = renderApp(SAMPLE_FORM_PATH);
    await expectSampleReady(run);
    act(() => button(t('upload.acknowledge'))!.click());
    await until(() => run.bodies.length > 0);
    expect(run.bodies[0]!.startsWith('/api/forms/analyze ')).toBe(true);
    const body = JSON.parse(run.bodies[0]!.slice('/api/forms/analyze '.length)) as { fields: unknown[] };
    expect(body.fields).toHaveLength(22);
    expect(run.bodies[0]).not.toContain('%PDF');
  });

  it('the normal start page does not load the sample', () => {
    const run = renderApp('/');
    expect(run.sampleLoads()).toBe(0);
    expect(run.extracted).toEqual([]);
  });
});
