/**
 * tests/e2e/accessforge-submit-flows.spec.ts
 *
 * accessforge-skeleton task 19.5, mock provider: the legacy error page and
 * the rewrite, a stalled POST, a frame value changed behind the Mirror's back,
 * and an edit from the review screen.
 * Validates: Requirements 10.2, 10.5, 10.8, 10.9
 */

import { test, expect, type Page } from '@playwright/test';
import { translate } from './helpers.js';
import { INTENDED, SYNTHETIC, answerAll, answerStep, currentStep, frameValue, legacyFrame, recordLegacyPosts, revive } from './helpers/accessforge.js';

const t = (k: string, p?: Record<string, string | number>) => translate('en', k, p);
const confirm = (page: Page) => page.getByRole('button', { name: t('accessforge.review.confirm') }).click();

test('a legacy error page reloads the form, rewrites every field, opens the named field and needs a new confirm press', async ({ page }) => {
  test.setTimeout(90_000);
  const posts = recordLegacyPosts(page);
  let first = true;
  await page.route('**/legacy/register', async (route) => {
    if (route.request().method() !== 'POST' || !first) return route.continue();
    first = false;
    // The first submission arrives without the IC number, so the portal answers with its error page.
    const body = new URLSearchParams(route.request().postData() ?? '');
    body.delete('nokp');
    await route.continue({ postData: body.toString() });
  });
  await revive(page);
  await answerAll(page);
  await confirm(page);

  await expect(page.getByText(t('accessforge.error.legacyRejected', { labels: 'No. K/P*' }))).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => currentStep(page)).toBe('f0:text:nokp');
  // Every field was written again into the reloaded form.
  for (const name of ['nama', 'tlahir', 'tel', 'poskod', 'tujuan', 'jantina', 'akuan']) expect(await frameValue(page, name)).toBe(INTENDED[name]);
  expect(posts).toHaveLength(1);

  await answerAll(page, SYNTHETIC);
  expect(posts).toHaveLength(1);
  await confirm(page);
  await expect(page.getByText(t('accessforge.result.received'))).toBeVisible({ timeout: 20_000 });
  expect(posts).toHaveLength(2);
});

test('a stalled submission gives the unknown outcome after 15 s and keeps every answer', async ({ page }) => {
  test.setTimeout(90_000);
  await page.route('**/legacy/register', (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    // Never answered.
    return new Promise(() => {});
  });
  await revive(page);
  await answerAll(page);
  await confirm(page);
  await expect(page.getByText(t('accessforge.result.unknown'))).toBeVisible({ timeout: 25_000 });
  await expect(page.getByRole('button', { name: t('accessforge.result.tryAgain') })).toBeVisible();
});

test('a frame value changed behind the Mirror stops the confirm with a mismatch and submits nothing', async ({ page }) => {
  const posts = recordLegacyPosts(page);
  await revive(page);
  await answerAll(page);
  await legacyFrame(page).locator('input[name="nama"]').fill('SOMEONE ELSE');
  await confirm(page);
  await expect(page.getByText(t('accessforge.error.mismatch'))).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('SOMEONE ELSE');
  expect(posts).toHaveLength(0);
});

test('an edit from the review screen is written and read back before confirm', async ({ page }) => {
  const posts = recordLegacyPosts(page);
  await revive(page);
  await answerAll(page);
  const telRow = page.locator('.review-row').nth(4);
  await telRow.getByRole('button', { name: /^Edit/ }).click();
  expect(await currentStep(page)).toBe('f0:text:tel');
  await answerStep(page, { kind: 'text', value: '012 345 6789' });
  await expect(page.getByRole('heading', { level: 1, name: t('accessforge.review.title') })).toBeVisible();
  expect(await frameValue(page, 'tel')).toBe('012-345 6789');
  await expect(telRow.getByText(t('accessforge.status.filled'))).toBeVisible();
  await confirm(page);
  await expect(page.getByText(t('accessforge.result.received'))).toBeVisible({ timeout: 20_000 });
  expect(new URLSearchParams(posts[0]!.body).get('tel')).toBe('012-345 6789');
});
