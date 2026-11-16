/**
 * tests/unit/accessforge-locales.test.ts
 *
 * accessforge-skeleton task 15.2: AccessForge interface strings. Every
 * `accessforge.*` key exists with visible text in `en` and `zh-Hans`; every
 * key the agent loop can show (do-it-yourself reasons, statuses, the consent
 * message) exists in English; the Slice 1 data notice keys exist in every
 * core locale; experimental languages fall back to English.
 * Validates: Requirements 9.4, 9.13, 13.9
 */

import { describe, it, expect } from 'vitest';
import { getCoreLanguages, getLocaleStrings, getOwnLocaleStrings } from '../../src/packs/language/registry.js';
import { CONSENT_REQUIRED_KEY } from '../../src/lib/accessforge/transformations.js';
import type { DiyReason } from '../../src/lib/accessforge/agent-machine.js';

const en = getOwnLocaleStrings('en')!;
const AF_KEYS = Object.keys(en).filter((k) => k.startsWith('accessforge.'));
const NOTICE_KEYS = ['title', 'pageText', 'answersStay', 'legacyOnly', 'acknowledge'].map((k) => `accessforge.notice.${k}`);

/** Every reason the reducer can give; the type makes a new reason a compile error until it is listed. */
const DIY_REASONS: Record<DiyReason, true> = { NO_PLAN: true, DUPLICATE_ID: true, UNSUPPORTED: true, NOT_FOUND: true, AMBIGUOUS: true, REJECTED: true };

describe('AccessForge locale strings', () => {
  it('has a real set of keys', () => {
    expect(AF_KEYS.length).toBeGreaterThan(70);
  });

  it.each(['en', 'zh-Hans'])('%s holds every accessforge key with visible text', (tag) => {
    const strings = getOwnLocaleStrings(tag)!;
    for (const key of AF_KEYS) expect(strings[key]?.trim(), `${tag} ${key}`).toBeTruthy();
  });

  it('holds every key the agent loop and transformations can show', () => {
    const needed = [
      CONSENT_REQUIRED_KEY,
      ...Object.keys(DIY_REASONS).map((r) => `accessforge.diy.reason.${r}`),
      ...['filled', 'skipped', 'diy', 'mismatch'].map((s) => `accessforge.status.${s}`),
      ...['pageNotSupported', 'pageChanged', 'formTarget', 'cannotRead', 'analysisFailed', 'mismatch', 'legacyRejected'].map((e) => `accessforge.error.${e}`),
      ...['live', 'mock', 'cached'].map((m) => `accessforge.mode.${m}`),
      'accessforge.language.locked',
    ];
    for (const key of needed) expect(en[key]?.trim(), key).toBeTruthy();
  });

  it('says in the cached notice that live AI was unavailable, without claiming no live call was made', () => {
    expect(en['accessforge.mode.cached']).toMatch(/unavailable/i);
    expect(en['accessforge.mode.cached']).not.toMatch(/no (live )?(AI|call)/i);
  });

  it.each(getCoreLanguages().map((l) => l.tag))('%s holds the Slice 1 data notice keys', (tag) => {
    const strings = getOwnLocaleStrings(tag)!;
    for (const key of NOTICE_KEYS) expect(strings[key]?.trim(), `${tag} ${key}`).toBeTruthy();
  });

  it('falls back to English for an experimental language without the key', () => {
    const own = getOwnLocaleStrings('id')!;
    expect(own['accessforge.mode.cached']).toBeUndefined();
    expect(getLocaleStrings('id')['accessforge.mode.cached']).toBe(en['accessforge.mode.cached']);
    expect(getLocaleStrings('id')['accessforge.notice.title']).toBe(own['accessforge.notice.title']);
  });
});
