// @vitest-environment jsdom
/**
 * tests/unit/accessforge-legacy.property.test.ts
 *
 * accessforge-skeleton tasks 27.7, 27.8, 27.9, 27.10, 27.14 and 27.15 (Slice
 * 2): Properties 12, 13, 14, 15, 19 and 20. 100 runs each; fast-check prints
 * the seed on failure.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { ALLOW_LIST, checkFormTarget, checkFrameDocument } from '../../src/lib/accessforge/allow-list.js';
import { compareReceived, parseConfirmation, type FilledField } from '../../src/lib/accessforge/verifier.js';
import { handleLegacy, type LegacyDeps } from '../../src/worker/legacy/handler.js';
import { LEGACY_FIELD_NAMES, LEGACY_FORM } from '../../src/worker/legacy/form-spec.js';
import { MODEL } from './accessforge-helpers.js';
import { DEPS, VALID, body, parseHtml, post } from './legacy-helpers.js';

const RUNS = { numRuns: 100 };
const REFERENCE = /SR-DEMO-\d{8}-\d{6}/;

// ---------------------------------------------------------------------------
// Property 12
// ---------------------------------------------------------------------------

type Variant = 'valid' | 'blank' | 'tooLong' | 'wrongChoice' | 'missing' | 'repeated';
const VARIANTS: Variant[] = ['valid', 'blank', 'tooLong', 'wrongChoice', 'missing', 'repeated'];

interface FieldSpec {
  name: string;
  control: string;
  required: boolean;
  maxLength?: number;
  values?: readonly string[];
  value?: string;
}
const FIELDS = LEGACY_FORM.fields as unknown as FieldSpec[];

function validValue(f: FieldSpec, pick: number): string {
  if (f.control === 'radio' || f.control === 'select') {
    const choices = (f.values ?? []).filter((v) => v !== '');
    return choices[pick % choices.length]!;
  }
  if (f.control === 'checkbox') return f.value!;
  return 'x'.repeat(1 + (pick % f.maxLength!));
}

function valuesFor(f: FieldSpec, variant: Variant, pick: number): string[] {
  const good = validValue(f, pick);
  switch (variant) {
    case 'valid':
      return [good];
    case 'blank':
      return [f.control === 'text' ? '   ' : ''];
    case 'tooLong':
      return [f.maxLength !== undefined ? 'y'.repeat(f.maxLength + 1) : 'ZZZ-not-a-choice'];
    case 'wrongChoice':
      return [f.control === 'checkbox' ? 'NO' : f.control === 'text' ? good : 'ZZZ-not-a-choice'];
    case 'missing':
      return [];
    case 'repeated':
      return [good, good];
  }
}

/** The rules of Requirement 2.2, written out again here, for one field. */
function accepts(f: FieldSpec, values: readonly string[]): boolean {
  if (values.length !== 1) return false;
  const v = values[0]!;
  if (f.required && v.trim() === '') return false;
  if (f.maxLength !== undefined && v.length > f.maxLength) return false;
  if ((f.control === 'radio' || f.control === 'select') && !(f.values ?? []).includes(v)) return false;
  if (f.control === 'checkbox' && v !== f.value) return false;
  return true;
}

// Feature: accessforge-skeleton, Property 12: The Legacy_Handler accepts exactly the valid bodies and names every failure
describe('Property 12: the Legacy_Handler accepts exactly the valid bodies and names every failure', () => {
  it('accepts when every rule holds; otherwise the error page names exactly the failing fields', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ variant: fc.constantFrom(...VARIANTS), pick: fc.nat(100) }), { minLength: FIELDS.length, maxLength: FIELDS.length }),
        fc.array(fc.stringMatching(/^[a-z]{3,9}$/).filter((n) => !LEGACY_FIELD_NAMES.includes(n as never)), { maxLength: 2 }),
        async (plan, unknownNames) => {
          const pairs: Array<[string, string]> = [];
          const expectedFailing: string[] = [];
          FIELDS.forEach((f, i) => {
            const vals = valuesFor(f, plan[i]!.variant, plan[i]!.pick);
            for (const v of vals) pairs.push([f.name, v]);
            if (!accepts(f, vals)) expectedFailing.push(f.name);
          });
          for (const n of unknownNames) pairs.push([n, 'UNKNOWN-VALUE-9']);

          const res = await post(body(pairs));
          const html = await res.text();
          if (expectedFailing.length === 0 && unknownNames.length === 0) {
            expect(res.status).toBe(200);
            expect(html).toMatch(REFERENCE);
            return;
          }
          expect(res.status).toBe(422);
          expect(html).not.toMatch(REFERENCE);
          const items = Array.from(parseHtml(html).querySelectorAll('ul.gagal li')).map((li) => li.textContent ?? '');
          const named = items.filter((t) => (LEGACY_FIELD_NAMES as readonly string[]).includes(t));
          expect(named).toEqual(expectedFailing);
          expect(items.length - named.length).toBe(unknownNames.length > 0 ? 1 : 0);
          // No submitted value and no unknown name is echoed.
          // (An unknown name is a short word that can occur inside ordinary page text, so it is compared as a whole item.)
          for (const n of unknownNames) {
            expect(items.includes(n)).toBe(false);
            expect(parseHtml(html).querySelector(`[data-name="${n}"]`)).toBeNull();
          }
          expect(html.includes('UNKNOWN-VALUE-9')).toBe(false);
          for (const [, v] of pairs) if (v.length >= 5 && /[a-z]/i.test(v) && v !== 'PERIKSA') expect(html.includes(v), `value echoed: ${v}`).toBe(false);
        },
      ),
      RUNS,
    );
  });
});

