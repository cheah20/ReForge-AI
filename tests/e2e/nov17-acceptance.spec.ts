/**
 * tests/e2e/nov17-acceptance.spec.ts
 *
 * Task 36: the Nov 17 acceptance scenario with the mock AI provider.
 * Simplified Chinese interface -> clinic form -> notice -> questions (a wrong
 * IC rejected, then a correct one) -> review -> confirm -> download, then the
 * downloaded PDF is read back with pdf-lib.
 * (a) high confidence: the confirmation screen is skipped (the mock reply is
 *     intercepted and its confidences raised to 0.9);
 * (b) low confidence (the mock's own 0.65): the user confirms Malay and Malaysia.
 * axe runs on every screen of the path (task 36.3).
 * Validates: Requirements 15.2, 13.11
 */

import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { answerWizard, expectNoAxeViolations, fixture, translate, type Answer } from './helpers.js';
import { expectTextInsideFields, screenshotPdfPages } from './pdf-check.js';

// The whole flow with an axe run on every screen takes longer than the 30 s default.
test.setTimeout(120_000);

const LANG = 'zh-Hans';
const t = (key: string, params?: Record<string, string | number>) => translate(LANG, key, params);

/** Fixture spec section 1: synthetic answers, typed the way a user would. */
const ANSWERS: Record<string, Answer> = {
  'patient.fullName': { kind: 'type', value: 'LIN MEI TEST' },
  'patient.birthDate': { kind: 'type', value: '01/01/1990' },
  'patient.gender': { kind: 'choose', label: 'Perempuan' },
  Text7: { kind: 'type', value: 'REF-A' },
  'contact.mobile': { kind: 'type', value: '0112345 6789' },
  'contact.homePhone': { kind: 'type', value: '03-2345 6789' },
  Text3: { kind: 'type', value: 'lin.mei@example.invalid' },
  'contact.address': { kind: 'type', value: 'Unit Ujian 8, Jalan Rekaan Ungu' },
  'contact.postcode': { kind: 'type', value: '43000' },
  'contact.city': { kind: 'type', value: 'Bandar Rekaan' },
  'contact.state': { kind: 'choose', label: 'Selangor' },
  'visit.date': { kind: 'type', value: '17/11/2026' },
  'visit.firstVisit': { kind: 'choose', label: t('wizard.checkbox.checked') },
  'medical.allergyFlag': { kind: 'choose', label: t('wizard.checkbox.unchecked') },
  'medical.description': { kind: 'type', value: 'Saya batuk selama dua hari.' },
  'emergency.name': { kind: 'type', value: 'LIN HAO TEST' },
  'emergency.phone': { kind: 'type', value: '012-345 6789' },
  'consent.contact': { kind: 'skip' },
  'visit.shortCode': { kind: 'type', value: 'A123' },
};

async function startToUpload(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expectNoAxeViolations(page, 'language picker');
  await page.locator(`input[value="${LANG}"]`).check();
  await expect(page.locator('html')).toHaveAttribute('lang', LANG);
  await page.getByRole('button', { name: t('language.picker.continue') }).click();

  await expect(page.getByRole('heading', { level: 1, name: t('upload.title') })).toBeFocused();
  await expect(page.getByText(t('upload.privacyNotice'))).toBeVisible();
  await expectNoAxeViolations(page, 'upload');
  await page.getByLabel(t('upload.button')).setInputFiles(fixture('clinic-registration.pdf'));
  await expect(page.getByText(t('upload.found', { count: 22, pages: 1 }))).toBeVisible();
  await expectNoAxeViolations(page, 'upload with fields found');
  await page.getByRole('button', { name: t('upload.acknowledge') }).click();
}

