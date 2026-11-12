// @vitest-environment jsdom
/**
 * tests/unit/accessforge-allow-list-examples.test.ts
 *
 * accessforge-skeleton task 7.4 (design Question 1): the frame-document check
 * and the form-target check, on the generated legacy documents and on the
 * hostile page.
 * Validates: Requirements 3.2, 4.4, 4.9
 */

import { describe, it, expect } from 'vitest';
import { checkFormTarget, checkFrameDocument } from '../../src/lib/accessforge/allow-list.js';
import { TEMPLATES, ROW_TEMPLATES } from '../../src/worker/legacy/generated/templates.js';
import { fill } from '../../src/worker/legacy/render.js';
import { serialize } from '../../src/lib/legacy-build/html.js';
import { hostileTree } from '../e2e/helpers/hostile-pages.js';

// DOMParser documents take their base URL from the test window.
const APP = window.location.origin;

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');

const DOCS = {
  home: () => parse(fill(TEMPLATES.home, {})),
  register: () => parse(fill(TEMPLATES.register, {})),
  confirmation: () =>
    parse(
      fill(TEMPLATES.confirmation, {
        reference: 'REF-20261117-042137',
        summaryRows: fill(ROW_TEMPLATES.summaryRow, { name: 'nama', value: 'Siti' }),
      }),
    ),
  error: () => parse(fill(TEMPLATES.error, { failingNames: fill(ROW_TEMPLATES.failingName, { name: 'nama' }) })),
};

/** The parts of an iframe checkFrameDocument reads: its window location and document. */
function frameAt(url: string, doc: Document | null): HTMLIFrameElement {
  return { contentWindow: { location: new URL(url) }, contentDocument: doc } as unknown as HTMLIFrameElement;
}

function crossOriginFrame(): HTMLIFrameElement {
  const win = {
    get location(): never {
      throw new DOMException('Blocked a frame from accessing a cross-origin frame.', 'SecurityError');
    },
  };
  return { contentWindow: win, contentDocument: DOCS.home() } as unknown as HTMLIFrameElement;
}

describe('checkFrameDocument', () => {
  it.each([
    ['home', '/legacy/', 'GET'],
    ['register', '/legacy/register', 'GET'],
    ['confirmation', '/legacy/register', 'POST'],
    ['error', '/legacy/register', 'POST'],
  ] as const)('accepts the %s page at %s', (pageType, path, method) => {
    const doc = DOCS[pageType]();
    const r = checkFrameDocument(frameAt(`${APP}${path}`, doc), APP);
    expect(r).toEqual({
      ok: true,
      entry: { method, path, pageType },
      pageVersion: doc.querySelector('meta[name="portal-page-version"]')?.getAttribute('content') ?? null,
    });
  });

  it('records the Page_Version meta of the home and registration pages', () => {
    const r = checkFrameDocument(frameAt(`${APP}/legacy/register`, DOCS.register()), APP);
    expect(r.ok && r.pageVersion).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ['another origin', 'https://evil.example/legacy/', 'home', 'ORIGIN'],
    ['a trailing slash after register', '/legacy/register/', 'register', 'PATH'],
    ['a path outside the allow-list', '/legacy/admin', 'home', 'PATH'],
    ['a query string', '/legacy/register?x=1', 'register', 'QUERY'],
    ['an empty query string marker on its own is not a query', '/legacy/register?', 'register', null],
    ['a hash', '/legacy/#top', 'home', 'QUERY'],
  ] as const)('handles %s', (_label, where, pageType, reason) => {
    const url = where.startsWith('http') ? where : `${APP}${where}`;
    const r = checkFrameDocument(frameAt(url, DOCS[pageType]()), APP);
    if (reason === null) expect(r.ok).toBe(true);
    else expect(r).toEqual({ ok: false, reason });
  });

  it('refuses a page with no page type meta', () => {
    const doc = DOCS.register();
    doc.querySelector('meta[name="portal-page"]')!.remove();
    expect(checkFrameDocument(frameAt(`${APP}/legacy/register`, doc), APP)).toEqual({ ok: false, reason: 'PAGE_TYPE' });
  });

  it('refuses an unknown page type and a page type that does not belong to the path', () => {
    const unknown = DOCS.register();
    unknown.querySelector('meta[name="portal-page"]')!.setAttribute('content', 'admin');
    expect(checkFrameDocument(frameAt(`${APP}/legacy/register`, unknown), APP)).toEqual({ ok: false, reason: 'PAGE_TYPE' });
    // The home page document shown at the registration path.
    expect(checkFrameDocument(frameAt(`${APP}/legacy/register`, DOCS.home()), APP)).toEqual({ ok: false, reason: 'PAGE_TYPE' });
  });

  it('refuses a frame it cannot read', () => {
    expect(checkFrameDocument(crossOriginFrame(), APP)).toEqual({ ok: false, reason: 'UNREADABLE' });
    expect(checkFrameDocument(frameAt(`${APP}/legacy/`, null), APP)).toEqual({ ok: false, reason: 'UNREADABLE' });
    expect(checkFrameDocument({ contentWindow: null, contentDocument: null } as unknown as HTMLIFrameElement, APP)).toEqual({
      ok: false,
      reason: 'UNREADABLE',
    });
  });
});

describe('checkFormTarget', () => {
  it('passes the real registration form', () => {
    const doc = DOCS.register();
    expect(doc.querySelectorAll('form')).toHaveLength(1);
    expect(checkFormTarget(doc, APP)).toEqual({ ok: true });
  });

  it('fails the hostile form with a foreign action', () => {
    const doc = parse(serialize(hostileTree()));
    expect(doc.querySelector('form')?.getAttribute('action')).toBe('https://evil.example/collect');
    expect(checkFormTarget(doc, APP)).toEqual({ ok: false });
  });

  it('fails the real form when its submit button gains a foreign formaction', () => {
    const doc = DOCS.register();
    const submit = doc.querySelector('input[type="submit"]')!;
    submit.setAttribute('formaction', 'https://evil.example/other');
    expect(checkFormTarget(doc, APP)).toEqual({ ok: false });
  });

  it.each([
    ['formmethod', 'get'],
    ['formtarget', '_blank'],
  ])('fails the real form when its submit button gains %s', (attr, value) => {
    const doc = DOCS.register();
    doc.querySelector('input[type="submit"]')!.setAttribute(attr, value);
    expect(checkFormTarget(doc, APP)).toEqual({ ok: false });
  });

  it('fails the real form posting with GET or to another path', () => {
    const get = DOCS.register();
    get.querySelector('form')!.setAttribute('method', 'get');
    expect(checkFormTarget(get, APP)).toEqual({ ok: false });
    const other = DOCS.register();
    other.querySelector('form')!.setAttribute('action', '/legacy/');
    expect(checkFormTarget(other, APP)).toEqual({ ok: false });
  });

  it('fails a page with no form or two forms', () => {
    expect(checkFormTarget(DOCS.home(), APP)).toEqual({ ok: false });
    const two = DOCS.register();
    two.body.appendChild(two.querySelector('form')!.cloneNode(true));
    expect(checkFormTarget(two, APP)).toEqual({ ok: false });
  });
});
