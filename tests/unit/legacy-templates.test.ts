// @vitest-environment jsdom
/**
 * tests/unit/legacy-templates.test.ts
 *
 * accessforge-skeleton task 4.6: the generated legacy templates.
 * Validates: Requirements 1.2, 1.4, 1.5, 1.6, 1.7, 1.8, 1.10, 4.1, 4.8
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CONTENT_STRINGS } from '../../src/lib/legacy-build/content.js';
import { generateAll, HOSTILE_PROBE, renderModule, UnsafeTemplateError } from '../../src/lib/legacy-build/generate.js';
import { findUnsafeConstructs, h } from '../../src/lib/legacy-build/html.js';
import { PAGE_BUILDERS } from '../../src/lib/legacy-build/templates.js';
import { LEGACY_FORM } from '../../src/worker/legacy/form-spec.js';
import { ROW_TEMPLATES, TEMPLATES } from '../../src/worker/legacy/generated/templates.js';
import { SAMPLE_FORM_PATH } from '../../src/shared/app-paths.js';
import { hostileTree } from '../e2e/helpers/hostile-pages.js';

type Name = keyof typeof TEMPLATES;
const NAMES = Object.keys(TEMPLATES) as Name[];
const html = (name: Name) => TEMPLATES[name].segments.join('');
const parse = (markup: string) => new DOMParser().parseFromString(markup, 'text/html');
const doc = (name: Name) => parse(html(name));

/** Text nodes with visible content, trimmed. */
function textNodes(d: Document): string[] {
  const walker = d.createTreeWalker(d.documentElement, NodeFilter.SHOW_TEXT);
  const out: string[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent!.trim();
    if (t) out.push(t);
  }
  return out;
}

describe('generator', () => {
  it('the committed generated/templates.ts is up to date (stale-file test)', async () => {
    const committed = readFileSync('src/worker/legacy/generated/templates.ts', 'utf8').replace(/\r\n/g, '\n');
    expect(renderModule(await generateAll())).toBe(committed);
  });

  it('no listed construct in any generated template, even with a hostile value in every slot', () => {
    for (const [name, t] of [...Object.entries(TEMPLATES), ...Object.entries(ROW_TEMPLATES)]) {
      expect(findUnsafeConstructs(t.segments.join(HOSTILE_PROBE)), name).toEqual([]);
    }
  });

  it('fails with the template name and every construct when a hostile tree reaches the scan (fake input: sanitiser skipped)', async () => {
    const builders = { ...PAGE_BUILDERS, error: () => hostileTree() };
    const run = generateAll(builders, { sanitize: (tree) => tree });
    await expect(run).rejects.toBeInstanceOf(UnsafeTemplateError);
    const err = (await run.catch((e: unknown) => e)) as UnsafeTemplateError;
    expect(err.template).toBe('error');
    expect(err.message).toMatch(/^Template "error" contains unsafe constructs: /);
    expect(err.constructs).toEqual(expect.arrayContaining(['script element', 'meta refresh', 'inline handler onload on body']));
  });

  it('the same hostile tree passes once the real sanitiser runs', async () => {
    const builders = { ...PAGE_BUILDERS, error: () => hostileTree() };
    const set = await generateAll(builders);
    expect(findUnsafeConstructs(set.templates.error.segments.join(HOSTILE_PROBE))).toEqual([]);
  });

  it('the probe catches an unescaped slot in an unsafe position: a slot raw inside a URL attribute of a fake tree', async () => {
    // Fake serialised input: a template whose slot sits in an href, filled with the probe.
    const builders = { ...PAGE_BUILDERS, error: () => h('html', {}, h('body', {}, h('a', { href: '/legacy/' }, 'x'))) };
    const set = await generateAll(builders);
    expect(set.templates.error.slots).toEqual([]);
    // A slot is only ever allowed in text or in data-name/data-value, so no URL can be built from one.
    const tree = h('html', {}, h('body', {}, h('a', { href: { slot: 'name' } as never }, 'x')));
    const built = (await import('../../src/lib/legacy-build/generate.js')).buildTemplate('fake', tree);
    expect(built.slots).toEqual([]);
    expect(built.segments.join('')).toBe('<!doctype html>\n<html><body><a>x</a></body></html>');
  });
});

