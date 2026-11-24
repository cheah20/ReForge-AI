/**
 * tests/e2e/dec1-acceptance.spec.ts
 *
 * Task 39 (formbridge-pdf): the second acceptance scenario with the mock AI
 * provider. Spanish interface -> US community clinic form -> disclosure ->
 * English and United States confirmed when asked -> questions (a wrong ZIP code
 * rejected, then a correct one) -> review -> confirm -> download, then the
 * downloaded PDF is read back with pdf-lib and checked as a reader sees it.
 * (a) high confidence: the confirmation screen is skipped (the mock reply is
 *     intercepted and its confidences raised to 0.9);
 * (b) low confidence (the mock's own 0.65): the user confirms English and the
 *     United States.
 * axe runs on the screens of the path.
 * Validates: Requirements 15.3, 13.11
 */

import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { answerWizard, expectNoAxeViolations, fixture, translate, type Answer } from './helpers.js';
import { expectTextInsideFields, screenshotPdfPages } from './pdf-check.js';

test.setTimeout(120_000);

const LANG = 'es';
const t = (key: string, params?: Record<string, string | number>) => translate(LANG, key, params);

/** Synthetic answers, typed the way a Spanish speaker filling a US form would. */
const ANSWERS: Record<string, Answer> = {
  'patient.fullName': { kind: 'type', value: 'MARIA TEST LOPEZ' },
  'patient.birthDate': { kind: 'type', value: '01/01/1990' },
  Text1: { kind: 'type', value: '078-05-1120' },
  'contact.phone': { kind: 'type', value: '(415) 555-0132' },
  'contact.email': { kind: 'type', value: 'maria.test@example.invalid' },
  'contact.address': { kind: 'type', value: '123 Test Street, Apt 4' },
  'contact.city': { kind: 'type', value: 'San Francisco' },
  'contact.state': { kind: 'choose', label: 'California' },
  Text7: { kind: 'type', value: '94110' },
  'visit.date': { kind: 'type', value: '12/01/2026' },
  'visit.reason': { kind: 'type', value: 'Tengo tos desde hace dos dias.' },
  'consent.reminders': { kind: 'choose', label: t('wizard.checkbox.checked') },
};

/** Every text value the path writes, as it must appear on the page (field rectangle check). */
const DRAWN_TEXT: Record<string, string> = {
  'patient.fullName': 'MARIA TEST LOPEZ',
  'patient.birthDate': '01/01/1990',
  'contact.email': 'maria.test@example.invalid',
  'contact.address': '123 Test Street, Apt 4',
  'contact.city': 'San Francisco',
  Text7: '94110',
  'visit.date': '12/01/2026',
  'visit.reason': 'Tengo tos desde hace dos dias.',
};

async function startToUpload(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expectNoAxeViolations(page, 'language picker');
  await page.locator(`input[value="${LANG}"]`).check();
  await expect(page.locator('html')).toHaveAttribute('lang', LANG);
  await page.getByRole('button', { name: t('language.picker.continue') }).click();

  await expect(page.getByRole('heading', { level: 1, name: t('upload.title') })).toBeFocused();
  await expectNoAxeViolations(page, 'upload');
  await page.getByLabel(t('upload.button')).setInputFiles(fixture('us-community-clinic.pdf'));
  await expect(page.getByText(t('upload.found', { count: 14, pages: 1 }))).toBeVisible();
  await expectNoAxeViolations(page, 'upload with fields found');
  await page.getByRole('button', { name: t('upload.acknowledge') }).click();
}

