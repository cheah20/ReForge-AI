// @vitest-environment jsdom
/**
 * tests/unit/accessforge-extract-examples.test.ts
 *
 * accessforge-skeleton task 8.3: Page_Extractor evidence and refusals on the
 * generated registration page and on small built documents.
 * Validates: Requirements 5.1, 5.3, 5.4, 5.6, 5.10, 6.19
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { extractPageModel, MAX_CONTROLS } from '../../src/lib/accessforge/extract.js';
import { PageModelSchema, type PageEntry, type PageModel } from '../../src/shared/page-schemas.js';
import { TEMPLATES } from '../../src/worker/legacy/generated/templates.js';
import { fill } from '../../src/worker/legacy/render.js';
import { PAGE_VERSIONS } from '../../src/worker/legacy/generated/templates.js';

const VERSION = PAGE_VERSIONS.register;
const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');
const registerDoc = () => parse(fill(TEMPLATES.register, {}));

function model(doc: Document | null): PageModel {
  const r = extractPageModel(doc, VERSION);
  if (!r.ok) throw new Error(`refused: ${r.code}`);
  return r.model;
}

const byName = (m: PageModel, id: string): PageEntry => {
  const e = m.entries.find((x) => x.elementId === id);
  if (!e) throw new Error(`no entry ${id}`);
  return e;
};

/** A one-form page; `rows` are the form's table rows. */
const page = (rows: string, extra = '') =>
  parse(`<!doctype html><html><body>${extra}<form action="/legacy/register" method="post"><table>${rows}</table><input type="submit" value="Hantar"></form></body></html>`);

const CONSENT =
  'Dengan menanda kotak akuan, saya mengesahkan bahawa maklumat di atas adalah benar dan bersetuju maklumat ini digunakan oleh klinik untuk tujuan pendaftaran sahaja.';

afterEach(() => vi.restoreAllMocks());

describe('extractPageModel on the registration page', () => {
  it('gives the ten Element_Ids of design Question 2 in document order', () => {
    const m = model(registerDoc());
    expect(m.entries.map((e) => e.elementId)).toEqual([
      'f0:text:nama',
      'f0:text:nokp',
      'f0:text:tlahir',
      'f0:radio:jantina',
      'f0:text:tel',
      'f0:text:poskod',
      'f0:select:tujuan',
      'f0:checkbox:akuan',
      'f0:submit:',
      'f0:reset:',
    ]);
    expect(m.entries.map((e) => e.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(m.path).toBe('/legacy/register');
    expect(m.pageVersion).toBe(VERSION);
    expect(PageModelSchema.safeParse(m).success).toBe(true);
  });

  it('records the neighbouring-cell text of every field and no label text, because the page has no label elements', () => {
    const m = model(registerDoc());
    expect(m.entries.map((e) => [e.elementId, e.neighbourText, e.labelText])).toEqual([
      ['f0:text:nama', 'Nama*', ''],
      ['f0:text:nokp', 'No. K/P*', ''],
      ['f0:text:tlahir', 'Tkh. Lahir*', ''],
      ['f0:radio:jantina', 'Jantina*', ''],
      ['f0:text:tel', 'No. Tel. Bimbit*', ''],
      ['f0:text:poskod', 'Poskod*', ''],
      ['f0:select:tujuan', 'Tujuan*', ''],
      ['f0:checkbox:akuan', 'Akuan*', ''],
      ['f0:submit:', '', ''],
      ['f0:reset:', '', ''],
    ]);
  });

  it('records the date hint as nearby text and leaves every other nearby text empty', () => {
    const m = model(registerDoc());
    expect(m.entries.map((e) => [e.elementId, e.nearbyText])).toEqual([
      ['f0:text:nama', ''],
      ['f0:text:nokp', ''],
      ['f0:text:tlahir', '(hh/bb/tttt)'],
      ['f0:radio:jantina', ''],
      ['f0:text:tel', ''],
      ['f0:text:poskod', ''],
      ['f0:select:tujuan', ''],
      ['f0:checkbox:akuan', ''],
      ['f0:submit:', ''],
      ['f0:reset:', ''],
    ]);
  });

  it('sets next-row text for the consent checkbox only', () => {
    const m = model(registerDoc());
    expect(byName(m, 'f0:checkbox:akuan').nextRowText).toBe(CONSENT);
    for (const e of m.entries.filter((x) => x.control !== 'checkbox')) expect(e.nextRowText).toBe('');
  });

  it('records options, required, maxlength and the checkbox value', () => {
    const m = model(registerDoc());
    expect(byName(m, 'f0:radio:jantina').options).toEqual([
      { value: 'L', text: 'Lelaki', elementId: 'f0:radio:jantina:L' },
      { value: 'P', text: 'Perempuan', elementId: 'f0:radio:jantina:P' },
    ]);
    const tujuan = byName(m, 'f0:select:tujuan');
    expect(tujuan.hasEmptyOption).toBe(true);
    expect(tujuan.options).toEqual([
      { value: 'PERIKSA', text: 'Pemeriksaan am' },
      { value: 'SUSULAN', text: 'Rawatan susulan' },
      { value: 'VAKSIN', text: 'Suntikan vaksin' },
      { value: 'LAIN', text: 'Lain-lain' },
    ]);
    expect(byName(m, 'f0:checkbox:akuan').checkboxValue).toBe('YA');
    expect(m.entries.map((e) => e.maxLength)).toEqual([60, 12, 10, null, 15, 5, null, null, null, null]);
    expect(m.entries.map((e) => e.required)).toEqual([true, true, true, true, true, true, true, true, false, false]);
    expect(m.entries.every((e) => e.duplicateId === false && e.id === '')).toBe(true);
  });

  it('finishes within 1 second with no network request', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const xhrOpen = vi.spyOn(XMLHttpRequest.prototype, 'open');
    const doc = registerDoc();
    const t0 = performance.now();
    const r = extractPageModel(doc, VERSION);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(r.ok).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrOpen).not.toHaveBeenCalled();
  });
});

