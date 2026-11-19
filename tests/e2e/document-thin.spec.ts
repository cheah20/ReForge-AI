/**
 * tests/e2e/document-thin.spec.ts
 *
 * The thin Document_Path line (formbridge-any-document, Tier A): an English
 * photo is read with the mock OCR result, the user ticks two lines (nothing is
 * ticked at the start), continues without AI, answers, reviews and gets the
 * answer sheet. No request leaves for the AI service on this path.
 * Validates: Requirements 12.3, 12.8, 19.10
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectNoAxeViolations, translate } from './helpers.js';

test.setTimeout(90_000);
const t = (key: string, params?: Record<string, string | number>) => translate('en', key, params);

const expected = JSON.parse(readFileSync(join('fixtures', 'documents', 'expected.json'), 'utf8')) as {
  fixtures: Array<{ file: string; pages?: Array<{ mock: unknown }> }>;
};
const mock = expected.fixtures.find((f) => f.file === 'clean-en.jpg')!.pages![0]!.mock;

test('a photo goes through the label check to the answer sheet without sending anything', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/')) requests.push(r.url());
  });
  await page.addInitScript((m) => {
    (globalThis as Record<string, unknown>)['__REFORGE_TEST_OCR__'] = m;
  }, mock);

  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.locator('input[value="en"]').check();
  await page.getByRole('button', { name: t('language.picker.continue') }).click();
  await page.getByLabel(t('upload.button')).setInputFiles(join('fixtures', 'documents', 'clean-en.jpg'));

  await expect(page.getByRole('heading', { level: 1, name: t('document.ocrLanguage.title') })).toBeVisible();
  await expectNoAxeViolations(page, 'document language question');
  await page.getByRole('button', { name: t('document.ocrLanguage.continue') }).click();

  await expect(page.getByRole('button', { name: t('document.preview.read') })).toBeVisible();
  await expectNoAxeViolations(page, 'document preview');
  await page.getByRole('button', { name: t('document.preview.read') }).click();

  await expect(page.getByRole('heading', { level: 1, name: t('document.review.title') })).toBeVisible();
  // Nothing is ticked until the user ticks it.
  await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(0);
  await page.getByLabel(t('document.review.notSelected')).first().waitFor();
  await expect(page.getByText(t('document.review.selectAtLeastOne'))).toHaveCount(0);
  await page.getByRole('button', { name: t('document.review.noAi') }).click();
  await expect(page.getByText(t('document.review.selectAtLeastOne'))).toBeVisible();

  const rowFor = (text: string) => page.locator('li', { has: page.locator(`input[type="text"][value="${text}"]`) }).getByRole('checkbox');
  await rowFor('Full name:').check();
  await rowFor('Email:').check();
  await expect(page.getByRole('heading', { name: t('document.review.group.questions') })).toBeVisible();
  await expectNoAxeViolations(page, 'label review');
  await page.getByRole('button', { name: t('document.review.noAi') }).click();

  // Original_Label_Mode asks the form language and country first.
  await page.getByRole('button', { name: t('confirm.continue') }).click();

  for (let i = 0; i < 2; i++) {
    await page.locator('.question-card input').first().fill(`Answer ${i + 1}`);
    await page.getByRole('button', { name: t('wizard.next'), exact: true }).click();
  }

  await expect(page.getByText(t('review.privacyNotice.nothingSent'))).toBeVisible();
  await page.getByRole('button', { name: t('document.reviewScreen.makeSheet') }).click();
  await expect(page.getByRole('heading', { level: 1, name: t('document.sheet.title') })).toBeVisible();
  await expect(page.getByText('Answer 1')).toHaveCount(2);
  await expectNoAxeViolations(page, 'answer sheet');
  expect(requests).toEqual([]);
});