describe('every document', () => {
  it.each(NAMES)('%s: the banner is the first visible element, in Malay and English', (name) => {
    const d = doc(name);
    const first = d.body.firstElementChild!;
    expect(first.className).toBe('banner');
    expect(first.textContent).toContain('PORTAL DEMONSTRASI REKAAN');
    expect(first.textContent).toContain('FICTIONAL DEMONSTRATION PORTAL');
  });

  it.each(NAMES)('%s: lang="ms", one same-origin stylesheet, no images, no script', (name) => {
    const d = doc(name);
    expect(d.documentElement.getAttribute('lang')).toBe('ms');
    expect([...d.querySelectorAll('link')].map((l) => l.getAttribute('href'))).toEqual(['/legacy-assets/portal.css']);
    expect(d.querySelectorAll('img, script, iframe, object, embed, base').length).toBe(0);
    expect(d.querySelectorAll('[style]').length).toBe(0);
  });

  it('page-type metas and version metas: home and register only carry a version', () => {
    const meta = (name: Name, m: string) => doc(name).querySelector(`meta[name="${m}"]`)?.getAttribute('content');
    expect(NAMES.map((n) => meta(n, 'portal-page'))).toEqual(['home', 'register', 'confirmation', 'error', 'not-found']);
    expect(meta('home', 'portal-page-version')).toMatch(/^[0-9a-f]{64}$/);
    expect(meta('register', 'portal-page-version')).toMatch(/^[0-9a-f]{64}$/);
    for (const n of ['confirmation', 'error', 'notFound'] as const) expect(meta(n, 'portal-page-version')).toBeUndefined();
  });

  it.each(['home', 'register'] as const)('%s (GET): every text node comes from the content file', (name) => {
    for (const t of textNodes(doc(name))) expect(CONTENT_STRINGS, t).toContain(t);
  });

  it.each(NAMES)('%s: links only to Allow_List GET paths (and the sample form on the confirmation)', (name) => {
    const allowed = name === 'confirmation' ? ['/legacy/', '/legacy/register', SAMPLE_FORM_PATH] : ['/legacy/', '/legacy/register'];
    for (const a of doc(name).querySelectorAll('a')) expect(allowed).toContain(a.getAttribute('href'));
  });
});

describe('home page menu (Requirement 1.4)', () => {
  it('has exactly five top-level entries; the register link is nested in the last one', () => {
    const d = doc('home');
    const entries = [...d.querySelectorAll('ul.menu > li')];
    expect(entries).toHaveLength(5);
    expect(entries[4]!.querySelector('ul a')!.getAttribute('href')).toBe('/legacy/register');
    for (const e of entries.slice(0, 4)) {
      const links = [...e.querySelectorAll('a')].map((a) => a.getAttribute('href'));
      expect(links.every((l) => l === '/legacy/')).toBe(true);
    }
  });
});

