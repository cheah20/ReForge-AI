/**
 * tests/e2e/accessforge-privacy.spec.ts
 *
 * accessforge-skeleton task 18.2, mock provider. A canary typed into the frame
 * before the revival and a canary given as a Mirror answer are absent from
 * every request body and URL, browser storage, cookies and the FormBridge
 * link. The answer canary appears only in the one legacy form POST.
 * Validates: Requirements 11.5, 13.3, 13.4, 13.10, 13.12
 */

import { test, expect } from '@playwright/test';
import { translate } from './helpers.js';
import { SYNTHETIC, answerAll, legacyFrame, useOwnClientAddress } from './helpers/accessforge.js';

const FRAME = 'CANARY-FRAME-5Q7Z';
const ANSWER = 'CANARY-ANSWER-8K2M';
const t = (k: string) => translate('en', k);

test.beforeEach(({ page }) => useOwnClientAddress(page));

test('neither canary leaves the browser except the answer in the one legacy POST', async ({ page, context }) => {
  test.setTimeout(90_000);
  const requests: Array<{ method: string; url: string; body: string }> = [];
  page.on('request', (r) => requests.push({ method: r.method(), url: r.url(), body: r.postData() ?? '' }));

  await page.goto('/accessforge');
  await page.waitForLoadState('networkidle');
  // Typed into the old page before the revival, as a user might.
  for (const name of ['nama', 'nokp', 'tlahir', 'tel', 'poskod']) await legacyFrame(page).locator(`input[name="${name}"]`).fill(FRAME);
  await expect(legacyFrame(page).locator('input[name="nama"]')).toHaveValue(FRAME);

  await page.getByRole('button', { name: t('accessforge.start') }).click();
  await page.getByRole('button', { name: t('accessforge.notice.acknowledge') }).click();
  await expect(page.locator('form.mirror-step')).toBeVisible({ timeout: 15_000 });
  await answerAll(page, { ...SYNTHETIC, 'f0:text:nama': { kind: 'text', value: ANSWER } });

  const analyze = requests.filter((r) => r.url.endsWith('/api/pages/analyze'));
  expect(analyze).toHaveLength(1);
  expect(analyze[0]!.body).toContain('"pageModel"');

  await page.getByRole('button', { name: t('accessforge.review.confirm') }).click();
  await expect(page.getByRole('heading', { level: 1, name: t('accessforge.result.title') })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(t('accessforge.result.received'))).toBeVisible();

  const withAnswer = requests.filter((r) => r.body.includes(ANSWER) || r.url.includes(ANSWER));
  expect(withAnswer.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual(['POST /legacy/register']);
  for (const r of requests) {
    expect(r.url).not.toContain(FRAME);
    expect(r.body).not.toContain(FRAME);
  }

  const stored = await page.evaluate(async () => ({
    local: JSON.stringify({ ...localStorage }),
    session: JSON.stringify({ ...sessionStorage }),
    cookie: document.cookie,
    idb: typeof indexedDB.databases === 'function' ? (await indexedDB.databases()).map((d) => d.name) : [],
  }));
  for (const value of [stored.local, stored.session, stored.cookie, JSON.stringify(await context.cookies())]) {
    expect(value).not.toContain(ANSWER);
    expect(value).not.toContain(FRAME);
  }
  expect(stored.idb).toEqual([]);

  const href = await page.getByRole('link', { name: t('accessforge.result.sampleForm') }).getAttribute('href');
  expect(href).toBe('/forms/sample');
});
