// @vitest-environment jsdom
/**
 * tests/unit/legacy-handler-examples.test.ts
 *
 * accessforge-skeleton task 5.6: submissions and the Received_Fields_Summary.
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.7, 2.9, 2.10
 */

import { describe, it, expect } from 'vitest';
import { newReferenceNumber } from '../../src/worker/legacy/reference.js';
import { validateSubmission, parseSubmission } from '../../src/worker/legacy/submission.js';
import { SAMPLE_FORM_PATH } from '../../src/shared/app-paths.js';
import { body, parseHtml, post, VALID } from './legacy-helpers.js';

const replace = (name: string, value: string) => VALID.map(([n, v]): [string, string] => [n, n === name ? value : v]);
const without = (name: string) => VALID.filter(([n]) => n !== name);

/** Names listed on an error page, in order. */
async function failing(res: Response): Promise<string[]> {
  expect(res.status).toBe(422);
  const d = parseHtml(await res.text());
  return [...d.querySelectorAll('ul.gagal li')].map((li) => li.textContent!);
}

describe('validation rules of Requirement 2.2', () => {
  it.each([
    ['missing name', body(without('nama')), ['nama']],
    ['blank (spaces only)', body(replace('nokp', '   ')), ['nokp']],
    ['repeated name', body([...VALID, ['poskod', '43000']]), ['poskod']],
    ['wrong consent value', body(replace('akuan', 'yes')), ['akuan']],
    ['consent missing (box not ticked)', body(without('akuan')), ['akuan']],
    ['wrong gender value', body(replace('jantina', 'X')), ['jantina']],
    ['select value outside the form', body(replace('tujuan', 'BEDAH')), ['tujuan']],
    ['empty select choice', body(replace('tujuan', '')), ['tujuan']],
    ['over maxlength', body(replace('poskod', '430001')), ['poskod']],
  ])('%s', async (_case, payload, names) => {
    expect(await failing(await post(payload))).toEqual(names);
  });

  it('an unknown name fails the submission and is never named', async () => {
    const res = await post(body([...VALID, ['secret_field_X9', 'v']]));
    const html = await res.text();
    expect(res.status).toBe(422);
    expect(html).not.toContain('secret_field_X9');
    expect(parseHtml(html).querySelector('ul.gagal')!.textContent).toBe('Borang mengandungi ruangan yang tidak dikenali.');
  });

  it('maxlength counts UTF-16 code units, as the browser does (decision I)', () => {
    const emoji = '\u{1F600}'; // two UTF-16 code units
    const at = (value: string) => validateSubmission(parseSubmission(body(replace('poskod', value))));
    expect(at('4300\u00e9').ok).toBe(true); // 5 units
    expect(at(`430${emoji}`).ok).toBe(true); // 3 + 2 = 5 units
    expect(at(`4300${emoji}`)).toEqual({ ok: false, failing: ['poskod'], unknownPresent: false }); // 6 units
  });
});

describe('the error page', () => {
  it('names every failing field at once, links back, has no reference, repeats no value', async () => {
    const pairs: Array<[string, string]> = [
      ['nama', '<b>CANARY-NAME-71</b>'],
      ['nokp', ''],
      ['jantina', 'X'],
      ['tel', '011-2345 6789'],
      ['poskod', 'CANARY-POST-34'],
      ['tujuan', 'PERIKSA'],
      ['nosuch', 'CANARY-UNKNOWN-88'],
    ];
    const res = await post(body(pairs));
    const html = await res.text();
    expect(await failing(new Response(html, { status: 422 }))).toEqual(['nokp', 'tlahir', 'jantina', 'poskod', 'akuan', 'Borang mengandungi ruangan yang tidak dikenali.']);
    const d = parseHtml(html);
    expect(d.querySelector('a[href="/legacy/register"]')).not.toBeNull();
    expect(html).not.toMatch(/SR-DEMO-/);
    for (const v of ['CANARY-NAME-71', 'CANARY-POST-34', 'CANARY-UNKNOWN-88', 'nosuch']) expect(html).not.toContain(v);
  });
});

describe('the confirmation and its summary', () => {
  it('lists eight entries in form order with values exactly as received; markup adds no element', async () => {
    const tricky: Array<[string, string]> = VALID.map(([n, v]): [string, string] => [n, n === 'nama' ? `  <script>alert("x")</script> & 'Lin' ` : v]);
    const res = await post(body(tricky));
    expect(res.status).toBe(200);
    const html = await res.text();
    const d = parseHtml(html);
    const rows = [...d.querySelectorAll('#ringkasan-diterima tr')];
    expect(rows.map((r) => r.querySelector('th')!.textContent)).toEqual(VALID.map(([n]) => n));
    expect(rows.map((r) => r.querySelector('th')!.getAttribute('data-name'))).toEqual(VALID.map(([n]) => n));
    expect(rows.map((r) => r.querySelector('td[data-value]')!.textContent)).toEqual(tricky.map(([, v]) => v));
    expect(d.querySelectorAll('script').length).toBe(0);
    expect(rows[0]!.querySelector('td')!.children.length).toBe(0);
    expect(d.getElementById('mesej-pengesahan')).not.toBeNull();
    expect(d.querySelector(`a[href="${SAMPLE_FORM_PATH}"]`)).not.toBeNull();
    const text = d.body.textContent!;
    expect(text).toContain('Pendaftaran anda telah diterima');
    expect(text).toContain('ini bukan pengesahan temujanji');
  });

  it('two identical bodies give identical summaries (Requirement 2.4)', async () => {
    const summary = async () => parseHtml(await (await post(body(VALID))).text()).getElementById('ringkasan-diterima')!.innerHTML;
    expect(await summary()).toBe(await summary());
  });

  it('a query string on the URL has no effect', async () => {
    const res = await post(body(VALID), { path: '/legacy/register?nama=FROM_QUERY&extra=1' });
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).not.toContain('FROM_QUERY');
    expect(parseHtml(html).querySelectorAll('#ringkasan-diterima tr')).toHaveLength(8);
  });

  it('a query string cannot supply a missing field', async () => {
    const res = await post(body(without('nama')), { path: '/legacy/register?nama=FROM_QUERY' });
    expect(await failing(res)).toEqual(['nama']);
  });
});

describe('reference number (Requirement 2.9)', () => {
  it('is SR-DEMO-YYYYMMDD-NNNNNN from the UTC date and the random digits', async () => {
    const html = await (await post(body(VALID))).text();
    expect(parseHtml(html).getElementById('rujukan')!.textContent).toBe('SR-DEMO-20261117-042137');
  });

  it('uses the UTC date, not the local one', () => {
    expect(newReferenceNumber(new Date(Date.UTC(2026, 11, 31, 23, 30)), () => '000001')).toBe('SR-DEMO-20261231-000001');
    expect(newReferenceNumber(new Date(Date.UTC(2027, 0, 1, 0, 0)), () => '999999')).toBe('SR-DEMO-20270101-999999');
  });

  it('ignores every submitted value', async () => {
    const a = parseHtml(await (await post(body(VALID))).text()).getElementById('rujukan')!.textContent;
    const b = parseHtml(await (await post(body(replace('nama', 'SOMEONE ELSE')))).text()).getElementById('rujukan')!.textContent;
    expect(a).toBe(b);
  });

  it('refuses random digits that are not six digits', () => {
    expect(() => newReferenceNumber(new Date(), () => '12345')).toThrow();
  });
});