// ---------------------------------------------------------------------------
// Properties 13 and 14
// ---------------------------------------------------------------------------

const noCr = (s: string) => !/[\r\u0000]/.test(s) && !/[\ud800-\udfff]/.test(s);
const printable = fc.string({ minLength: 1, maxLength: 60 }).filter(noCr);
const markup = fc.constantFrom('<b>x</b>', '"q"', "'s'", '&amp;', '<script>1</script>', '日本語 ünï', '  lead and trail  ');
const textValue = (max: number) =>
  fc.oneof(printable, markup).map((s) => [...s].slice(0, max).join('')).filter((s) => s.trim().length > 0 && s.length <= max);

const validBody = fc.record({
  nama: textValue(60),
  nokp: textValue(12),
  tlahir: textValue(10),
  jantina: fc.constantFrom('L', 'P'),
  tel: textValue(15),
  poskod: textValue(5),
  tujuan: fc.constantFrom('PERIKSA', 'SUSULAN', 'VAKSIN', 'LAIN'),
});

const structure = (el: Element): string =>
  `${el.tagName}[${el.getAttributeNames().sort().join(',')}](${Array.from(el.children).map(structure).join('')})`;

async function confirmationFor(values: Record<string, string>, query = '', deps: LegacyDeps = DEPS) {
  const pairs: Array<[string, string]> = [...Object.entries(values), ['akuan', 'YA']];
  // Entries go in form order, as a browser sends them.
  pairs.sort((a, b) => LEGACY_FIELD_NAMES.indexOf(a[0] as never) - LEGACY_FIELD_NAMES.indexOf(b[0] as never));
  const res = await handleLegacy(
    new Request(`https://reforge.example/legacy/register${query}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body(pairs) }),
    deps,
  );
  return { res, html: await res.text(), pairs };
}

const BASE = (async () => {
  const c = await confirmationFor(Object.fromEntries(VALID.filter(([n]) => n !== 'akuan')));
  return { structure: structure(parseHtml(c.html).body), headers: [...c.res.headers.entries()].sort() };
})();

// Feature: accessforge-skeleton, Property 13: The Received_Fields_Summary round-trips exactly
describe('Property 13: the Received_Fields_Summary round-trips exactly', () => {
  it('returns the eight body entries in form order, character for character, whatever the values and query', async () => {
    const { structure: base, headers: baseHeaders } = await BASE;
    await fc.assert(
      fc.asyncProperty(validBody, fc.constantFrom('', '?a=1', '?x=%3Cscript%3E&nama=EVIL', '?nama=Z&nama=Y'), async (values, query) => {
        const { res, html, pairs } = await confirmationFor(values, query);
        expect(res.status).toBe(200);
        const doc = parseHtml(html);
        const read = parseConfirmation(doc);
        expect(read).not.toBeNull();
        expect(read!.entries).toEqual(pairs.map(([name, value]) => ({ name, value })));
        expect(read!.entries.map((e) => e.name)).toEqual([...LEGACY_FIELD_NAMES]);
        // No response header carries a submitted value: the headers are those of a fixed valid body.
        expect([...res.headers.entries()].sort()).toEqual(baseHeaders);
        // The document has the element structure of one without markup in the values.
        expect(structure(doc.body)).toBe(base);
      }),
      RUNS,
    );
  });
});

// Feature: accessforge-skeleton, Property 14: Reference numbers follow the pattern and ignore submitted values
describe('Property 14: reference numbers follow the pattern and ignore submitted values', () => {
  it('has the UTC date of the request time, and a fixed random source gives the same digits for any body', async () => {
    await fc.assert(
      fc.asyncProperty(fc.date({ min: new Date('2000-01-01T00:00:00Z'), max: new Date('2099-12-31T23:59:59Z'), noInvalidDate: true }), validBody, validBody, async (when, a, b) => {
        const deps: LegacyDeps = { now: () => when, randomDigits: () => '314159' };
        const ra = parseConfirmation(parseHtml((await confirmationFor(a, '', deps)).html))!.reference!;
        const rb = parseConfirmation(parseHtml((await confirmationFor(b, '', deps)).html))!.reference!;
        const ymd = when.toISOString().slice(0, 10).replace(/-/g, '');
        expect(ra).toBe(`SR-DEMO-${ymd}-314159`);
        expect(rb).toBe(ra);
        expect(ra).toMatch(/^SR-DEMO-\d{8}-\d{6}$/);
      }),
      RUNS,
    );
  });
});

// ---------------------------------------------------------------------------
// Property 15
// ---------------------------------------------------------------------------

const APP_ORIGIN = window.location.origin;

function fakeFrame(origin: string, pathname: string, search: string, hash: string, pageType: string | null): HTMLIFrameElement {
  const doc = document.implementation.createHTMLDocument('x');
  if (pageType !== null) {
    const meta = doc.createElement('meta');
    meta.setAttribute('name', 'portal-page');
    meta.setAttribute('content', pageType);
    doc.head.appendChild(meta);
  }
  return { contentWindow: { location: { origin, pathname, search, hash } }, contentDocument: doc } as unknown as HTMLIFrameElement;
}

// Feature: accessforge-skeleton, Property 15: The frame check accepts exactly the four Allow_List transitions
describe('Property 15: the frame check accepts exactly the four Allow_List transitions', () => {
  it('is ok exactly when origin, query, hash, path and page type all match one entry', () => {
    const origins = fc.oneof(fc.constant(APP_ORIGIN), fc.constantFrom('https://evil.example', 'http://localhost:9', 'null', ''), fc.webUrl().map((u) => new URL(u).origin));
    const paths = fc.oneof(fc.constantFrom('/legacy/', '/legacy/register', '/legacy', '/legacy/register/', '/', '/api/x'), fc.string({ maxLength: 12 }).map((s) => `/${s}`));
    const searches = fc.oneof(fc.constant(''), fc.constantFrom('?', '?a=1', '?x'));
    const hashes = fc.oneof(fc.constant(''), fc.constantFrom('#', '#a', '#/legacy/'));
    const types = fc.oneof(fc.constantFrom('home', 'register', 'confirmation', 'error'), fc.constantFrom('', 'Home', 'unknown', 'REGISTER'), fc.constant(null));
    fc.assert(
      fc.property(origins, paths, searches, hashes, types, (origin, path, search, hash, type) => {
        const r = checkFrameDocument(fakeFrame(origin, path, search, hash, type), APP_ORIGIN);
        const expected = origin === APP_ORIGIN && search === '' && hash === '' && ALLOW_LIST.some((e) => e.path === path && e.pageType === type);
        expect(r.ok, `${origin} ${path}${search}${hash} ${String(type)}`).toBe(expected);
      }),
      RUNS,
    );
  });
});

// ---------------------------------------------------------------------------
// Property 19
// ---------------------------------------------------------------------------

type Status = 'filled' | 'skipped' | 'diy';
const FILLED_VALUES: Record<string, string | boolean> = {
  'f0:text:nama': 'LIN MEI TEST',
  'f0:text:nokp': '900101101234',
  'f0:text:tlahir': '01/01/1990',
  'f0:radio:jantina': 'P',
  'f0:text:tel': '011-2345 6789',
  'f0:text:poskod': '43000',
  'f0:select:tujuan': 'PERIKSA',
  'f0:checkbox:akuan': true,
};

// Feature: accessforge-skeleton, Property 19: Received data is verified against what was intended
describe('Property 19: received data is verified against what was intended', () => {
  it('has no difference exactly when no filled field or the reference was mutated', () => {
    const fields = MODEL.entries.filter((e) => e.control !== 'submit' && e.control !== 'reset');
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<Status>('filled', 'skipped', 'diy'), { minLength: fields.length, maxLength: fields.length }),
        fc.record({
          change: fc.option(fc.nat(), { nil: undefined }),
          remove: fc.option(fc.nat(), { nil: undefined }),
          unknown: fc.boolean(),
          repeat: fc.option(fc.nat(), { nil: undefined }),
          reference: fc.constantFrom('ok', 'missing', 'malformed'),
          touchOthers: fc.boolean(),
        }),
        (statuses, mut) => {
          const filled: FilledField[] = [];
          const entries: Array<{ name: string; value: string }> = [];
          fields.forEach((e, i) => {
            const status = statuses[i]!;
            if (status === 'filled') {
              const intended = FILLED_VALUES[e.elementId]!;
              filled.push({ entry: e, intended });
              entries.push({ name: e.name, value: e.control === 'checkbox' ? (e.checkboxValue ?? 'on') : String(intended) });
            } else {
              // A skipped or do-it-yourself field may arrive empty or with anything the user typed in the frame.
              entries.push({ name: e.name, value: mut.touchOthers ? 'typed in the frame' : '' });
            }
          });
          const filledEntries = filled.map((f) => f.entry.name);
          const mutated = [...entries];
          let expectDifference = false;

          if (mut.change !== undefined && filled.length > 0) {
            const name = filledEntries[mut.change % filledEntries.length]!;
            const i = mutated.findIndex((m) => m.name === name);
            mutated[i] = { name, value: `${mutated[i]!.value}X` };
            expectDifference = true;
          }
          if (mut.remove !== undefined && filled.length > 0) {
            const name = filledEntries[mut.remove % filledEntries.length]!;
            const i = mutated.findIndex((m) => m.name === name);
            if (i >= 0) {
              mutated.splice(i, 1);
              expectDifference = true;
            }
          }
          if (mut.unknown) {
            mutated.push({ name: 'not-a-field', value: 'v' });
            expectDifference = true;
          }
          if (mut.repeat !== undefined && mutated.length > 0) {
            const e = mutated[mut.repeat % mutated.length]!;
            mutated.push({ ...e });
            expectDifference = true;
          }
          const reference = mut.reference === 'ok' ? 'SR-DEMO-20261119-123456' : mut.reference === 'missing' ? null : 'SR-DEMO-2026-1';
          if (mut.reference !== 'ok') expectDifference = true;

          const diffs = compareReceived({ reference, originalText: null, entries: mutated }, filled, MODEL);
          expect(diffs.length === 0, JSON.stringify(diffs)).toBe(!expectDifference);
          // Skipped and do-it-yourself fields never produce a value, missing or reference difference by themselves.
          const otherNames = new Set(fields.filter((_, i) => statuses[i] !== 'filled').map((e) => e.name));
          for (const d of diffs) if (d.kind === 'value' || d.kind === 'missing') expect(otherNames.has(d.name)).toBe(false);
        },
      ),
      RUNS,
    );
  });
});

// ---------------------------------------------------------------------------
// Property 20
// ---------------------------------------------------------------------------

// Feature: accessforge-skeleton, Property 20: The form-target check passes only for the legacy handler
describe('Property 20: the form-target check passes only for the legacy handler', () => {
  it('passes exactly for POST to the app origin and /legacy/register with no formaction, formmethod or formtarget', () => {
    const actions = fc.constantFrom<string | null>(
      '/legacy/register',
      `${APP_ORIGIN}/legacy/register`,
      'https://evil.example/legacy/register',
      '//evil.example/legacy/register',
      '/legacy/register?x=1',
      '/legacy/register#h',
      '/legacy/',
      '/legacy/register/',
      'register',
      '',
      null,
    );
    const methods = fc.constantFrom<string | null>('post', 'POST', 'Post', 'get', 'GET', 'dialog', '', null);
    const attr = fc.constantFrom<string | null>(null, '/elsewhere', 'post', '_blank', '');
    fc.assert(
      fc.property(actions, methods, attr, attr, attr, fc.constantFrom('input', 'button'), (action, method, formaction, formmethod, formtarget, tag) => {
        const doc = document.implementation.createHTMLDocument('x');
        // A real frame document has the URL of the registration page, which relative actions resolve against.
        Object.defineProperty(doc, 'URL', { value: `${APP_ORIGIN}/legacy/register` });
        const form = doc.createElement('form');
        if (action !== null) form.setAttribute('action', action);
        if (method !== null) form.setAttribute('method', method);
        const submit = doc.createElement(tag);
        if (tag === 'input') submit.setAttribute('type', 'submit');
        if (formaction !== null) submit.setAttribute('formaction', formaction);
        if (formmethod !== null) submit.setAttribute('formmethod', formmethod);
        if (formtarget !== null) submit.setAttribute('formtarget', formtarget);
        form.appendChild(submit);
        doc.body.appendChild(form);

        let resolves = false;
        if (action !== null) {
          const t = new URL(action, doc.URL);
          resolves = t.origin === APP_ORIGIN && t.pathname === '/legacy/register' && t.search === '' && t.hash === '';
        }
        const expected = resolves && (method ?? '').toLowerCase() === 'post' && formaction === null && formmethod === null && formtarget === null;
        expect(checkFormTarget(doc, APP_ORIGIN).ok).toBe(expected);
      }),
      RUNS,
    );
  });
});
