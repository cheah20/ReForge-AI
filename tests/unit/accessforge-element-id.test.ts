/**
 * tests/unit/accessforge-element-id.test.ts
 *
 * accessforge-skeleton task 7.1: the Element_Id formula of design Question 2.
 * Validates: Requirements 5.3, 8.3, 8.13
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { elementIdFor, parseElementId, radioOptionIdFor, ElementIdEncodingError, type ElementKey } from '../../src/lib/accessforge/element-id.js';
import { ControlTypeSchema } from '../../src/shared/page-schemas.js';

const controlArb = fc.constantFrom(...ControlTypeSchema.options);
// Names and values with the separator, percent signs, markup and any code point.
const textArb = fc.oneof(
  fc.string({ unit: 'binary', maxLength: 40 }),
  fc.stringMatching(/^[:%a-zA-Z0-9<>"' ]{0,20}$/),
);
const keyArb: fc.Arbitrary<ElementKey> = fc.oneof(
  fc.record({ formIndex: fc.nat(3), control: controlArb, name: textArb }),
  fc.record({ formIndex: fc.nat(3), control: fc.constant('radio' as const), name: textArb, optionValue: textArb }),
);

describe('elementIdFor', () => {
  it('follows the formula for entries and radio options', () => {
    expect(elementIdFor({ formIndex: 0, control: 'text', name: 'nama' })).toBe('f0:text:nama');
    expect(elementIdFor({ formIndex: 0, control: 'radio', name: 'jantina' })).toBe('f0:radio:jantina');
    expect(radioOptionIdFor(0, 'jantina', 'L')).toBe('f0:radio:jantina:L');
    expect(elementIdFor({ formIndex: 0, control: 'submit', name: '' })).toBe('f0:submit:');
  });

  it('encodes a colon in a name so it cannot fake a separator', () => {
    const id = elementIdFor({ formIndex: 0, control: 'radio', name: 'a:b' });
    expect(id).toBe('f0:radio:a%3Ab');
    expect(id).not.toBe(radioOptionIdFor(0, 'a', 'b'));
    expect(parseElementId(id)).toEqual({ formIndex: 0, control: 'radio', name: 'a:b' });
  });

  it('refuses an option value on a control that is not a radio', () => {
    expect(() => elementIdFor({ formIndex: 0, control: 'select', name: 'negeri', optionValue: 'Johor' })).toThrow(RangeError);
  });

  it('refuses a negative or fractional form index', () => {
    expect(() => elementIdFor({ formIndex: -1, control: 'text', name: 'nama' })).toThrow(RangeError);
    expect(() => elementIdFor({ formIndex: 0.5, control: 'text', name: 'nama' })).toThrow(RangeError);
  });

  it('throws an encoding error for a lone surrogate instead of producing an id', () => {
    expect(() => elementIdFor({ formIndex: 0, control: 'text', name: 'a\uD800' })).toThrow(ElementIdEncodingError);
    expect(() => radioOptionIdFor(0, 'jantina', '\uDC00')).toThrow(ElementIdEncodingError);
  });
});

describe('parseElementId', () => {
  it.each([
    ['empty string', ''],
    ['no form prefix', '0:text:nama'],
    ['leading zero in form index', 'f01:text:nama'],
    ['unknown control type', 'f0:button:nama'],
    ['too few parts', 'f0:text'],
    ['too many parts', 'f0:radio:jantina:L:x'],
    ['option part on a text control', 'f0:text:nama:x'],
    ['non-canonical percent encoding', 'f0:text:%41'],
    ['malformed percent encoding', 'f0:text:%E0'],
    ['raw character that elementIdFor would encode', 'f0:text:a b'],
  ])('rejects %s', (_label, id) => {
    expect(parseElementId(id)).toBeNull();
  });

  it('is the exact inverse of elementIdFor (property)', () => {
    fc.assert(
      fc.property(keyArb, (key) => {
        const id = elementIdFor(key);
        expect(parseElementId(id)).toEqual(key);
      }),
      { numRuns: 300 },
    );
  });

  it('gives distinct ids to distinct keys (property)', () => {
    fc.assert(
      fc.property(keyArb, keyArb, (a, b) => {
        fc.pre(JSON.stringify(a) !== JSON.stringify(b));
        expect(elementIdFor(a)).not.toBe(elementIdFor(b));
      }),
      { numRuns: 300 },
    );
  });

  it('accepts only ids that elementIdFor produces (property)', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 30 }), (id) => {
        const key = parseElementId(id);
        if (key !== null) expect(elementIdFor(key)).toBe(id);
      }),
      { numRuns: 300 },
    );
  });
});
