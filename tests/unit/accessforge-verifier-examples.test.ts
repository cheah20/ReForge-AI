// @vitest-environment jsdom
/**
 * tests/unit/accessforge-verifier-examples.test.ts
 *
 * accessforge-skeleton tasks 11.4 and 11.6: read-back from the frame, and the
 * comparison of the legacy confirmation with what the Mirror wrote.
 * Validates: Requirements 10.1, 10.10, 10.11, 10.12, 11.7
 */

import { describe, it, expect } from 'vitest';
import { compareReceived, parseConfirmation, readBack, type FilledField } from '../../src/lib/accessforge/verifier.js';
import { execute } from '../../src/lib/accessforge/executor.js';
import { nextGeneration } from '../../src/lib/accessforge/generation.js';
import { TEMPLATES, ROW_TEMPLATES } from '../../src/worker/legacy/generated/templates.js';
import { fill } from '../../src/worker/legacy/render.js';
import { escapeHtml } from '../../src/worker/legacy/escape.js';
import { MODEL, contextFor, parse, registerDoc } from './accessforge-helpers.js';
import { VALID } from './legacy-helpers.js';

const entry = (name: string) => MODEL.entries.find((e) => e.name === name)!;
const REF = 'SR-DEMO-20261117-042137';

function confirmation(rows: Array<[string, string]>, reference = REF): Document {
  const summaryRows = rows.map(([name, value]) => fill(ROW_TEMPLATES.summaryRow, { name: escapeHtml(name), value: escapeHtml(value) })).join('');
  return parse(fill(TEMPLATES.confirmation, { summaryRows, reference: escapeHtml(reference) }));
}

/** The Synthetic_Registration as the Mirror wrote it. */
const FILLED: FilledField[] = VALID.map(([name, value]) => ({ entry: entry(name), intended: name === 'akuan' ? true : value }));

describe('readBack', () => {
  it('reads each control kind after the Executor writes it', () => {
    const doc = registerDoc();
    const ctx = contextFor(doc);
    expect(readBack(ctx.frame, ctx.actionGeneration, entry('nama'), doc)).toEqual({ kind: 'text', value: '' });
    expect(readBack(ctx.frame, ctx.actionGeneration, entry('jantina'), doc)).toEqual({ kind: 'radio', value: null });
    expect(readBack(ctx.frame, ctx.actionGeneration, entry('tujuan'), doc)).toEqual({ kind: 'select', value: '' });
    expect(readBack(ctx.frame, ctx.actionGeneration, entry('akuan'), doc)).toEqual({ kind: 'checkbox', checked: false });

    for (const action of [
      { kind: 'fill', elementId: 'f0:text:nama', value: ' LIN  MEI ' },
      { kind: 'check', elementId: 'f0:radio:jantina:P', checked: true },
      { kind: 'select', elementId: 'f0:select:tujuan', value: 'VAKSIN' },
      { kind: 'check', elementId: 'f0:checkbox:akuan', checked: true },
    ]) {
      expect(execute(action, ctx)).toEqual({ ok: true });
    }
    expect(readBack(ctx.frame, ctx.actionGeneration, entry('nama'), doc)).toEqual({ kind: 'text', value: ' LIN  MEI ' });
    expect(readBack(ctx.frame, ctx.actionGeneration, entry('jantina'), doc)).toEqual({ kind: 'radio', value: 'P' });
    expect(readBack(ctx.frame, ctx.actionGeneration, entry('tujuan'), doc)).toEqual({ kind: 'select', value: 'VAKSIN' });
    expect(readBack(ctx.frame, ctx.actionGeneration, entry('akuan'), doc)).toEqual({ kind: 'checkbox', checked: true });
  });

  it('refuses a read-back from an earlier generation or a replaced document', () => {
    const doc = registerDoc();
    const ctx = contextFor(doc);
    expect(readBack(nextGeneration(ctx.frame, doc), ctx.actionGeneration, entry('nama'), doc)).toBe('STALE_GENERATION');
    expect(readBack(ctx.frame, ctx.actionGeneration, entry('nama'), registerDoc())).toBe('STALE_GENERATION');
  });

  it('reports a missing control and a duplicated radio option', () => {
    const doc = registerDoc();
    doc.querySelector('input[name="nama"]')!.remove();
    const radio = doc.querySelector('input[name="jantina"]')!;
    radio.parentNode!.insertBefore(radio.cloneNode(), radio);
    const ctx = contextFor(doc);
    expect(readBack(ctx.frame, ctx.actionGeneration, entry('nama'), doc)).toBe('NOT_FOUND');
    expect(readBack(ctx.frame, ctx.actionGeneration, entry('jantina'), doc)).toBe('AMBIGUOUS');
  });
});

