/**
 * tests/unit/accessforge-notice.test.ts
 *
 * accessforge-skeleton tasks 1.1 and 1.2 (decision A): the AccessForge data
 * notice exists in every core locale, the Slice 2 sentence is not shipped yet,
 * experimental languages fall back to English, and the privacy steering file
 * carries the new rule.
 * Validates: Requirements 13.1, 13.7, 13.9
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { getCoreLanguages, getOwnLocaleStrings, LANGUAGE_REGISTRY, translate } from '../../src/packs/language/registry.js';

const SLICE_1 = ['title', 'pageText', 'answersStay', 'legacyOnly', 'acknowledge'].map((k) => `accessforge.notice.${k}`);
const CORE = getCoreLanguages().map((l) => l.tag);

describe('AccessForge data notice keys', () => {
  it.each(CORE)('%s has every Slice 1 key, non-empty, in its own file', (tag) => {
    const own = getOwnLocaleStrings(tag)!;
    for (const key of SLICE_1) expect(own[key]?.trim(), `${tag} ${key}`).toBeTruthy();
  });

  it('non-English core locales carry a translation, not the English text', () => {
    const en = getOwnLocaleStrings('en')!;
    for (const tag of CORE.filter((t) => t !== 'en')) {
      for (const key of SLICE_1) expect(getOwnLocaleStrings(tag)![key], `${tag} ${key}`).not.toBe(en[key]);
    }
  });

  it('the Slice 2 re-translation sentence is not shipped in any locale yet (13.7)', () => {
    for (const entry of LANGUAGE_REGISTRY) {
      expect(getOwnLocaleStrings(entry.tag)!['accessforge.notice.retranslate'], entry.tag).toBeUndefined();
    }
  });

  it('a key missing from an experimental locale falls back to English', () => {
    const experimental = LANGUAGE_REGISTRY.filter((e) => e.status === 'experimental').map((e) => e.tag);
    expect(experimental.length).toBeGreaterThan(0);
    for (const tag of experimental) {
      for (const key of SLICE_1) {
        const own = getOwnLocaleStrings(tag)![key];
        expect(translate(tag, key)).toBe(own ?? translate('en', key));
      }
    }
  });

  it('the English notice says only what Slice 1 does', () => {
    expect(SLICE_1.map((k) => translate('en', k))).toEqual([
      'What leaves your browser',
      'Labels and nearby text from the old page go to the AI service.',
      'Your answers stay in this browser until you confirm.',
      "When you confirm, your answers go only to the demonstration portal's own form handler.",
      'I understand, continue',
    ]);
  });

  it('keeps the FormBridge notice unchanged', () => {
    expect(translate('en', 'upload.privacyNotice')).toBe(translate('en', 'review.privacyNotice'));
    expect(translate('en', 'upload.privacyNotice')).toContain('Your answers stay in your browser.');
  });
});

describe('privacy steering (decision A)', () => {
  const steering = readFileSync('.kiro/steering/privacy.md', 'utf8');

  it('allows the Page_Model and says answers go only to the Legacy_Handler, never to the AI service', () => {
    expect(steering).toContain('The Page_Model of the legacy page');
    expect(steering).toContain('AccessForge answers never go to the AI service');
    expect(steering).toContain('only to the Legacy_Handler');
    expect(steering).toContain('never stores or logs them');
  });

  it('names the AccessForge notice keys', () => {
    expect(steering).toContain('accessforge.notice.*');
  });
});