describe('registration form (Requirements 1.5, 1.6, 1.8)', () => {
  const d = doc('register');
  const form = d.querySelector('form')!;

  it('exactly one form, posting to /legacy/register', () => {
    expect(d.querySelectorAll('form')).toHaveLength(1);
    expect(form.getAttribute('action')).toBe('/legacy/register');
    expect(form.getAttribute('method')).toBe('post');
  });

  it('fields equal LEGACY_FORM in order, then one submit and one reset', () => {
    const controls = [...form.querySelectorAll('input, select')];
    const names = [...new Set(controls.map((c) => c.getAttribute('name')).filter(Boolean))];
    expect(names).toEqual(LEGACY_FORM.fields.map((f) => f.name));
    for (const f of LEGACY_FORM.fields) {
      const els = [...form.querySelectorAll(`[name="${f.name}"]`)];
      expect(els.every((e) => e.hasAttribute('required')), f.name).toBe(true);
      if (f.control === 'text') {
        expect(els).toHaveLength(1);
        expect(els[0]!.getAttribute('type')).toBe('text');
        expect(els[0]!.getAttribute('maxlength')).toBe(String(f.maxLength));
      } else if (f.control === 'radio') {
        expect(els.map((e) => [e.getAttribute('type'), e.getAttribute('value')])).toEqual(f.values.map((v) => ['radio', v]));
      } else if (f.control === 'select') {
        expect([...els[0]!.querySelectorAll('option')].map((o) => o.getAttribute('value'))).toEqual([...f.values]);
      } else {
        expect(els.map((e) => [e.getAttribute('type'), e.getAttribute('value')])).toEqual([['checkbox', f.value]]);
      }
    }
    const types = controls.map((c) => (c.tagName === 'SELECT' ? 'select' : c.getAttribute('type')));
    expect(types.slice(-2)).toEqual(['submit', 'reset']);
    expect(types.filter((t) => t === 'submit' || t === 'reset')).toHaveLength(2);
  });

  it('renders with no value: text empty, no radio or checkbox checked, select on an empty option', () => {
    for (const input of form.querySelectorAll<HTMLInputElement>('input[type=text]')) expect(input.value).toBe('');
    for (const input of form.querySelectorAll<HTMLInputElement>('input[type=radio], input[type=checkbox]')) expect(input.checked).toBe(false);
    // Cast instead of the generic: the Worker and DOM type libraries clash on HTMLSelectElement.
    expect((form.querySelector('select') as unknown as { value: string }).value).toBe('');
    expect(form.querySelectorAll('[checked], [selected]').length).toBe(0);
  });

  it('legacy traits: table layout, unlabelled inputs, abbreviated label in the neighbouring cell', () => {
    expect(d.body.querySelector('table.page')).not.toBeNull();
    expect(form.querySelector('table')).not.toBeNull();
    expect(d.querySelectorAll('label').length).toBe(0);
    for (const input of form.querySelectorAll('input, select')) {
      for (const a of ['aria-label', 'aria-labelledby', 'title', 'placeholder', 'id']) expect(input.hasAttribute(a), `${input.getAttribute('name')} ${a}`).toBe(false);
    }
    const nama = form.querySelector('[name="nama"]')!;
    expect(nama.closest('td')!.previousElementSibling!.textContent).toBe('Nama*');
  });

  it('legacy traits: free-text date box with only a format abbreviation in the same row', () => {
    const date = form.querySelector('[name="tlahir"]')!;
    expect(date.getAttribute('type')).toBe('text');
    expect(date.closest('tr')!.textContent).toContain('(hh/bb/tttt)');
  });

  it('legacy traits: consent explanation in the next row, with no control and no association', () => {
    const consentRow = form.querySelector('[name="akuan"]')!.closest('tr')!;
    const next = consentRow.nextElementSibling!;
    expect(next.querySelector('input, select, button')).toBeNull();
    expect(next.querySelector('small')!.textContent!.length).toBeGreaterThan(40);
    expect(consentRow.textContent).not.toContain(next.textContent!.trim());
  });

  it('legacy traits: reset directly after submit in the same cell', () => {
    const submit = form.querySelector('input[type=submit]')!;
    expect(submit.nextElementSibling!.getAttribute('type')).toBe('reset');
    expect(submit.parentElement).toBe(submit.nextElementSibling!.parentElement);
  });
});

describe('confirmation, error and not-found templates', () => {
  it('confirmation has the summary table, reference and message ids and the slots', () => {
    const d = doc('confirmation');
    for (const id of ['ringkasan-diterima', 'rujukan', 'mesej-pengesahan']) expect(d.getElementById(id), id).not.toBeNull();
    expect(TEMPLATES.confirmation.slots).toEqual(['summaryRows', 'reference']);
    expect(d.querySelector(`a[href="${SAMPLE_FORM_PATH}"]`)).not.toBeNull();
  });

  it('error has the failingNames slot and a link back to the form', () => {
    expect(TEMPLATES.error.slots).toEqual(['failingNames']);
    expect(doc('error').querySelector('a[href="/legacy/register"]')).not.toBeNull();
  });

  it('not-found has no form control and exactly one link, to /legacy/ (Requirement 1.10)', () => {
    const d = doc('notFound');
    expect(d.querySelectorAll('form, input, select, button, textarea').length).toBe(0);
    expect([...d.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['/legacy/']);
    expect(d.querySelector('ul.menu')).toBeNull();
  });

  it('row templates: the summary row carries the name twice (text and data-name) and the value once', () => {
    expect(ROW_TEMPLATES.summaryRow.slots).toEqual(['name', 'name', 'value']);
    expect(ROW_TEMPLATES.failingName.slots).toEqual(['name']);
    expect(ROW_TEMPLATES.unknownField.slots).toEqual([]);
    expect(CONTENT_STRINGS).toContain(parse(`<ul>${ROW_TEMPLATES.unknownField.segments[0]}</ul>`).querySelector('li')!.textContent);
  });
});
