// @vitest-environment jsdom
/**
 * tests/unit/accessforge-executor-examples.test.ts
 *
 * accessforge-skeleton task 11.3: Executor edge cases.
 * Validates: Requirements 3.9, 4.9, 8.10, 8.14
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { execute } from '../../src/lib/accessforge/executor.js';
import { extractPageModel } from '../../src/lib/accessforge/extract.js';
import { validatePlan } from '../../src/lib/accessforge/plan-validator.js';
import { nextGeneration } from '../../src/lib/accessforge/generation.js';
import { serialize } from '../../src/lib/legacy-build/html.js';
import { hostileTree } from '../e2e/helpers/hostile-pages.js';
import { MODEL, contextFor, parse, registerDoc, snapshot } from './accessforge-helpers.js';

const FILL = { kind: 'fill', elementId: 'f0:text:nama', value: 'LIN MEI TEST' };

afterEach(() => vi.restoreAllMocks());

describe('locating the element', () => {
  it('gives NOT_FOUND with no write when the element is missing', () => {
    const doc = registerDoc();
    doc.querySelector('input[name="nama"]')!.remove();
    const before = snapshot(doc);
    expect(execute(FILL, contextFor(doc))).toEqual({ ok: false, reason: 'NOT_FOUND' });
    expect(snapshot(doc)).toEqual(before);
  });

  it('gives AMBIGUOUS with no write when the element is duplicated', () => {
    const doc = registerDoc();
    const nama = doc.querySelector('input[name="nama"]')!;
    nama.parentNode!.insertBefore(nama.cloneNode(), nama.nextSibling);
    const before = snapshot(doc);
    expect(execute(FILL, contextFor(doc))).toEqual({ ok: false, reason: 'AMBIGUOUS' });
    expect(snapshot(doc)).toEqual(before);
  });

  it('never uses the Element_Id as a selector: an id attribute equal to the name is irrelevant', () => {
    const doc = registerDoc();
    const decoy = doc.createElement('input');
    decoy.setAttribute('id', 'nama');
    doc.body.appendChild(decoy);
    expect(execute(FILL, contextFor(doc))).toEqual({ ok: true });
    expect((decoy as unknown as { value: string }).value).toBe('');
    expect((doc.querySelector('input[name="nama"]') as unknown as { value: string }).value).toBe('LIN MEI TEST');
  });
});

describe('generation and document identity', () => {
  it('rejects a write stamped with an old generation', () => {
    const doc = registerDoc();
    const ctx = contextFor(doc);
    const before = snapshot(doc);
    expect(execute(FILL, { ...ctx, frame: nextGeneration(ctx.frame, doc) })).toEqual({ ok: false, reason: 'STALE_GENERATION' });
    expect(snapshot(doc)).toEqual(before);
  });

  it('rejects a write when the iframe already shows a replaced document with the same Page_Version', () => {
    const doc = registerDoc();
    const replacement = registerDoc();
    const before = [snapshot(doc), snapshot(replacement)];
    expect(execute(FILL, contextFor(doc, { liveDocument: replacement }))).toEqual({ ok: false, reason: 'STALE_GENERATION' });
    expect([snapshot(doc), snapshot(replacement)]).toEqual(before);
  });
});

describe('Page_Version', () => {
  it('rejects every Action kind when the version meta has changed', () => {
    const doc = registerDoc();
    doc.querySelector('meta[name="portal-page-version"]')!.setAttribute('content', '0'.repeat(64));
    const before = snapshot(doc);
    const submit = vi.spyOn(window.HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
    for (const action of [
      FILL,
      { kind: 'select', elementId: 'f0:select:tujuan', value: 'PERIKSA' },
      { kind: 'check', elementId: 'f0:radio:jantina:P', checked: true },
      { kind: 'check', elementId: 'f0:checkbox:akuan', checked: true },
      { kind: 'click', elementId: 'f0:submit:' },
    ]) {
      expect(execute(action, contextFor(doc, { submitArmed: true }))).toEqual({ ok: false, reason: 'VERSION_CHANGED' });
    }
    expect(snapshot(doc)).toEqual(before);
    expect(submit).not.toHaveBeenCalled();
  });
});

describe('form target', () => {
  it('rejects the click on the hostile form with FORM_TARGET and submits nothing', () => {
    const doc = parse(serialize(hostileTree()));
    const meta = doc.createElement('meta');
    meta.setAttribute('name', 'portal-page-version');
    meta.setAttribute('content', 'a'.repeat(64));
    doc.head.appendChild(meta);
    const r = extractPageModel(doc, 'a'.repeat(64));
    if (!r.ok) throw new Error(`hostile page did not extract: ${r.code}`);
    expect(r.model.entries.map((e) => e.elementId)).toEqual(['f0:text:nama', 'f0:submit:']);
    const submit = vi.spyOn(window.HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
    const ctx = contextFor(doc, { model: r.model, plan: validatePlan(r.model, []), submitArmed: true });
    expect(execute({ kind: 'click', elementId: 'f0:submit:' }, ctx)).toEqual({ ok: false, reason: 'FORM_TARGET' });
    expect(submit).not.toHaveBeenCalled();
  });

  it('rejects a fill on the real form once its action points elsewhere', () => {
    const doc = registerDoc();
    doc.querySelector('form')!.setAttribute('action', 'https://evil.example/collect');
    expect(execute(FILL, contextFor(doc))).toEqual({ ok: false, reason: 'FORM_TARGET' });
  });
});

describe('reasons for other refusals', () => {
  it.each([
    ['a letter-case kind', { kind: 'Click', elementId: 'f0:submit:' }, 'SCHEMA'],
    ['a submit kind', { kind: 'submit', elementId: 'f0:submit:' }, 'SCHEMA'],
    ['an extra property', { ...FILL, selector: '#nama' }, 'SCHEMA'],
    ['an unknown id', { ...FILL, elementId: 'f0:text:Nama' }, 'UNKNOWN_ELEMENT'],
    ['the reset button', { kind: 'click', elementId: 'f0:reset:' }, 'RESET_BUTTON'],
    ['fill on a select', { kind: 'fill', elementId: 'f0:select:tujuan', value: 'PERIKSA' }, 'KIND_MISMATCH'],
    ['a value over maxlength', { ...FILL, value: 'x'.repeat(61) }, 'TOO_LONG'],
    ['a display label as option', { kind: 'select', elementId: 'f0:select:tujuan', value: 'Pemeriksaan am' }, 'NOT_AN_OPTION'],
  ])('rejects %s', (_label, action, reason) => {
    expect(execute(action, contextFor(registerDoc(), { submitArmed: true }))).toEqual({ ok: false, reason });
  });

  it('rejects ticking consent while the Mirror consent box is unticked, and allows unticking', () => {
    const doc = registerDoc();
    expect(execute({ kind: 'check', elementId: 'f0:checkbox:akuan', checked: true }, contextFor(doc, { consentGiven: false }))).toEqual({ ok: false, reason: 'CONSENT_NOT_GIVEN' });
    expect(execute({ kind: 'check', elementId: 'f0:checkbox:akuan', checked: false }, contextFor(doc, { consentGiven: false }))).toEqual({ ok: true });
  });

  it('performs no Action on a do-it-yourself field', () => {
    const doc = registerDoc();
    const plan = validatePlan(MODEL, []);
    expect(execute(FILL, contextFor(doc, { plan }))).toEqual({ ok: false, reason: 'DO_IT_YOURSELF' });
    expect(execute({ kind: 'check', elementId: 'f0:radio:jantina:L', checked: true }, contextFor(doc, { plan }))).toEqual({ ok: false, reason: 'DO_IT_YOURSELF' });
  });
});
