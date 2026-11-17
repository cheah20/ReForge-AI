/**
 * tests/e2e/accessforge-acceptance.spec.ts
 *
 * accessforge-skeleton task 19.1: the AccessForge acceptance scenario at
 * 1280 x 800 in Simplified Chinese. Locally it runs with the mock provider.
 * The `@smoke` copy runs only when BASE_URL is set (playwright.config.ts) and
 * then accepts any Analysis_Mode, checking by `lang`, step count and
 * Element_Id, within 120 s.
 * Validates: Requirements 6.11, 8.4, 9.6, 11.1, 11.2, 13.11, 16.1 to 16.6
 */

import { test, expect, type Page } from '@playwright/test';
import { translate } from './helpers.js';
import { INTENDED, SYNTHETIC, answerStep, currentStep, fillStep, frameValue, legacyFrame, recordLegacyPosts } from './helpers/accessforge.js';

const LANG = 'zh-Hans';
const t = (key: string, params?: Record<string, string | number>) => translate(LANG, key, params);
const NAME_OF = (id: string) => id.split(':')[2]!;
const REFERENCE = /^SR-DEMO-\d{8}-\d{6}$/;

test.use({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' });

async function scenario(page: Page, deployed: boolean) {
  test.setTimeout(120_000);
  const posts = recordLegacyPosts(page);
  await page.goto('/accessforge');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('html')).toHaveAttribute('lang', LANG);

  // The old page is in the frame and usable, before any Mirror question.
  await expect(legacyFrame(page).locator('input[name="nama"]')).toBeEditable();
  await expect(page.locator('form.mirror-step')).toHaveCount(0);

  await page.getByRole('button', { name: t('accessforge.start') }).click();
  await expect(page.getByRole('heading', { name: t('accessforge.notice.title') })).toBeVisible();
  await page.getByRole('button', { name: t('accessforge.notice.acknowledge') }).click();
  await expect(page.locator('form.mirror-step')).toBeVisible({ timeout: deployed ? 60_000 : 15_000 });
  const total = Number((await page.locator('.mirror-step__counter').textContent())!.match(/\d+/g)!.at(-1));
  if (!deployed) expect(total).toBe(8);

  const seen: string[] = [];
  let lowConfidenceShown = false;
  for (let step = 1; step <= 20; step++) {
    const id = await currentStep(page);
    if (id === null) break;
    seen.push(id);
    await expect(page.locator('.mirror-step__counter')).toHaveText(t('accessforge.step', { current: step, total }));
    if ((await page.locator('.mirror-evidence [lang="ms"]').count()) > 0) lowConfidenceShown = true;

    if (id === 'f0:text:nokp') {
      // A wrong IC (month 13) is rejected in Chinese and the old page stays empty.
      await fillStep(page, { kind: 'text', value: '901301-10-1234' });
      await page.locator('form.mirror-step').getByRole('button', { name: t('accessforge.step.next') }).click();
      await expect(page.locator('form.mirror-step [aria-live="polite"]')).toHaveText(t('validation.ic.invalidDate'));
      await expect(page.locator('form.mirror-step input').first()).toHaveAttribute('aria-invalid', 'true');
      expect(await frameValue(page, 'nokp')).toBe('');
      expect(await currentStep(page)).toBe(id);
    }
    await answerStep(page, SYNTHETIC[id]!, LANG);
    const name = NAME_OF(id);
    await expect.poll(() => frameValue(page, name), { timeout: 2_000 }).toBe(INTENDED[name]);
  }
  expect(seen).toHaveLength(total);
  if (!deployed) {
    expect(seen).toEqual(Object.keys(SYNTHETIC));
    expect(lowConfidenceShown).toBe(true);
  }

  await expect(page.getByRole('heading', { level: 1, name: t('accessforge.review.title') })).toBeVisible();
  await expect(page.locator('.review-row .status-message', { hasText: t('accessforge.status.filled') })).toHaveCount(deployed ? total : 8);
  expect(posts).toHaveLength(0);

  await page.getByRole('button', { name: t('accessforge.review.confirm') }).click();
  await expect(page.getByRole('heading', { level: 1, name: t('accessforge.result.title') })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(t('accessforge.result.received'))).toBeVisible();
  expect(posts).toHaveLength(1);

  const frameReference = (await legacyFrame(page).locator('#rujukan').textContent())!;
  expect(frameReference).toMatch(REFERENCE);
  await expect(page.locator('.mirror-result__reference')).toHaveText(t('accessforge.result.reference', { reference: frameReference }));

  const original = page.locator('.mirror-result p[lang="ms"]');
  await expect(original).toBeHidden();
  await page.getByRole('button', { name: t('accessforge.result.showOriginal') }).click();
  await expect(original).toBeVisible();
  await expect(original).toHaveText((await legacyFrame(page).locator('#mesej-pengesahan').textContent())!);

  await expect(page.getByRole('link', { name: t('accessforge.result.sampleForm') })).toHaveAttribute('href', '/forms/sample');
}

// Registered by environment instead of skipped, so no skip marker is needed.
if (process.env['BASE_URL']) {
  test('@smoke the AccessForge acceptance scenario on the deployed app', async ({ page }) => scenario(page, true));
} else {
  test('the AccessForge acceptance scenario with the mock provider', async ({ page }) => scenario(page, false));
}