async function wizardToDownload(page: Page) {
  await expect(page.getByText(t('analysis.demoMode'))).toBeVisible();
  await expect(page.getByText(t('wizard.step', { current: 1, total: 20 }))).toBeVisible();

  const seen = await answerWizard(page, {
    language: LANG,
    answers: ANSWERS,
    dateFormat: 'DD/MM/YYYY',
    axeOn: new Set(['patient.fullName', 'patient.gender', 'contact.state', 'visit.firstVisit', 'Text7:low', 'visit.date:format', 'medical.description']),
    onStep: async (fieldId) => {
      if (fieldId !== 'Text1') return false;
      const input = page.locator('.question-card input');
      await input.fill('901301-10-1234');
      await page.getByRole('button', { name: t('wizard.next'), exact: true }).click();
      await expect(page.getByText(t('validation.ic.invalidDate'))).toBeVisible();
      await expect(input).toHaveAttribute('aria-invalid', 'true');
      await expectNoAxeViolations(page, 'IC error shown');
      await input.fill('900101-10-1234');
      await page.getByRole('button', { name: t('wizard.next'), exact: true }).click();
      return true;
    },
  });
  // Read-only branch code and the signature are not asked.
  expect(seen).not.toContain('clinic.branchCode');
  expect(seen).not.toContain('consent.signature');
  expect(seen).toHaveLength(20);

  await expect(page.getByRole('heading', { level: 1, name: t('review.title') })).toBeVisible();
  await expect(page.getByText(t('review.privacyNotice'))).toBeVisible();
  await expect(page.getByText('900101101234')).toBeVisible();
  await expect(page.getByText('011-2345 6789')).toBeVisible();
  await expectNoAxeViolations(page, 'review');

  // Nothing is downloaded before the user confirms.
  await page.getByRole('button', { name: t('review.confirm') }).click();
  const link = page.getByRole('link', { name: t('download.button') });
  await expect(link).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: t('download.ready') })).toBeVisible();
  await expectNoAxeViolations(page, 'download');

  const downloadEvent = page.waitForEvent('download');
  await link.click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('clinic-registration-filled.pdf');
  const bytes = new Uint8Array(await readFile((await download.path())!));

  // Task 36.2: the drawn text sits inside each field, and the pages are rendered and kept as screenshots.
  const checked = await expectTextInsideFields(bytes, DRAWN_TEXT);
  expect(checked).toBe(Object.values(DRAWN_TEXT).join('\n').split('\n').length);
  const shots = await screenshotPdfPages(page, bytes, test.info().outputPath('filled'));
  for (const file of shots) await test.info().attach(file.split(/[\\/]/).pop()!, { path: file, contentType: 'image/png' });
  expect(shots).toHaveLength(1);

  return PDFDocument.load(bytes);
}

/** Every text value the Nov 17 path writes, as it must appear on the page (field rectangle check). */
const DRAWN_TEXT: Record<string, string> = {
  'patient.fullName': 'LIN MEI TEST',
  Text1: '900101101234',
  'patient.birthDate': '01/01/1990',
  Text7: 'REF-A',
  'contact.mobile': '011-2345 6789',
  'contact.homePhone': '03-2345 6789',
  Text3: 'lin.mei@example.invalid',
  'contact.address': 'Unit Ujian 8, Jalan Rekaan Ungu',
  'contact.postcode': '43000',
  'contact.city': 'Bandar Rekaan',
  'visit.date': '17/11/2026',
  'medical.description': 'Saya batuk selama dua hari.',
  'emergency.name': 'LIN HAO TEST',
  'emergency.phone': '012-345 6789',
  'visit.shortCode': 'A123',
  // Untouched read-only value: still drawn in its own field.
  'clinic.branchCode': 'AU-TEST',
};

function expectFilled(pdf: PDFDocument) {
  const form = pdf.getForm();
  const text = (n: string) => form.getTextField(n).getText();
  expect(text('patient.fullName')).toBe('LIN MEI TEST');
  expect(text('Text1')).toBe('900101101234');
  expect(text('patient.birthDate')).toBe('01/01/1990');
  expect(text('contact.mobile')).toBe('011-2345 6789');
  expect(text('contact.homePhone')).toBe('03-2345 6789');
  expect(text('Text3')).toBe('lin.mei@example.invalid');
  expect(text('contact.postcode')).toBe('43000');
  expect(text('visit.date')).toBe('17/11/2026');
  expect(text('medical.description')).toBe('Saya batuk selama dua hari.');
  expect(text('emergency.phone')).toBe('012-345 6789');
  expect(text('visit.shortCode')).toBe('A123');
  expect(form.getRadioGroup('patient.gender').getSelected()).toBe('F');
  expect(form.getDropdown('contact.state').getSelected()).toEqual(['SGR']);
  expect(form.getCheckBox('visit.firstVisit').isChecked()).toBe(true);
  expect(form.getCheckBox('medical.allergyFlag').isChecked()).toBe(false);
  // Skipped checkbox keeps its original ticked state; the read-only code is untouched.
  expect(form.getCheckBox('consent.contact').isChecked()).toBe(true);
  expect(text('clinic.branchCode')).toBe('AU-TEST');
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

test('(b) low confidence: the user confirms Malay and Malaysia', async ({ page }) => {
  await startToUpload(page);
  await expect(page.getByRole('heading', { level: 1, name: t('confirm.title') })).toBeVisible();
  await expectNoAxeViolations(page, 'confirm form language');
  await page.getByLabel(t('confirm.languageLabel')).selectOption('ms');
  await page.getByLabel(t('confirm.countryLabel')).selectOption('MY');
  await page.getByRole('button', { name: t('confirm.continue') }).click();
  expectFilled(await wizardToDownload(page));
});
