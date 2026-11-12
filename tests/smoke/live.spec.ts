/**
 * tests/smoke/live.spec.ts
 *
 * Live smoke test on the deployed app with real Workers AI (task 37.2).
 * Run only with playwright.smoke.config.ts. One analysis of the clinic form in
 * Simplified Chinese, one description translation, plus the sample route
 * (read in the browser only, no analysis).
 *
 * Real AI chooses its own wording, answer types and confidence, so the script
 * reacts to what each step shows instead of expecting fixed text. Every request
 * body to /api is recorded and checked for answer values.
 */

import { test, expect, type Page, type Request } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { fixture, translate } from '../e2e/helpers.js';
import { expectTextInsideFields } from '../e2e/pdf-check.js';

const LANG = 'zh-Hans';
const t = (key: string, params?: Record<string, string | number>) => translate(LANG, key, params);
/** Fixture spec: the description typed in Chinese, written as escapes (no Chinese in repo files). */
const DESCRIPTION_ZH = '\u6211\u54b3\u55fd\u4e86\u4e24\u5929\u3002';

const TYPED: Record<string, string> = {
  'patient.fullName': 'LIN MEI TEST',
  'patient.birthDate': '01/01/1990',
  Text7: 'REF-A',
  'contact.mobile': '0112345 6789',
  'contact.homePhone': '03-2345 6789',
  Text3: 'lin.mei@example.invalid',
  'contact.address': 'Unit Ujian 8, Jalan Rekaan Ungu',
  'contact.postcode': '43000',
  'contact.city': 'Bandar Rekaan',
  'visit.date': '17/11/2026',
  'emergency.name': 'LIN HAO TEST',
  'emergency.phone': '012-345 6789',
  'visit.shortCode': 'A123',
};
const CHOSEN: Record<string, string> = {
  'patient.gender': 'Perempuan',
  'contact.state': 'Selangor',
  'visit.firstVisit': t('wizard.checkbox.checked'),
  'medical.allergyFlag': t('wizard.checkbox.unchecked'),
};
/** Answer values that must never appear in an analyze or retranslate body, nor in a log line. */
const PRIVATE = ['LIN MEI TEST', '900101', '901301', '2345 6789', 'lin.mei@example.invalid', 'Jalan Rekaan Ungu', 'LIN HAO TEST', 'REF-A', 'A123', DESCRIPTION_ZH];

interface Sent {
  url: string;
  body: string;
}

function record(page: Page): Sent[] {
  const sent: Sent[] = [];
  page.on('request', (r: Request) => {
    if (r.url().includes('/api/')) sent.push({ url: new URL(r.url()).pathname, body: r.postData() ?? '' });
  });
  return sent;
}

const findings: string[] = [];