describe('parseConfirmation', () => {
  it('reads the reference, the original text and the rows exactly, including markup characters', () => {
    const read = parseConfirmation(confirmation([['nama', '<b>LIN & "MEI"</b>'], ['nokp', '900101101234']]))!;
    expect(read.reference).toBe(REF);
    expect(read.originalText).toBe('Sila simpan nombor rujukan ini untuk sebarang pertanyaan.');
    expect(read.entries).toEqual([
      { name: 'nama', value: '<b>LIN & "MEI"</b>' },
      { name: 'nokp', value: '900101101234' },
    ]);
  });

  it('gives originalText null when #mesej-pengesahan is missing', () => {
    const doc = confirmation(VALID);
    doc.getElementById('mesej-pengesahan')!.remove();
    expect(parseConfirmation(doc)).toMatchObject({ originalText: null, reference: REF });
  });

  it('returns null for a page without a received-fields summary', () => {
    expect(parseConfirmation(registerDoc())).toBeNull();
  });
});

describe('compareReceived', () => {
  const compare = (rows: Array<[string, string]>, filled = FILLED, reference = REF) => compareReceived(parseConfirmation(confirmation(rows, reference))!, filled, MODEL);

  it('finds no difference for the Synthetic_Registration, the checkbox matching on its own value', () => {
    expect(compare(VALID)).toEqual([]);
  });

  it('reports a changed value', () => {
    const rows = VALID.map(([n, v]): [string, string] => [n, n === 'tel' ? '0112345 6789' : v]);
    expect(compare(rows)).toEqual([{ kind: 'value', name: 'tel', intended: '011-2345 6789', received: '0112345 6789' }]);
  });

  it('reports a checkbox received with a value other than its own', () => {
    const rows = VALID.map(([n, v]): [string, string] => [n, n === 'akuan' ? 'on' : v]);
    expect(compare(rows)).toEqual([{ kind: 'value', name: 'akuan', intended: 'YA', received: 'on' }]);
  });

  it('reports a missing filled entry', () => {
    expect(compare(VALID.filter(([n]) => n !== 'poskod'))).toEqual([{ kind: 'missing', name: 'poskod' }]);
  });

  it('reports an unknown name and a repeated name', () => {
    expect(compare([...VALID, ['admin', '1'], ['nama', 'LIN MEI TEST']])).toEqual([
      { kind: 'unknownName', name: 'admin' },
      { kind: 'repeated', name: 'nama' },
    ]);
  });

  it.each([
    ['empty', ''],
    ['malformed', 'SR-DEMO-2026111-042137'],
    ['with trailing space', `${REF} `],
  ])('reports a %s reference', (_label, reference) => {
    expect(compare(VALID, FILLED, reference)).toEqual([{ kind: 'reference', reference }]);
  });

  it('reports an absent reference element as null', () => {
    const doc = confirmation(VALID);
    doc.getElementById('rujukan')!.remove();
    expect(compareReceived(parseConfirmation(doc)!, FILLED, MODEL)).toEqual([{ kind: 'reference', reference: null }]);
  });

  it('leaves skipped and do-it-yourself fields out of the comparison', () => {
    const filled = FILLED.filter((f) => f.entry.name !== 'tel' && f.entry.name !== 'tujuan');
    const rows = VALID.map(([n, v]): [string, string] => [n, n === 'tel' ? 'typed by the user' : n === 'tujuan' ? 'LAIN' : v]);
    expect(compare(rows, filled)).toEqual([]);
  });
});
