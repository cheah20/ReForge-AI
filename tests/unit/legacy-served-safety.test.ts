// @vitest-environment jsdom
/**
 * tests/unit/legacy-served-safety.test.ts
 *
 * accessforge-skeleton task 5.8: every served legacy document is free of active
 * and foreign constructs, the Worker does no sanitising or hashing per request,
 * and every text node is content-file text or an escaped dynamic part.
 * Validates: Requirements 2.10, 2.11, 3.11, 4.1, 4.7, 4.10
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import * as html from '../../src/lib/legacy-build/html.js';
import { CONTENT_STRINGS } from '../../src/lib/legacy-build/content.js';
import { ALLOW_LIST_GET_PATHS } from '../../src/lib/accessforge/allow-list.js';
import { SAMPLE_FORM_PATH } from '../../src/shared/app-paths.js';
import { body, get, parseHtml, post, VALID } from './legacy-helpers.js';

const MARKUP = `<script>x()</script>" onload="y" 'z' & <img src=//evil.example/p>`;
const tricky = VALID.map(([n, v]): [string, string] => [n, n === 'nama' ? MARKUP : v]);

async function served(): Promise<Array<[string, string, Array<string>]>> {
  return [
    ['home', await (await get('/legacy/')).text(), []],
    ['register', await (await get('/legacy/register')).text(), []],
    ['confirmation', await (await post(body(tricky))).text(), [...tricky.flatMap(([n, v]) => [n, v]), 'SR-DEMO-20261117-042137']],
    // MARKUP is longer than both maxlengths, so every field fails and is named.
    ['error', await (await post(body([['nama', MARKUP], ['poskod', MARKUP]]))).text(), ['nama', 'nokp', 'tlahir', 'jantina', 'tel', 'poskod', 'tujuan', 'akuan']],
    ['not found', await (await get('/legacy/nope')).text(), []],
  ];
}

afterEach(() => vi.restoreAllMocks());

describe('served documents (Requirements 4.1, 4.7, 4.10)', () => {
  it('contain no listed construct, even with markup characters in the submitted values', async () => {
    for (const [name, doc] of await served()) expect(html.findUnsafeConstructs(doc), name).toEqual([]);
  });

  it('have no script, handler, external resource, or form target outside the origin (checked in the DOM too)', async () => {
    for (const [name, doc] of await served()) {
      const d = parseHtml(doc);
      expect(d.querySelectorAll('script, iframe, object, embed, base, img, noscript').length, name).toBe(0);
      for (const el of d.querySelectorAll('*')) for (const a of el.getAttributeNames()) expect(a.startsWith('on'), `${name} ${a}`).toBe(false);
      for (const f of d.querySelectorAll('form')) expect(f.getAttribute('action')).toBe('/legacy/register');
      expect(d.querySelectorAll('[formaction], [formmethod], [formtarget]').length).toBe(0);
      expect([...d.querySelectorAll('link')].map((l) => l.getAttribute('href'))).toEqual(['/legacy-assets/portal.css']);
    }
  });

  it('a links point only to Allow_List GET paths and, on the confirmation, SAMPLE_FORM_PATH', async () => {
    for (const [name, doc] of await served()) {
      const allowed = name === 'confirmation' ? [...ALLOW_LIST_GET_PATHS, SAMPLE_FORM_PATH] : ALLOW_LIST_GET_PATHS;
      for (const a of parseHtml(doc).querySelectorAll('a')) expect(allowed, name).toContain(a.getAttribute('href'));
    }
  });

  it('every text node is a content-file string or an escaped dynamic part of that response', async () => {
    for (const [name, doc, dynamic] of await served()) {
      const d = parseHtml(doc);
      const walker = d.createTreeWalker(d.documentElement, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const t = n.textContent!;
        if (!t.trim()) continue;
        const ok = CONTENT_STRINGS.includes(t.trim()) || dynamic.includes(t);
        expect(ok, `${name}: ${JSON.stringify(t)}`).toBe(true);
      }
    }
  });
});

describe('no sanitiser and no hash per request (Requirement 2.11)', () => {
  it('handleLegacy calls neither sanitizeTree, findUnsafeConstructs nor crypto.subtle.digest', async () => {
    const sanitize = vi.spyOn(html, 'sanitizeTree');
    const scan = vi.spyOn(html, 'findUnsafeConstructs');
    const digest = vi.spyOn(crypto.subtle, 'digest');
    await get('/legacy/');
    await get('/legacy/register');
    await post(body(VALID));
    await post(body([['nama', 'x']]));
    await get('/legacy/nope');
    expect(sanitize).not.toHaveBeenCalled();
    expect(scan).not.toHaveBeenCalled();
    expect(digest).not.toHaveBeenCalled();
  });

  it('no module under src/worker/ imports src/lib/legacy-build/', () => {
    const root = path.resolve('src/worker');
    const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((f) => /\.tsx?$/.test(f));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      const source = readFileSync(path.join(root, f), 'utf8');
      expect(source, f).not.toMatch(/from\s+['"][^'"]*legacy-build\//);
    }
  });
});
