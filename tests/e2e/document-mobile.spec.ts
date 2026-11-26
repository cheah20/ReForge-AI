/**
 * tests/e2e/document-mobile.spec.ts
 *
 * formbridge-any-document task 13.9, scenario 10 (automated part): a first-time
 * user on a phone, in Simplified Chinese, goes from a photo to the answer sheet
 * with only the two entry buttons and the controls on each screen. Runs on the
 * `mobile-chromium` project (360 by 640, touch).
 *
 * On every screen: no horizontal scrolling and every primary control is at
 * least 44 by 44 px. The two entry buttons are at least 64 px tall, and on a
 * question the Back control can be seen without scrolling.
 * Validates: Requirements 1.1, 15.2, 23.1, 23.7, 27.9
 */

import { test, expect, type Locator, type Page } from '@playwright/test';
import { expectNoAxeViolations, translate } from './helpers.js';
import { documentFixturePath, injectMockOcr } from './helpers/document.js';

test.setTimeout(120_000);

const LANG = 'zh-Hans';
const t = (key: string, params?: Record<string, string | number>) => translate(LANG, key, params);
const FILE = 'clean-en.jpg';
const MIN = 44;

async function expectNoHorizontalScroll(page: Page, screen: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${screen}: the page scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(0);
}

/** Buttons and button-like links that are visible: a primary control a finger has to hit. */
async function expectPrimaryTargets(page: Page, screen: string) {
  const buttons = page.locator('main button:visible, main a.button:visible, main .file-picker__input:visible');
  const count = await buttons.count();
  const small: string[] = [];
  for (let i = 0; i < count; i++) {
    const box = await buttons.nth(i).boundingBox();
    if (!box) continue;
    if (box.width < MIN || box.height < MIN) small.push(`${(await buttons.nth(i).textContent())?.trim()} ${Math.round(box.width)}x${Math.round(box.height)}`);
  }
  expect(small, `${screen}: controls smaller than ${MIN}x${MIN}`).toEqual([]);
}

/** The hit area of a tick box is its whole row (the label around it). */
async function expectRowTarget(row: Locator, screen: string) {
  const box = await row.locator('label.checkbox-row').boundingBox();
  expect(box!.height, `${screen}: the tick row is too short to hit`).toBeGreaterThanOrEqual(MIN);
}

async function check(page: Page, screen: string) {
  await expectNoHorizontalScroll(page, screen);
  await expectPrimaryTargets(page, screen);
  await expectNoAxeViolations(page, `${screen} on a phone`);
}

test('a first-time user on a phone reaches the answer sheet in Simplified Chinese with big targets and no sideways scrolling', async ({ page }) => {
  await injectMockOcr(page, FILE);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.locator(`input[value="${LANG}"]`).check();
  await check(page, 'language picker');
  await page.getByRole('button', { name: t('language.picker.continue') }).click();

  // The two entry buttons, both big, both before anything else to choose.
  await expect(page.getByRole('heading', { level: 1, name: t('upload.title') })).toBeVisible();
  const entry = page.locator('.entry-button label');
  await expect(entry).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    const box = await entry.nth(i).boundingBox();
    expect(box!.height, `entry button ${i + 1} is too short`).toBeGreaterThanOrEqual(64);
    expect(box!.width).toBeGreaterThanOrEqual(MIN);
  }
  await check(page, 'entry');
  await page.getByLabel(t('upload.button')).setInputFiles(documentFixturePath(FILE));

  await expect(page.getByRole('heading', { level: 1, name: t('document.ocrLanguage.title') })).toBeVisible();
  await check(page, 'language question');
  await page.getByRole('button', { name: t('document.ocrLanguage.continue') }).click();

  await expect(page.getByRole('button', { name: t('document.preview.read') })).toBeVisible();
  await check(page, 'page preview');
  await page.getByRole('button', { name: t('document.preview.read') }).click();

  await expect(page.getByRole('heading', { level: 1, name: t('document.review.title') })).toBeVisible();
  const row = page.locator('li', { has: page.locator('input[type="text"][value="Full name:"]') });
  await expectRowTarget(row, 'line review');
  await check(page, 'line review');
  await row.getByRole('checkbox').check();
  await page.getByRole('button', { name: t('document.review.noAi') }).click();

  await expect(page.getByRole('heading', { level: 1, name: t('confirm.title') })).toBeVisible();
  await check(page, 'confirm language');
  await page.getByRole('button', { name: t('confirm.continue') }).click();

  const back = page.getByRole('button', { name: t('wizard.back'), exact: true });
  await expect(back).toBeVisible();
  const box = (await back.boundingBox())!;
  expect(box.y + box.height, 'Back is below the first screen of a phone').toBeLessThanOrEqual(640);
  await check(page, 'question');
  await page.locator('.question-card input').first().fill('Aisha Test');
  await page.getByRole('button', { name: t('wizard.next'), exact: true }).click();

  await expect(page.getByRole('button', { name: t('document.reviewScreen.makeSheet') })).toBeVisible();
  await check(page, 'review');
  await page.getByRole('button', { name: t('document.reviewScreen.makeSheet') }).click();

  await expect(page.getByRole('heading', { level: 1, name: t('document.sheet.title') })).toBeVisible();
  await check(page, 'answer sheet');
  // The table stacks on a narrow screen: the answer is on the page, not off to the side.
  const cell = page.locator('table.answer-sheet__table tbody td').last();
  const cellBox = (await cell.boundingBox())!;
  expect(cellBox.x + cellBox.width).toBeLessThanOrEqual(360);
});
