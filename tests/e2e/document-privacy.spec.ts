/**
 * tests/e2e/document-privacy.spec.ts
 *
 * Scenario 8 (formbridge-any-document task 13.7): a prefilled sensitive form.
 * The user ticks every line the review may list (the fixture's `not-listed`
 * lines excluded) and answers every question with a canary. A second test
 * ticks every line the review offers (the worst case): the next-line rule keeps
 * a prefilled name or sentence out of the review, so nothing leaves.
 * Through the AI path and in Original_Label_Mode,
 * no canary value, no Numeric_Fragment of a split value and no typed answer
 * appears in any request URL, header or body, every request goes to the app's
 * own origin, and nothing is kept in web storage, IndexedDB, cookies, Cache
 * Storage (OCR files only), the URL or history.state.
 * Validates: Requirements 4.4, 10.7, 19.11, 20.2, 20.6, 24.1, 24.2, 24.7, 24.9, 24.10, 27.7
 */

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { digitPattern, documentFixturePath, fixtureEntry, forbiddenStrings, injectMockOcr, recordRequests, requestText, scanStorage } from './helpers/document.js';
import { translate } from './helpers.js';

test.setTimeout(120_000);
const t = (key: string, params?: Record<string, string | number>) => translate('en', key, params);

const ANSWER_CANARY = 'ANSWERCANARY-7731';
const ORIGIN = 'http://localhost:5173';
const FIXTURES = ['prefilled-sensitive.png', 'prefilled-split.png'] as const;
const PATHS = ['ai', 'original'] as const;

async function reachLabelReview(page: Page, file: string): Promise<void> {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.locator('input[value="en"]').check();
  await page.getByRole('button', { name: t('language.picker.continue') }).click();
  await page.getByLabel(t('upload.button')).setInputFiles(documentFixturePath(file));
  await page.getByRole('button', { name: t('document.ocrLanguage.continue') }).click();
  await page.getByRole('button', { name: t('document.preview.read') }).click();
  await expect(page.getByRole('heading', { level: 1, name: t('document.review.title') })).toBeVisible();
}

/**
 * Ticks the lines the review offers. `listed` skips the fixture's `not-listed`
 * lines (what the spec says must not be offered); `everything` ticks all of them.
 */
async function tick(page: Page, file: string, mode: 'listed' | 'everything'): Promise<number> {
  const summary = page.locator('summary');
  if (await summary.count()) await summary.first().click();
  const notListed = new Set(fixtureEntry(file).lines?.filter((l) => l.expect === 'not-listed').map((l) => l.text) ?? []);
  const rows = page.locator('ol.label-review > li');
  const total = await rows.count();
  let ticked = 0;
  for (let i = 0; i < total; i++) {
    const row = rows.nth(i);
    const text = await row.locator('input[type="text"]').first().inputValue();
    if (mode === 'listed' && notListed.has(text)) continue;
    const box = row.getByRole('checkbox');
    if (await box.isEnabled()) {
      await box.check();
      ticked++;
    }
  }
  return ticked;
}

async function answerEveryQuestion(page: Page): Promise<void> {
  for (let i = 0; i < 60; i++) {
    if (await page.getByRole('button', { name: t('document.reviewScreen.makeSheet') }).isVisible()) return;
    const input = page.locator('.question-card input[type="text"], .question-card textarea').first();
    const stepText = () => page.getByText(/^Question \d+ of \d+$/).first().textContent({ timeout: 1500 }).catch(() => null);
    const step = await stepText();
    if (await input.isVisible()) await input.fill(`${ANSWER_CANARY} ${i}`);
    await page.getByRole('button', { name: t('wizard.next'), exact: true }).click();
    // A typed answer the field's own rule refuses (a phone, IC or date) stays on the step: skip it, the canary is still never sent.
    const sameStep = await stepText();
    if (sameStep === step && !(await page.getByRole('button', { name: t('document.reviewScreen.makeSheet') }).isVisible())) {
      await page.getByRole('button', { name: t('wizard.skip') }).click();
    }
  }
  throw new Error('the questions did not end');
}

