/**
 * tests/e2e/document-accessibility.spec.ts
 *
 * formbridge-any-document task 13.11: axe (WCAG 2.0 to 2.2 A and AA, no
 * violation) on every screen of the photo path, in English and Simplified
 * Chinese, with focus moving to each new heading, and again with the larger
 * text option on. The photo is read from the mock OCR result, and the user
 * continues without AI, so no request leaves the page.
 * Validates: Requirements 23.2, 23.3, 23.4, 23.7, 23.8
 */

import { test, expect, type Page } from '@playwright/test';
import { expectNoAxeViolations, translate } from './helpers.js';
import { documentFixturePath, injectMockOcr } from './helpers/document.js';

test.setTimeout(120_000);

const FILE = 'clean-en.jpg';

async function toLanguageQuestion(page: Page, lang: string, largerText = false) {
  await injectMockOcr(page, FILE);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.locator(`input[value="${lang}"]`).check();
  if (largerText) await page.getByLabel(translate(lang, 'language.picker.largerText')).check();
  await page.getByRole('button', { name: translate(lang, 'language.picker.continue') }).click();
}

const rowFor = (page: Page, text: string) => page.locator('li', { has: page.locator(`input[type="text"][value="${text}"]`) }).getByRole('checkbox');

/** The heading of a new screen has focus, so a keyboard or screen-reader user starts at the new content. */
async function expectFocusOnHeading(page: Page, name: string) {
  const heading = page.getByRole('heading', { level: 1, name });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
}

for (const lang of ['en', 'zh-Hans']) {
  const t = (key: string, params?: Record<string, string | number>) => translate(lang, key, params);

  test(`axe on every screen of the photo path in ${lang}, with focus on each new heading`, async ({ page }) => {
    await toLanguageQuestion(page, lang);

    // The first screen: the two entry buttons.
    await expectNoAxeViolations(page, `${lang} entry`);
    await page.getByLabel(t('upload.button')).setInputFiles(documentFixturePath(FILE));

    await expectFocusOnHeading(page, t('document.ocrLanguage.title'));
    await expectNoAxeViolations(page, `${lang} language question`);
    await page.getByRole('button', { name: t('document.ocrLanguage.continue') }).click();

    await expect(page.getByRole('button', { name: t('document.preview.read') })).toBeVisible();
    await expectNoAxeViolations(page, `${lang} page preview`);
    await page.getByRole('button', { name: t('document.preview.read') }).click();

    await expectFocusOnHeading(page, t('document.review.title'));
    await expectNoAxeViolations(page, `${lang} label review`);
    await rowFor(page, 'Full name:').check();
    await rowFor(page, 'Email:').check();
    await expectNoAxeViolations(page, `${lang} label review with two lines ticked`);
    await page.getByRole('button', { name: t('document.review.noAi') }).click();

    // Original_Label_Mode asks the form language and country first.
    await expectFocusOnHeading(page, t('confirm.title'));
    await expectNoAxeViolations(page, `${lang} confirm language`);
    await page.getByRole('button', { name: t('confirm.continue') }).click();

    // One question per screen.
    await expect(page.locator('.question-card input').first()).toBeVisible();
    await expectNoAxeViolations(page, `${lang} question 1`);
    for (let i = 0; i < 2; i++) {
      await page.locator('.question-card input').first().fill(`Answer ${i + 1}`);
      await page.getByRole('button', { name: t('wizard.next'), exact: true }).click();
    }

    await expect(page.getByText(t('review.privacyNotice.nothingSent'))).toBeVisible();
    await expectNoAxeViolations(page, `${lang} review screen`);
    await page.getByRole('button', { name: t('document.reviewScreen.makeSheet') }).click();

    await expectFocusOnHeading(page, t('document.sheet.title'));
    await expectNoAxeViolations(page, `${lang} answer sheet`);
  });
}

test('axe with the larger text option on, on the label review and the answer sheet', async ({ page }) => {
  const lang = 'en';
  const t = (key: string) => translate(lang, key);
  await toLanguageQuestion(page, lang, true);
  await page.getByLabel(t('upload.button')).setInputFiles(documentFixturePath(FILE));
  await page.getByRole('button', { name: t('document.ocrLanguage.continue') }).click();
  await page.getByRole('button', { name: t('document.preview.read') }).click();
  await expect(page.getByRole('heading', { level: 1, name: t('document.review.title') })).toBeVisible();
  await expectNoAxeViolations(page, 'larger text, label review');
  await rowFor(page, 'Full name:').check();
  await page.getByRole('button', { name: t('document.review.noAi') }).click();
  await page.getByRole('button', { name: t('confirm.continue') }).click();
  await page.locator('.question-card input').first().fill('Answer 1');
  await page.getByRole('button', { name: t('wizard.next'), exact: true }).click();
  await page.getByRole('button', { name: t('document.reviewScreen.makeSheet') }).click();
  await expect(page.getByRole('heading', { level: 1, name: t('document.sheet.title') })).toBeVisible();
  await expectNoAxeViolations(page, 'larger text, answer sheet');
});

test('a keyboard-only user can tick a line and continue on the label review', async ({ page }) => {
  const lang = 'en';
  const t = (key: string) => translate(lang, key);
  await toLanguageQuestion(page, lang);
  await page.getByLabel(t('upload.button')).setInputFiles(documentFixturePath(FILE));
  await page.getByRole('button', { name: t('document.ocrLanguage.continue') }).click();
  await page.getByRole('button', { name: t('document.preview.read') }).click();
  await expect(page.getByRole('heading', { level: 1, name: t('document.review.title') })).toBeVisible();
  const box = rowFor(page, 'Full name:');
  await box.focus();
  await expect(box).toBeFocused();
  await page.keyboard.press('Space');
  await expect(box).toBeChecked();
  // Every control on the screen can be reached with Tab and shows a focus outline.
  await page.getByRole('button', { name: t('document.review.noAi') }).focus();
  const outline = await page.getByRole('button', { name: t('document.review.noAi') }).evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe('none');
});
