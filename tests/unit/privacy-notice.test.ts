/**
 * tests/unit/privacy-notice.test.ts
 *
 * Requirement 9.5: the same privacy notice appears on the upload screen and on
 * the review screen, and it describes what the code really sends.
 * Validates: Requirements 9.5, 11.2
 */

import { describe, it, expect } from 'vitest';
import { LANGUAGE_REGISTRY, getOwnLocaleStrings } from '../../src/packs/language/registry.js';

/** Requirement 9.5, word for word. */
const REQUIRED_NOTICE =
  'Your answers stay in your browser. The form field labels, tooltips, and nearby text from the PDF — and any description answer you choose to translate — are sent to the AI service for processing. Answers are not stored.';

describe('privacy notice', () => {
  it('English uses the exact wording of requirement 9.5 on both screens', () => {
    const en = getOwnLocaleStrings('en')!;
    expect(en['upload.privacyNotice']).toBe(REQUIRED_NOTICE);
    expect(en['review.privacyNotice']).toBe(REQUIRED_NOTICE);
  });

  it.each(LANGUAGE_REGISTRY.map((l) => l.tag))('%s shows the same notice on upload and review, in its own language', (tag) => {
    const strings = getOwnLocaleStrings(tag)!;
    const upload = strings['upload.privacyNotice'];
    expect(upload).toBeTruthy();
    expect(strings['review.privacyNotice']).toBe(upload);
    if (tag !== 'en') expect(upload).not.toBe(REQUIRED_NOTICE);
  });

  it('the English notice names every kind of data the Worker receives (privacy steering list)', () => {
    const notice = getOwnLocaleStrings('en')!['upload.privacyNotice']!.toLowerCase();
    for (const part of ['labels', 'tooltips', 'nearby text', 'description answer', 'translate', 'not stored']) {
      expect(notice).toContain(part);
    }
  });
});