test('Nov 17 path in Chinese with real AI, on the public URL', async ({ page }, info) => {
  const sent = record(page);
  const modes: string[] = [];
  page.on('response', (r) => {
    if (r.url().includes('/api/')) modes.push(`${new URL(r.url()).pathname} ${r.status()} ${r.headers()['x-reforge-ai-mode']}`);
  });

  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.locator(`input[value="${LANG}"]`).check();
  await page.getByRole('button', { name: t('language.picker.continue') }).click();
  await page.getByLabel(t('upload.button')).setInputFiles(fixture('clinic-registration.pdf'));
  await expect(page.getByText(t('upload.found', { count: 22, pages: 1 }))).toBeVisible();
  expect(sent).toEqual([]);
  const started = Date.now();
  await page.getByRole('button', { name: t('upload.acknowledge') }).click();

  // Real analysis: up to a minute. Either the confirmation screen or the first question.
  const confirm = page.getByRole('heading', { level: 1, name: t('confirm.title') });
  const card = page.locator('.question-card');
  await expect(confirm.or(card)).toBeVisible({ timeout: 90_000 });
  findings.push(`analysis took ${Math.round((Date.now() - started) / 1000)} s`);
  await expect(page.getByText(t('analysis.demoMode'))).toHaveCount(0); // real AI, not the mock
  if (await confirm.isVisible()) {
    findings.push('confirmation screen shown');
    await page.getByLabel(t('confirm.languageLabel')).selectOption('ms');
    await page.getByLabel(t('confirm.countryLabel')).selectOption('MY');
    await page.getByRole('button', { name: t('confirm.continue') }).click();
  } else findings.push('confirmation screen skipped (confidence at least 0.7)');

  const asked: string[] = [];
  for (let guard = 0; guard < 40; guard++) {
    if ((await card.count()) === 0) break;
    const id = (await card.getAttribute('data-field-id'))!;
    if (asked.at(-1) !== id) asked.push(id);
    const lowConfidence = card.getByRole('button', { name: t('wizard.confirmQuestion') });
    if (await lowConfidence.count()) {
      findings.push(`low confidence: ${id}`);
      await lowConfidence.click();
    }
    const ddmm = card.getByRole('radio', { name: /^DD\/MM\/YYYY/ });
    if (await ddmm.count()) {
      findings.push(`date format asked: ${id}`);
      await ddmm.click();
    }
    const next = page.getByRole('button', { name: t('wizard.next'), exact: true });

    if (id === 'Text1') {
      const input = card.locator('input');
      await input.fill('901301-10-1234');
      await next.click();
      const rejected = await page.getByText(t('validation.ic.invalidDate')).isVisible();
      findings.push(rejected ? 'wrong IC rejected' : 'PROBLEM: wrong IC was not rejected (AI did not mark the field as an IC)');
      if (rejected) {
        await input.fill('900101-10-1234');
        await next.click();
      }
      continue;
    }
    if (id === 'medical.description') {
      await card.locator('textarea').first().fill(DESCRIPTION_ZH);
      const translateButton = card.getByRole('button', { name: t('wizard.translate') });
      if (await translateButton.count()) {
        await translateButton.click();
        const approve = card.getByRole('button', { name: t('wizard.approveTranslation') });
        await expect(approve).toBeVisible({ timeout: 60_000 });
        findings.push(`translation: ${await card.locator('textarea[lang]').inputValue()}`);
        await approve.click();
      } else findings.push('PROBLEM: no translate button (AI did not mark the field as a description)');
      await next.click();
      continue;
    }
    if (id in TYPED) {
      await card.locator('input:not([type=radio]), textarea').first().fill(TYPED[id]!);
    } else if (id in CHOSEN) {
      await card.getByRole('radio', { name: CHOSEN[id]!, exact: true }).check();
    } else if (id === 'consent.contact') {
      await page.getByRole('button', { name: t('wizard.skip') }).click();
      continue;
    } else {
      findings.push(`PROBLEM: unexpected step ${id}`);
      await page.getByRole('button', { name: t('wizard.skip') }).click();
      continue;
    }
    await next.click();
    // A value the real AI typed differently (for example a phone marked as text) still has to pass.
    const error = card.locator('.validation-message .status-message');
    if ((await card.count()) && (await card.getAttribute('data-field-id')) === id && (await error.count())) {
      findings.push(`PROBLEM: ${id} rejected: ${await error.innerText()}`);
      await page.getByRole('button', { name: t('wizard.skip') }).click();
    }
  }
  findings.push(`steps asked: ${asked.length}`);

  await expect(page.getByRole('heading', { level: 1, name: t('review.title') })).toBeVisible();
  await page.getByRole('button', { name: t('review.confirm') }).click();
  const link = page.getByRole('link', { name: t('download.button') });
  await expect(link).toBeVisible();
  const downloadEvent = page.waitForEvent('download');
  await link.click();
  const bytes = new Uint8Array(await readFile((await (await downloadEvent).path())!));
  const pdf = await PDFDocument.load(bytes);
  const form = pdf.getForm();
  const read = (n: string) => form.getTextField(n).getText();
  findings.push(`PDF: IC ${read('Text1')}, mobile ${read('contact.mobile')}, description ${read('medical.description')}`);
  expect(read('patient.fullName')).toBe('LIN MEI TEST');
  expect(read('contact.mobile')).toBe('011-2345 6789');
  expect(form.getRadioGroup('patient.gender').getSelected()).toBe('F');
  expect(form.getDropdown('contact.state').getSelected()).toEqual(['SGR']);
  expect(form.getCheckBox('consent.contact').isChecked()).toBe(true);
  await expectTextInsideFields(bytes, { 'patient.fullName': 'LIN MEI TEST', 'contact.mobile': '011-2345 6789', 'contact.postcode': '43000' });

  // Privacy: only the description, once, after the button; no other answer in any body.
  const translateBodies = sent.filter((s) => s.url === '/api/forms/translate');
  expect(translateBodies.length).toBeLessThanOrEqual(1);
  for (const s of sent) {
    const allowed = s.url === '/api/forms/translate' ? [DESCRIPTION_ZH] : [];
    for (const value of PRIVATE) if (!allowed.includes(value)) expect(s.body, `${s.url} carries ${value}`).not.toContain(value);
  }
  findings.push(`requests: ${modes.join('; ')}`);
  await writeFile(info.outputPath('requests.json'), JSON.stringify(sent.map((s) => ({ url: s.url, bytes: s.body.length })), null, 1));
});

test('"Try a sample form" on the public URL reads the blank form and sends nothing', async ({ page }) => {
  const sent = record(page);
  await page.goto('/forms/sample');
  await page.waitForLoadState('networkidle');
  await expect(page.getByText(translate('en', 'upload.found', { count: 22, pages: 1 })).or(page.getByText(t('upload.found', { count: 22, pages: 1 })))).toBeVisible();
  await page.waitForTimeout(1000);
  expect(sent).toEqual([]);
  findings.push('sample route: 22 fields, no API request');
});

test.afterAll(() => {
  console.log(`SMOKE ${JSON.stringify(findings, null, 1)}`);
});