type Mode = 'listed' | 'everything';

/** Plays one whole scenario and checks every rule except the strings in `allowed` (a documented gap). */
async function runScenario(page: Page, context: BrowserContext, file: string, path: (typeof PATHS)[number], mode: Mode, allowed: ReadonlySet<string>): Promise<void> {
  await injectMockOcr(page, file);
  const requests = recordRequests(page);
  await reachLabelReview(page, file);
  const ticked = await tick(page, file, mode);
  expect(ticked, 'the review offered at least one line').toBeGreaterThan(0);

  if (path === 'ai') await page.getByRole('button', { name: /^Send (this|these)/ }).click();
  else await page.getByRole('button', { name: t('document.review.noAi') }).click();

  // Both paths can ask the form language and country first.
  const confirm = page.getByRole('button', { name: t('confirm.continue') });
  await confirm.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
  if (await confirm.isVisible()) await confirm.click();

  if (path === 'ai') {
    // A language switch after the analysis re-translates the questions: that request is recorded too.
    const select = page.locator('.app-header select');
    await select.selectOption('ms');
    await expect(select).toBeEnabled({ timeout: 30_000 });
    await select.selectOption('en');
    await expect(select).toBeEnabled({ timeout: 30_000 });
  }

  await answerEveryQuestion(page);
  await page.getByRole('button', { name: t('document.reviewScreen.makeSheet') }).click();
  await expect(page.getByRole('heading', { level: 1, name: t('document.sheet.title') })).toBeVisible();

  // 1. Every request goes to the app's own origin (blob: and data: URLs are local, not network requests).
  for (const r of requests.filter((x) => !/^(blob|data):/.test(x.url))) expect(r.url.startsWith(ORIGIN), `request to another origin: ${new URL(r.url).origin}`).toBe(true);

  // 2. The AI path asks the label service; Original_Label_Mode asks no API at all.
  const api = requests.filter((r) => new URL(r.url).pathname.startsWith('/api/'));
  if (path === 'ai') expect(api.some((r) => r.url.endsWith('/api/documents/analyze-labels'))).toBe(true);
  else expect(api, 'Original_Label_Mode makes no API request').toEqual([]);

  // 3. No canary, no numeric fragment and no typed answer in any request.
  const strings = forbiddenStrings(file).filter((x) => !allowed.has(x));
  const forbidden = [...strings, ANSWER_CANARY];
  const patterns = strings.map(digitPattern).filter((p): p is RegExp => p !== null);
  for (const r of requests) {
    const text = requestText(r);
    for (const x of forbidden) expect(text.includes(x), `"${x}" leaked in ${r.method} ${new URL(r.url).pathname}`).toBe(false);
    for (const p of patterns) expect(p.test(text), `digits ${p.source} leaked in ${new URL(r.url).pathname}`).toBe(false);
  }

  // 4. Nothing is kept in the browser.
  const scan = await scanStorage(page, context);
  for (const x of forbidden) expect(scan.text.includes(x), `"${x}" was kept in browser storage`).toBe(false);
  expect(scan.databaseNames, 'no IndexedDB database').toEqual([]);
  for (const name of scan.cacheNames) expect(name.startsWith('reforge-ocr-'), `unexpected cache ${name}`).toBe(true);
}

for (const file of FIXTURES) {
  for (const path of PATHS) {
    test(`${file}: nothing private leaves the browser or is kept (${path})`, async ({ page, context }) => {
      await runScenario(page, context, file, path, 'listed', new Set());
    });
  }
}

/**
 * Worst case: the user ticks every line the review offers. A prefilled value with no digit, no
 * email and no colon (a name in a box, a free-text sentence) sits directly below its question, so
 * the next-line rule never offers it: nothing from the fixture is allowed to leave.
 */
test('prefilled-sensitive.png: ticking every offered line sends nothing from the fixture (ai)', async ({ page, context }) => {
  await runScenario(page, context, 'prefilled-sensitive.png', 'ai', 'everything', new Set());
});
