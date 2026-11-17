/**
 * tests/e2e/accessforge-hostile.spec.ts
 *
 * accessforge-skeleton task 19.4, mock provider. Hostile documents are served
 * in the frame with `page.route` and the real LEGACY_CSP:
 * - the raw hostile page: its script does not run, its external resources
 *   are not loaded, nothing is submitted, no pop-up or top navigation;
 * - the registration page with a foreign form target: the form-target check
 *   stops the loop before any Action;
 * - the instruction-like variant: the same steps and the same POST body as
 *   the real page.
 * Validates: Requirements 4.2, 4.3, 4.4, 4.6, 4.7, 4.9
 */

import { test, expect, type Page, type Route } from '@playwright/test';
import { LEGACY_CSP } from '../../src/worker/legacy/respond.js';
import { translate } from './helpers.js';
import { INTENDED, SYNTHETIC, answerAll, legacyFrame, recordLegacyPosts, revive } from './helpers/accessforge.js';
import { INSTRUCTIONS, foreignTargetVariant, instructionVariant, rawHostileHtml } from './helpers/hostile-pages.js';

const t = (k: string) => translate('en', k);
const ORDER = ['nama', 'nokp', 'tlahir', 'jantina', 'tel', 'poskod', 'tujuan', 'akuan'];

/** Serves the GET of /legacy/register as `make(realHtml)`, with the real legacy CSP. */
async function serveRegister(page: Page, make: (html: string) => string) {
  await page.route('**/legacy/register', async (route: Route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': LEGACY_CSP }, body: make(await response.text()) });
  });
}

/** Records every request to the hostile host and stops it there. */
async function trapForeign(page: Page) {
  const seen: Array<{ type: string; url: string }> = [];
  await page.context().route(/evil\.example/, (route) => {
    seen.push({ type: route.request().resourceType(), url: route.request().url() });
    return route.abort();
  });
  return seen;
}

test('the raw hostile page runs no script, loads nothing external and submits nothing', async ({ page, context }) => {
  const foreign = await trapForeign(page);
  const popups: string[] = [];
  context.on('page', (p) => popups.push(p.url()));
  const posts = recordLegacyPosts(page);
  await serveRegister(page, () => rawHostileHtml());
  await page.goto('/accessforge');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1_000);

  // The script would fetch the hostile host with the cookie; the image and stylesheet would load from it.
  expect(foreign.filter((r) => ['script', 'fetch', 'xhr', 'image', 'stylesheet', 'font'].includes(r.type))).toEqual([]);
  // The page is not an allowed portal page, so the Mirror never starts on it.
  await expect(page.getByRole('button', { name: t('accessforge.start') })).toBeDisabled();
  expect(posts).toEqual([]);
  expect(popups).toEqual([]);
  expect(new URL(page.url()).pathname).toBe('/accessforge');
});

test('a foreign form target stops the loop before any Action and nothing is submitted', async ({ page }) => {
  const foreign = await trapForeign(page);
  const posts = recordLegacyPosts(page);
  await serveRegister(page, foreignTargetVariant);
  await revive(page);
  await page.locator('form.mirror-step input').first().fill('LIN MEI TEST');
  await page.locator('form.mirror-step').getByRole('button', { name: t('accessforge.step.next') }).click();
  await expect(page.getByText(t('accessforge.error.formTarget'))).toBeVisible();
  await expect(legacyFrame(page).locator('input[name="nama"]')).toHaveValue('');
  expect(posts).toEqual([]);
  expect(foreign).toEqual([]);
});

test('the instruction-like variant gives the same steps and the same submission as the real page', async ({ page }) => {
  const posts = recordLegacyPosts(page);
  await serveRegister(page, instructionVariant);
  await revive(page);
  // The planted text really is on the page the Mirror reads.
  await expect(legacyFrame(page).getByText(INSTRUCTIONS[0]!)).toBeVisible();
  const steps = await answerAll(page);
  expect(steps).toEqual(Object.keys(SYNTHETIC));
  expect(posts).toEqual([]);
  await page.getByRole('button', { name: t('accessforge.review.confirm') }).click();
  await expect(page.getByText(t('accessforge.result.received'))).toBeVisible({ timeout: 20_000 });
  expect(posts.map((p) => p.body)).toEqual([new URLSearchParams(ORDER.map((n) => [n, INTENDED[n]!])).toString()]);
});
