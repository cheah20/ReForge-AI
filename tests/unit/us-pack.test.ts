/**
 * tests/unit/us-pack.test.ts
 *
 * Task 23: the United States pack. Synthetic values only; 555-0100 to 555-0199
 * are fictional numbers. Format checks, never verification.
 * Validates: Requirement 7.4
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import fc from 'fast-check';
import { isSsnField, usPack, validateSsn, validateUsPhone, validateZip } from '../../src/packs/country/us.js';
import { getCountryPack } from '../../src/packs/country/registry.js';
import { validateAnswer } from '../../src/packs/country/validate.js';
import { extractFields } from '../../src/lib/pdf-extract/index.js';
import type { FieldEvidence } from '../../src/shared/types.js';

describe('NANP phone', () => {
  it.each([
    ['(202) 555-0100', '(202) 555-0100'],
    ['202-555-0199', '(202) 555-0199'],
    ['+1 202 555 0100', '(202) 555-0100'],
    ['+12025550123', '(202) 555-0123'], // fixture acceptance answer
    ['12025550100', '(202) 555-0100'], // bare leading 1
    ['2025550100', '(202) 555-0100'],
    ['202.555.0100', '(202) 555-0100'],
    ['202-555-0200', '(202) 555-0200'], // outside the fictional range: still a valid shape
  ])('accepts %s as %s', (input, out) => {
    expect(validateUsPhone(input)).toEqual({ valid: true, normalizedValue: out });
  });

  it.each([
    '102-555-0100', // area code starts with 1
    '002-555-0100', // area code starts with 0
    '202-155-0100', // exchange starts with 1
    '211-555-0100', // N11 area code
    '911-555-0100',
    '202-911-0100', // N11 exchange
    '202-411-0100',
    '555-0100', // incomplete
    '+44 20 7946 0958', // not NANP
    '22025550100', // 11 digits not starting with 1
    '1-202-555-01000',
    '202-555-010x',
    '',
  ])('rejects %s', (input) => {
    expect(validateUsPhone(input)).toEqual({ valid: false, messageKey: 'validation.phone.invalid' });
  });

  it('the written value fits the US form MaxLen of 14', () => {
    expect(validateAnswer(usPack, 'phone', '+12025550123', { maxLength: 14 })).toEqual({ valid: true, normalizedValue: '(202) 555-0123' });
  });

  it('property: every valid NPA-NXX-XXXX is accepted in each written style and gives the same output', () => {
    const part = fc.tuple(fc.integer({ min: 2, max: 9 }), fc.integer({ min: 0, max: 9 }), fc.integer({ min: 0, max: 9 }))
      .filter(([, b, c]) => !(b === 1 && c === 1))
      .map((d) => d.join(''));
    fc.assert(
      fc.property(part, part, fc.stringMatching(/^\d{4}$/), (npa, nxx, line) => {
        const out = `(${npa}) ${nxx}-${line}`;
        for (const style of [`${npa}${nxx}${line}`, `${npa}-${nxx}-${line}`, `+1 ${npa} ${nxx} ${line}`, `1${npa}${nxx}${line}`, out]) {
          expect(validateUsPhone(style), style).toEqual({ valid: true, normalizedValue: out });
        }
      }),
    );
  });
});

describe('ZIP and ZIP+4', () => {
  it.each(['01234', '01234-0001', '00000', '02108-1234', ' 90210 '])('accepts %s', (input) => {
    expect(validateZip(input)).toEqual({ valid: true, normalizedValue: input.trim() });
  });

  it.each(['1234', '012340001', '01234-123', '12A45', '123456', '01234 0001', ''])('rejects %s', (input) => {
    expect(validateZip(input)).toEqual({ valid: false, messageKey: 'validation.zip.invalid' });
  });

  it('postcode answers on a US form use the ZIP rule', () => {
    expect(validateAnswer(usPack, 'postcode', '12A45')).toMatchObject({ valid: false, messageKey: 'validation.zip.invalid' });
    expect(validateAnswer(usPack, 'postcode', '02108-1234', { maxLength: 10 }).valid).toBe(true);
  });
});

describe('SSN: format check only', () => {
  it.each([
    ['123-45-6788', '123-45-6788'], // fixture acceptance answer
    ['899-99-9999', '899-99-9999'],
    ['665-12-3456', '665-12-3456'],
    ['667-12-3456', '667-12-3456'],
    ['123456788', '123-45-6788'], // compact input written back with hyphens
  ])('accepts %s as %s', (input, out) => {
    expect(validateSsn(input)).toEqual({ valid: true, normalizedValue: out });
  });

  it.each(['000-12-3456', '666-12-3456', '900-12-3456', '999-12-3456', '123-00-3456', '123-45-0000', '123-45-678', '123 45 6788', '12-345-6788', ''])(
    'rejects %s',
    (input) => {
      expect(validateSsn(input)).toEqual({ valid: false, messageKey: 'validation.ssn.invalid' });
    },
  );

  it('the SSN field of the US fixture, and only that field, is recognised from the printed label', async () => {
    const r = await extractFields(new Uint8Array(readFileSync('fixtures/us-community-clinic.pdf')));
    if (!r.ok) throw new Error('fixture');
    const ssn = r.fields.filter((f: FieldEvidence) => isSsnField(f)).map((f) => f.fieldId);
    expect(ssn).toEqual(['Text1']);
  });

  it('validateAnswer applies the SSN rule to a text answer only when the field is an SSN field', () => {
    expect(validateAnswer(usPack, 'text', '000-12-3456', { ssn: true })).toMatchObject({ valid: false, messageKey: 'validation.ssn.invalid' });
    expect(validateAnswer(usPack, 'text', '000-12-3456', {})).toEqual({ valid: true, normalizedValue: '000-12-3456' });
  });
});

describe('registry and dates', () => {
  it('serves the US pack for US', () => {
    expect(getCountryPack('us')).toBe(usPack);
  });

  it('writes US dates as MM/DD/YYYY once confirmed (fixture: 1992-02-03 to 02/03/1992)', () => {
    expect(validateAnswer(usPack, 'date', '1992-02-03', { tooltip: 'Date of birth, MM/DD/YYYY', maxLength: 10 })).toEqual({
      valid: true,
      normalizedValue: '02/03/1992',
    });
  });
});

describe('the US fixture acceptance answers (fixture spec section 3)', () => {
  let byId: Map<string, FieldEvidence>;
  beforeAll(async () => {
    const r = await extractFields(new Uint8Array(readFileSync('fixtures/us-community-clinic.pdf')));
    if (!r.ok) throw new Error('fixture');
    byId = new Map(r.fields.map((f) => [f.fieldId, f]));
  });

  it.each([
    ['patient.birthDate', 'date', '1992-02-03', '02/03/1992'],
    ['Text1', 'text', '123-45-6788', '123-45-6788'],
    ['contact.phone', 'phone', '+12025550123', '(202) 555-0123'],
    ['Text7', 'postcode', '02108-1234', '02108-1234'],
    ['contact.email', 'email', 'lucia.perez@example.invalid', 'lucia.perez@example.invalid'],
    ['visit.date', 'date', '2026-12-01', '12/01/2026'],
  ] as const)('%s: %s answer %s is written as %s', (id, type, raw, out) => {
    const f = byId.get(id)!;
    const r = validateAnswer(usPack, type, raw, {
      required: f.required,
      ...(f.maxLength !== undefined ? { maxLength: f.maxLength } : {}),
      ...(f.tooltip !== undefined ? { tooltip: f.tooltip } : {}),
      pageText: f.widgets[0]!.pageSnippet,
      ssn: isSsnField(f),
    });
    expect(r).toEqual({ valid: true, normalizedValue: out });
  });

  it('rejects the wrong ZIP first (12A45)', () => {
    const f = byId.get('Text7')!;
    expect(validateAnswer(usPack, 'postcode', '12A45', { maxLength: f.maxLength! })).toMatchObject({ messageKey: 'validation.zip.invalid' });
  });
});