async function wizardToDownload(page: Page) {
  await expect(page.getByText(t('analysis.demoMode'))).toBeVisible();
  await expect(page.getByText(t('wizard.step', { current: 1, total: 13 }))).toBeVisible();

  const seen = await answerWizard(page, {
    language: LANG,
    answers: ANSWERS,
    dateFormat: 'MM/DD/YYYY',
    axeOn: new Set(['patient.fullName', 'contact.state', 'visit.date:format', 'visit.reason']),
    onStep: async (fieldId) => {
      if (fieldId === 'Text7') {
        // A ZIP code with four digits is refused in Spanish and the input is marked invalid; a correct one goes on.
        const input = page.locator('.question-card input');
        await input.fill('9411');
        await page.getByRole('button', { name: t('wizard.next'), exact: true }).click();
        await expect(page.getByText(t('validation.zip.invalid'))).toBeVisible();
        await expect(input).toHaveAttribute('aria-invalid', 'true');
        await expectNoAxeViolations(page, 'ZIP error shown');
        await input.fill('94110');
        await page.getByRole('button', { name: t('wizard.next'), exact: true }).click();
        return true;
      }
      if (fieldId === 'visit.contactMethod') {
        // The first option, whatever its label: the form's own export value is read back below.
        await page.locator('.question-card').getByRole('radio').first().check();
        await page.getByRole('button', { name: t('wizard.next'), exact: true }).click();
        return true;
      }
      return false;
    },
  });
  // The signature is not asked.
  expect(seen).not.toContain('consent.signature');
  expect(seen).toHaveLength(13);

  await expect(page.getByRole('heading', { level: 1, name: t('review.title') })).toBeVisible();
  await expect(page.getByText(t('review.privacyNotice'))).toBeVisible();
  await expectNoAxeViolations(page, 'review');

  // Nothing is downloaded before the user confirms.
  await page.getByRole('button', { name: t('review.confirm') }).click();
  const link = page.getByRole('link', { name: t('download.button') });
  await expect(link).toBeVisible();
  await expectNoAxeViolations(page, 'download');

  const downloadEvent = page.waitForEvent('download');
  await link.click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('us-community-clinic-filled.pdf');
  const bytes = new Uint8Array(await readFile((await download.path())!));

  // Task 39.2: the drawn text sits inside each field, and the pages are rendered and kept as screenshots.
  const checked = await expectTextInsideFields(bytes, DRAWN_TEXT);
  expect(checked).toBe(Object.values(DRAWN_TEXT).join('\n').split('\n').length);
  const shots = await screenshotPdfPages(page, bytes, test.info().outputPath('filled'));
  for (const file of shots) await test.info().attach(file.split(/[\\/]/).pop()!, { path: file, contentType: 'image/png' });
  expect(shots).toHaveLength(1);

  return PDFDocument.load(bytes);
}

function expectFilled(pdf: PDFDocument) {
  const form = pdf.getForm();
  const text = (n: string) => form.getTextField(n).getText();
  expect(text('patient.fullName')).toBe('MARIA TEST LOPEZ');
  expect(text('patient.birthDate')).toBe('01/01/1990');
  expect(text('contact.email')).toBe('maria.test@example.invalid');
  expect(text('contact.address')).toBe('123 Test Street, Apt 4');
  expect(text('contact.city')).toBe('San Francisco');
  expect(text('Text7')).toBe('94110');
  expect(text('visit.date')).toBe('12/01/2026');
  expect(text('visit.reason')).toBe('Tengo tos desde hace dos dias.');
  // A US phone and a Social Security number are written as the US rules normalise them.
  expect(text('contact.phone')).toBe('(415) 555-0132');
  expect(text('Text1')).toBe('078-05-1120');
  expect(form.getDropdown('contact.state').getSelected()).toEqual(['CA']);
  expect(form.getRadioGroup('visit.contactMethod').getSelected()).toBe('P');
  expect(form.getCheckBox('consent.reminders').isChecked()).toBe(true);
}

test('(a) high confidence: the confirmation screen is skipped', async ({ page }) => {
  await page.route('**/api/forms/analyze', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, formLanguageConfidence: 0.9, formCountryConfidence: 0.9 } });
  });
  await startToUpload(page);
  await expect(page.getByRole('heading', { level: 1, name: t('confirm.title') })).toHaveCount(0);
  expectFilled(await wizardToDownload(page));
});

test('(b) low confidence: the user confirms English and the United States', async ({ page }) => {
  await startToUpload(page);
  await expect(page.getByRole('heading', { level: 1, name: t('confirm.title') })).toBeVisible();
  await expectNoAxeViolations(page, 'confirm form language');
  await page.getByLabel(t('confirm.languageLabel')).selectOption('en');
  await page.getByLabel(t('confirm.countryLabel')).selectOption('US');
  await page.getByRole('button', { name: t('confirm.continue') }).click();
  expectFilled(await wizardToDownload(page));
});
