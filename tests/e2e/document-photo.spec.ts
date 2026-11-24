/**
 * tests/e2e/document-photo.spec.ts
 *
 * Scenario 2 (formbridge-any-document task 13.2): a clean phone photo becomes
 * questions and an answer sheet. The photo is read from the mock OCR result,
 * the label service answers with the mock AI, and the answer sheet lists every
 * kept label with its answer. The only request that carries anything from the
 * document is the label request, and it holds the kept labels only.
 * Validates: Requirements 27.2, 12.9, 13.1, 19.1
 */

import { test, expect } from '@playwright/test';
import { translate } from './helpers.js';
import { documentFixturePath, fixtureEntry, injectMockOcr, recordRequests, requestText } from './helpers/document.js';

test.setTimeout(120_000);
const t = (key: string, params?: Record<string, string | number>) => translate('en', key, params);

const FILE = 'clean-en.jpg';
const KEPT = ['Full name:', 'IC or passport number:', 'Email:'];

async function toLabelReview(page: import('@playwright/test').Page) {
  await injectMockOcr(page, FILE);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.locator('input[value="en"]').check();
  await page.getByRole('button', { name: t('language.picker.continue') }).click();
  await page.getByLabel(t('upload.button')).setInputFiles(documentFixturePath(FILE));
  await page.getByRole('button', { name: t('document.ocrLanguage.continue') }).click();
  await page.getByRole('button', { name: t('document.preview.read') }).click();
  await expect(page.getByRole('heading', { level: 1, name: t('document.review.title') })).toBeVisible();
}

const rowFor = (page: import('@playwright/test').Page, text: string) =>
  page.locator('li', { has: page.locator(`input[type="text"][value="${text}"]`) });

test('a clean photo goes from the label review through every question to an answer sheet that lists every kept label', async ({ page }) => {
  const requests = recordRequests(page);
  await toLabelReview(page);

  // Nothing is ticked until the user ticks it.
  await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(0);
  for (const label of KEPT) await rowFor(page, label).getByRole('checkbox').check();
  await page.getByRole('button', { name: /^Send (this|these)/ }).click();

  // The mock AI may ask for the form language and country first.
  const confirm = page.getByRole('button', { name: t('confirm.continue') });
  await confirm.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
  if (await confirm.isVisible()) await confirm.click();

  // One question per screen, one for each kept label.
  const answers: string[] = [];
  for (let i = 0; i < KEPT.length; i++) {
    await expect(page.getByText(t('wizard.step', { current: i + 1, total: KEPT.length }))).toBeVisible();
    // A question the AI is unsure about asks to be confirmed before its input shows.
    const confirmQuestion = page.getByRole('button', { name: t('wizard.confirmQuestion') });
    if (await confirmQuestion.isVisible({ timeout: 1500 }).catch(() => false)) await confirmQuestion.click();
    const input = page.locator('.question-card input:not([type="checkbox"]):not([type="radio"]), .question-card textarea').first();
    // A plain value every country rule accepts; the review and the sheet show it unchanged.
    const value = ['Aisha Test', '900101-14-5678', 'aisha.test@example.com'][i]!;
    await input.fill(value);
    answers.push(value);
    await page.getByRole('button', { name: t('wizard.next'), exact: true }).click();
    // A value the field's own rule refuses stays on the step: this fixture's values are meant to pass, so fail loudly.
    if (i < KEPT.length - 1) await expect(page.getByText(t('wizard.step', { current: i + 2, total: KEPT.length }))).toBeVisible();
  }

  await page.getByRole('button', { name: t('document.reviewScreen.makeSheet') }).click();
  await expect(page.getByRole('heading', { level: 1, name: t('document.sheet.title') })).toBeVisible();

  // The sheet lists every kept label, in page order, with its answer.
  const rows = page.locator('table.answer-sheet__table tbody tr');
  await expect(rows).toHaveCount(KEPT.length);
  for (let i = 0; i < KEPT.length; i++) {
    await expect(rows.nth(i).locator('th')).toHaveText(KEPT[i]!);
    await expect(rows.nth(i)).toContainText(answers[i]!.replace('900101-14-5678', '900101145678'));
  }

  // The only request that carries anything from the document is the label request, with the kept labels only.
  const labelRequests = requests.filter((r) => r.url.endsWith('/api/documents/analyze-labels'));
  expect(labelRequests.length).toBeGreaterThan(0);
  for (const r of labelRequests) {
    for (const label of KEPT) expect(r.body).toContain(label);
    for (const line of fixtureEntry(FILE).pages![0]!.mock.lines.map((l) => l.text)) {
      if (!KEPT.includes(line) && line.length > 6) expect(r.body, `a line that was not kept was sent: ${line}`).not.toContain(line);
    }
  }
  // No answer in any request.
  for (const r of requests) for (const a of answers) expect(requestText(r)).not.toContain(a);
});

test('every candidate on the label review has the crop of the page beside it', async ({ page }) => {
  test.fixme(true, 'Page_Crop (task 11.7) is not built yet; remove this line when it is.');
  await toLabelReview(page);
  const items = page.locator('ol.label-review > li');
  const count = await items.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) await expect(items.nth(i).getByRole('img')).toBeVisible();
});
