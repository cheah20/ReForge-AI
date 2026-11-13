/**
 * tests/unit/document-locales.test.ts
 *
 * Locale keys added by the combined shared-file task (formbridge-any-document
 * task 2.4): completeness in every core language, plural forms, plain words on
 * the Entry_Screen, honest wording, and the approved Document_Path notice.
 * Validates: Requirements 1.2, 12.15, 23.10, 24.5, 28.2
 */

import { describe, it, expect } from 'vitest';
import { getCoreLanguages, getOwnLocaleStrings } from '../../src/packs/language/registry.js';

const en = getOwnLocaleStrings('en')!;
const CORE = getCoreLanguages().map((l) => l.tag);

/** The approved Privacy_Notice sentence (design Q10), word for word. */
const DOCUMENT_NOTICE =
  'Your file, your photos and your answers stay on this device unless you choose Translate, Share, Print or Download. Share hands the sheet to the app you pick. The words you keep on the label check are sent to the AI service to write the questions. If you choose to translate a description, that answer is sent too.';

/** The fillable-PDF notice of formbridge-pdf Requirement 9.5 stays as it was: that path still sends field labels. */
const FILLABLE_NOTICE =
  'Your answers stay in your browser. The form field labels, tooltips, and nearby text from the PDF — and any description answer you choose to translate — are sent to the AI service for processing. Answers are not stored.';

const PLURAL_BASES = ['document.review.count', 'document.review.send'];
const isNewKey = (k: string) =>
  k.startsWith('entry.') || k.startsWith('document.') || k === 'review.privacyNotice.nothingSent' || (k.startsWith('accessforge.') && !k.startsWith('accessforge.notice.'));
const NEW_KEYS = Object.keys(en).filter(isNewKey);

describe('new locale keys (task 2.3)', () => {
  it('adds the keys the design names', () => {
    for (const key of [
      'entry.photo',
      'entry.handwriting',
      'entry.error.refused',
      'entry.error.tooLarge',
      'document.privacyNotice',
      'document.review.privacyNotice',
      'review.privacyNotice.nothingSent',
      'document.review.title',
      'document.review.instruction',
      'document.review.noAi',
      'document.review.valueNotSent',
      'document.review.pageNotChecked',
      'document.sheet.shareHint',
      'document.sheet.pdfNotAvailable',
      'document.ocrLanguage.notYet',
      'document.ocrLanguage.malayNotYet',
      'document.originalMode.notice',
      'document.help.trustedPerson',
      'accessforge.mode.cached',
    ]) {
      expect(en[key], key).toBeTruthy();
    }
    expect(en['document.review.instruction']).toBe('Remove any names, addresses or other personal details.');
    expect(en['document.sheet.shareHint']).toBe('Share hands the sheet to the app you pick.');
    expect(en['document.description']).toContain('helps you prepare your answers');
  });

  it.each(CORE)('%s holds every new key with visible text', (tag) => {
    const strings = getOwnLocaleStrings(tag)!;
    for (const key of NEW_KEYS) {
      if (PLURAL_BASES.some((b) => key.startsWith(`${b}.`))) continue;
      expect(strings[key]?.trim(), `${tag} ${key}`).toBeTruthy();
    }
  });

  it.each(CORE)('%s has a plural form for every plural category of its language', (tag) => {
    const strings = getOwnLocaleStrings(tag)!;
    const categories = new Intl.PluralRules(tag).resolvedOptions().pluralCategories;
    expect(categories.length).toBeGreaterThan(0);
    for (const base of PLURAL_BASES) {
      for (const category of categories) {
        const text = strings[`${base}.${category}`];
        expect(text, `${tag} ${base}.${category}`).toBeTruthy();
        expect(text).toContain('{count}');
      }
    }
  });

  it('the English send button names what is sent, with the count', () => {
    expect(en['document.review.send.one']).toBe('Send this {count} label to write the questions');
    expect(en['document.review.send.other']).toBe('Send these {count} labels to write the questions');
  });
});

describe('plain words and honest claims (Requirements 1.2, 28.2)', () => {
  it('no English Entry_Screen string uses a technical term', () => {
    const entryKeys = [...Object.keys(en).filter((k) => k.startsWith('entry.')), 'upload.title', 'upload.button'];
    expect(entryKeys.length).toBeGreaterThan(5);
    for (const key of entryKeys) {
      for (const term of ['upload', 'pdf', 'ocr', 'file format', 'mime']) {
        expect(en[key]!.toLowerCase(), `${key} uses "${term}"`).not.toContain(term);
      }
    }
  });

  it('no English Document_Path string overclaims', () => {
    for (const key of Object.keys(en).filter((k) => k.startsWith('document.') || k.startsWith('entry.'))) {
      for (const phrase of ['accepts anything', 'any document', 'accurate', 'compliant']) {
        expect(en[key]!.toLowerCase(), `${key} says "${phrase}"`).not.toContain(phrase);
      }
    }
  });
});

describe('privacy notices (Requirement 24.5)', () => {
  it('the Document_Path notice in English is the approved sentence on both screens', () => {
    expect(en['document.privacyNotice']).toBe(DOCUMENT_NOTICE);
    expect(en['document.review.privacyNotice']).toBe(DOCUMENT_NOTICE);
    for (const word of ['Translate', 'Share', 'Print', 'Download']) expect(en['document.privacyNotice']).toContain(word);
    expect(en['document.privacyNotice']).toContain('Share hands the sheet to the app you pick.');
  });

  it('the fillable-PDF notice is unchanged, because that path still sends field labels', () => {
    expect(en['upload.privacyNotice']).toBe(FILLABLE_NOTICE);
    expect(en['review.privacyNotice']).toBe(FILLABLE_NOTICE);
  });

  it.each(CORE.filter((t) => t !== 'en'))('%s translates the Document_Path notice, the same on both screens', (tag) => {
    const strings = getOwnLocaleStrings(tag)!;
    expect(strings['document.privacyNotice']).toBeTruthy();
    expect(strings['document.privacyNotice']).not.toBe(DOCUMENT_NOTICE);
    expect(strings['document.review.privacyNotice']).toBe(strings['document.privacyNotice']);
    expect(strings['review.privacyNotice.nothingSent']).not.toBe(en['review.privacyNotice.nothingSent']);
  });
});
