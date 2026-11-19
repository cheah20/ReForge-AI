/**
 * tests/e2e/helpers/document.ts
 *
 * Helpers for the Document_Path browser tests (formbridge-any-document task
 * 13.1): inject a mock OCR result for a fixture, record every request with its
 * URL, headers and body, and scan the browser's storage for strings that must
 * never be kept.
 */

import type { BrowserContext, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface ExpectedLine {
  page: number;
  text: string;
  expect: string;
}

interface ExpectedFixture {
  file: string;
  lang: string;
  canaries: Array<{ value: string; where: string; state: string }>;
  lines?: ExpectedLine[];
  pages?: Array<{ mock: { lines: Array<{ text: string }> } & Record<string, unknown> }>;
}

const expected = JSON.parse(readFileSync(join('fixtures', 'documents', 'expected.json'), 'utf8')) as { fixtures: ExpectedFixture[] };

export function fixtureEntry(file: string): ExpectedFixture {
  const entry = expected.fixtures.find((f) => f.file === file);
  if (!entry) throw new Error(`fixture not in expected.json: ${file}`);
  return entry;
}

export const documentFixturePath = (file: string) => join('fixtures', 'documents', file);

/** Makes the app read a fixture from its mock OCR result instead of running the engine (test builds only). */
export async function injectMockOcr(page: Page, file: string): Promise<void> {
  const mock = fixtureEntry(file).pages?.[0]?.mock;
  if (!mock) throw new Error(`no mock OCR result for ${file}`);
  await page.addInitScript((m) => {
    (globalThis as Record<string, unknown>)['__REFORGE_TEST_OCR__'] = m;
  }, mock);
}

export interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** Records every request from now on, with the body as text. */
export function recordRequests(page: Page): RecordedRequest[] {
  const out: RecordedRequest[] = [];
  page.on('request', (r) => {
    out.push({ method: r.method(), url: r.url(), headers: r.headers(), body: r.postData() ?? '' });
  });
  return out;
}

/** The whole request as one string: URL, every header and the body. */
export const requestText = (r: RecordedRequest): string => `${r.method} ${r.url}\n${JSON.stringify(r.headers)}\n${r.body}`;

/**
 * Strings that must never leave the browser or be kept: every canary value,
 * every line the fixture says is not listed, the part after a colon on every
 * line, and every run of four or more digits (a Numeric_Fragment of a split value).
 */
export function forbiddenStrings(file: string): string[] {
  const entry = fixtureEntry(file);
  const out = new Set<string>();
  for (const c of entry.canaries) out.add(c.value);
  const lines = (entry.pages?.[0]?.mock.lines ?? []).map((l) => l.text);
  for (const text of lines) {
    const colon = text.indexOf(':');
    if (colon >= 0) {
      const after = text.slice(colon + 1).trim();
      if (after.length >= 4) out.add(after);
    }
    for (const run of text.match(/\d[\d-]{3,}/g) ?? []) out.add(run);
  }
  for (const l of entry.lines ?? []) if (l.expect === 'not-listed') out.add(l.text);
  return [...out].filter((s) => s.length >= 4);
}

/** The digits of a canary as a pattern that tolerates spaces, dashes and dots between them (a split or reformatted number). */
export function digitPattern(value: string): RegExp | null {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 8) return null;
  return new RegExp([...digits].join('[\\s\\-.]*'));
}

export interface StorageScan {
  text: string;
  cacheNames: string[];
  databaseNames: string[];
}

/** Everything the page keeps: web storage, IndexedDB names, Cache Storage names, cookies, URL and history state. */
export async function scanStorage(page: Page, context: BrowserContext): Promise<StorageScan> {
  const inPage = await page.evaluate(async () => {
    const dump = (s: Storage) => Object.keys(s).map((k) => `${k}=${s.getItem(k)}`);
    const dbs = 'databases' in indexedDB ? await indexedDB.databases() : [];
    const cacheNames = 'caches' in window ? await caches.keys() : [];
    const cacheEntries: string[] = [];
    for (const name of cacheNames) {
      const cache = await caches.open(name);
      for (const req of await cache.keys()) cacheEntries.push(`${name} ${new URL(req.url).pathname}`);
    }
    return {
      storage: [...dump(localStorage), ...dump(sessionStorage)],
      databaseNames: dbs.map((d) => d.name ?? ''),
      cacheNames,
      cacheEntries,
      cookie: document.cookie,
      href: location.href,
      state: JSON.stringify(history.state),
    };
  });
  const cookies = (await context.cookies()).map((c) => `${c.name}=${c.value}`);
  return {
    text: [...inPage.storage, ...inPage.databaseNames, ...inPage.cacheEntries, inPage.cookie, inPage.href, inPage.state, ...cookies].join('\n'),
    cacheNames: inPage.cacheNames,
    databaseNames: inPage.databaseNames,
  };
}