describe('extractPageModel evidence on built documents', () => {
  it('reads label text tied by for and by wrapping, and keeps it out of nearby text', () => {
    const m = model(
      page(
        '<tr><td>Kiri</td><td><label for="a1">Nama penuh</label> <input type="text" name="a" id="a1"> nota</td></tr>' +
          '<tr><td><label>Emel <input type="text" name="b"></label> lain</td></tr>',
      ),
    );
    expect(byName(m, 'f0:text:a')).toMatchObject({ labelText: 'Nama penuh', neighbourText: 'Kiri', nearbyText: 'nota', id: 'a1' });
    expect(byName(m, 'f0:text:b')).toMatchObject({ labelText: 'Emel', neighbourText: '', nearbyText: 'lain' });
  });

  it('collapses whitespace and cuts label, neighbouring-cell, nearby and next-row text at 200 characters', () => {
    const long = 'x'.repeat(150) + '   \n\t ' + 'y'.repeat(150);
    const m = model(
      page(
        `<tr><td>${long}</td><td><label for="c">${long}</label><input type="checkbox" name="c" id="c"> ${long}</td></tr>` +
          `<tr><td>${long}</td></tr>`,
      ),
    );
    const want = ('x'.repeat(150) + ' ' + 'y'.repeat(150)).slice(0, 200);
    expect(byName(m, 'f0:checkbox:c')).toMatchObject({ labelText: want, neighbourText: want, nearbyText: want, nextRowText: want });
  });

  it('leaves next-row text empty when the next row contains a control', () => {
    const m = model(page('<tr><td><input type="checkbox" name="c"></td></tr><tr><td>Teks <input type="text" name="t"></td></tr>'));
    expect(byName(m, 'f0:checkbox:c').nextRowText).toBe('');
  });

  it('skips hidden inputs entirely', () => {
    const m = model(page('<tr><td><input type="hidden" name="token" value="SECRET"><input type="text" name="a"></td></tr>'));
    expect(m.entries.map((e) => e.elementId)).toEqual(['f0:text:a', 'f0:submit:']);
    expect(JSON.stringify(m)).not.toMatch(/token|SECRET/);
  });

  it('records a textarea as unsupported and keeps its default text out of the model', () => {
    const m = model(page('<tr><td>Alamat</td><td><textarea name="alamat">DEFAULT_TEXT</textarea></td></tr>'));
    expect(byName(m, 'f0:unsupported:alamat')).toMatchObject({ control: 'unsupported', neighbourText: 'Alamat', nearbyText: '' });
    expect(JSON.stringify(m)).not.toContain('DEFAULT_TEXT');
  });
});

