/**
 * tests/unit/language-match.test.ts
 *
 * Task 27.1: the picker pre-selects a registry language from navigator.languages.
 * Validates: Requirement 2-L.8
 */

import { describe, it, expect } from 'vitest';
import { matchLanguage, matchOne } from '../../src/frontend/language-match.js';

describe('matchOne', () => {
  it.each([
    ['zh-CN', 'zh-Hans'],
    ['zh-SG', 'zh-Hans'],
    ['zh', 'zh-Hans'],
    ['zh-TW', 'zh-Hant'],
    ['zh-HK', 'zh-Hant'],
    ['zh-MO', 'zh-Hant'],
    ['zh-Hant-MY', 'zh-Hant'],
    ['zh-Hans-HK', 'zh-Hans'],
    ['ms-MY', 'ms'],
    ['ms', 'ms'],
    ['zsm', 'ms'],
    ['ta-IN', 'ta'],
    ['ta_MY', 'ta'],
    ['es-US', 'es'],
    ['es-419', 'es'],
    ['en-GB', 'en'],
    ['EN-us', 'en'],
    ['id-ID', 'id'],
  ])('%s -> %s', (tag, expected) => {
    expect(matchOne(tag)).toBe(expected);
  });

  it.each(['fr-FR', 'de', '', '  ', 'x'])('%s has no registry language', (tag) => {
    expect(matchOne(tag)).toBeUndefined();
  });
});

describe('matchLanguage', () => {
  it('takes the first supported language in preference order', () => {
    expect(matchLanguage(['fr-FR', 'zh-TW', 'en'])).toBe('zh-Hant');
  });

  it('falls back to English when nothing matches or the list is empty', () => {
    expect(matchLanguage(['fr-FR', 'de-DE'])).toBe('en');
    expect(matchLanguage([])).toBe('en');
  });
});