describe('extractPageModel refusals', () => {
  const controls = (n: number) => '<tr><td>' + Array.from({ length: n }, (_, i) => `<input type="text" name="c${i}">`).join('') + '</td></tr>';

  it(`accepts ${MAX_CONTROLS} form controls and refuses ${MAX_CONTROLS + 1}`, () => {
    // page() adds the submit button as one more control.
    const ok = extractPageModel(page(controls(MAX_CONTROLS - 1)), VERSION);
    expect(ok.ok && ok.model.entries.length).toBe(MAX_CONTROLS);
    expect(extractPageModel(page(controls(MAX_CONTROLS)), VERSION)).toEqual({ ok: false, code: 'TOO_MANY_CONTROLS' });
  });

  it('counts hidden inputs toward the control limit', () => {
    const hidden = Array.from({ length: 2 }, (_, i) => `<input type="hidden" name="h${i}">`).join('');
    expect(extractPageModel(page(controls(MAX_CONTROLS - 2) + `<tr><td>${hidden}</td></tr>`), VERSION)).toEqual({ ok: false, code: 'TOO_MANY_CONTROLS' });
  });

  it('refuses a page with no form', () => {
    expect(extractPageModel(parse(fill(TEMPLATES.home, {})), VERSION)).toEqual({ ok: false, code: 'NO_FORM' });
  });

  it('refuses a page with two forms', () => {
    const doc = registerDoc();
    doc.body.appendChild(doc.createElement('form'));
    expect(extractPageModel(doc, VERSION)).toEqual({ ok: false, code: 'MULTIPLE_FORMS' });
  });

  it('refuses zero and two submit buttons with SUBMIT_COUNT', () => {
    const none = registerDoc();
    none.querySelector('input[type="submit"]')!.remove();
    expect(extractPageModel(none, VERSION)).toEqual({ ok: false, code: 'SUBMIT_COUNT' });
    const two = registerDoc();
    const submit = two.querySelector('input[type="submit"]')!;
    submit.parentNode!.insertBefore(submit.cloneNode(), submit.nextSibling);
    expect(extractPageModel(two, VERSION)).toEqual({ ok: false, code: 'SUBMIT_COUNT' });
  });

  it('counts a button element and an image input as submit buttons', () => {
    const btn = registerDoc();
    btn.querySelector('form')!.appendChild(btn.createElement('button'));
    expect(extractPageModel(btn, VERSION)).toEqual({ ok: false, code: 'SUBMIT_COUNT' });
    const img = registerDoc();
    const image = img.createElement('input');
    image.setAttribute('type', 'image');
    img.querySelector('form')!.appendChild(image);
    expect(extractPageModel(img, VERSION)).toEqual({ ok: false, code: 'SUBMIT_COUNT' });
  });

  it('refuses a document it cannot read', () => {
    expect(extractPageModel(null, VERSION)).toEqual({ ok: false, code: 'UNREADABLE' });
    const crossOrigin = {
      getElementsByTagName(): never {
        throw new DOMException('Blocked a frame from accessing a cross-origin frame.', 'SecurityError');
      },
    } as unknown as Document;
    expect(extractPageModel(crossOrigin, VERSION)).toEqual({ ok: false, code: 'UNREADABLE' });
  });

  it('refuses a control whose name is too long to locate exactly', () => {
    expect(extractPageModel(page(`<tr><td><input type="text" name="${'n'.repeat(101)}"></td></tr>`), VERSION)).toEqual({
      ok: false,
      code: 'UNREADABLE',
    });
    expect(extractPageModel(page(`<tr><td><input type="text" name="${'n'.repeat(100)}"></td></tr>`), VERSION).ok).toBe(true);
  });

  it('refuses a name whose Element_Id would exceed 256 characters', () => {
    // 100 characters of U+4E00 encode to 900 characters.
    expect(extractPageModel(page(`<tr><td><input type="text" name="${'\u4e00'.repeat(100)}"></td></tr>`), VERSION)).toEqual({
      ok: false,
      code: 'UNREADABLE',
    });
  });

  it('refuses a name that cannot be encoded into an Element_Id', () => {
    const doc = page('<tr><td><input type="text" name="a"></td></tr>');
    doc.querySelector('input[name="a"]')!.setAttribute('name', 'a\uD800');
    expect(extractPageModel(doc, VERSION)).toEqual({ ok: false, code: 'UNREADABLE' });
  });
});
