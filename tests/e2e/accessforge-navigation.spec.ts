/**
 * tests/e2e/accessforge-navigation.spec.ts
 *
 * accessforge-skeleton task 19.3, mock provider. A path outside the
 * Allow_List, an Allow_List path with a query string and the home page during
 * the question flow each stop the loop with "page is not supported", run no
 * further Action and submit nothing. An unrecorded Page_Version sends no
 * analysis request. A foreign address in the URL loads nothing.
 * Validates: Requirements 3.3, 3.6, 3.7, 3.8, 18.2
 */

import { test, expect, type Page } from '@playwright/test';
import { translate } from './helpers.js';
import { SYNTHETIC, answerStep, legacyFrame, recordLegacyPosts, revive } from './helpers/accessforge.js';

const t = (k: string) => translate('en', k);

async function navigateFrame(page: Page, path: string) {
  await page.evaluate((p) => {
    (document.querySelector('iframe.revival-frame__iframe') as HTMLIFrameElement).contentWindow!.location.href = p;
  }, path);
}

const CASES: Array<[string, (page: Page) => Promise<void>]> = [
  ['a path outside the Allow_List', (page) => navigateFrame(page, '/legacy/admin')],
  ['an Allow_List path with a query string', (page) => navigateFrame(page, '/legacy/register?x=1')],
  ['the home page, opened from the menu in the frame', (page) => legacyFrame(page).getByRole('link', { name: 'Laman Utama' }).click()],
];

for (const [label, go] of CASES) {
  test(`${label} during the question flow stops the loop`, async ({ page }) => {
    const posts = recordLegacyPosts(page);
    const writes: string[] = [];
    await revive(page);
    await answerStep(page, SYNTHETIC['f0:text:nama']!);
    await go(page);
    await expect(page.getByText(t('accessforge.error.pageNotSupported'))).toBeVisible();
    await expect(page.getByRole('button', { name: t('accessforge.error.reload') })).toBeVisible();
    await expect(page.locator('form.mirror-step')).toHaveCount(0);
    // Whatever the frame now shows, the Mirror writes nothing into it and submits nothing.
    page.on('framenavigated', (f) => writes.push(f.url()));
    await page.waitForTimeout(500);
    expect(posts).toHaveLength(0);
    expect(writes).toEqual([]);
  });
}

test('an unrecorded Page_Version sends no analysis request and shows the page-changed message', async ({ page }) => {
  const analyses: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/api/pages/analyze')) analyses.push(r.url());
  });
  await page.route('**/legacy/register', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = (await response.text()).replace(/(name="portal-page-version" content=")[0-9a-f]{64}/, `$1${'0'.repeat(64)}`);
    await route.fulfill({ response, body });
  });
  await page.goto('/accessforge');
  await page.waitForLoadState('networkidle');
  await expect(page.getByText(t('accessforge.error.pageChanged'))).toBeVisible();
  await expect(page.getByRole('button', { name: t('accessforge.start') })).toHaveCount(0);
  // The old page stays usable.
  await expect(legacyFrame(page).locator('input[name="nama"]')).toBeEditable();
  expect(analyses).toEqual([]);
});

test('a foreign address in the URL loads nothing from it and shows the scope message', async ({ page }) => {
  const foreign: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).hostname.endsWith('evil.example')) foreign.push(r.url());
  });
  await page.goto('/accessforge?url=https://evil.example/form');
  await page.waitForLoadState('networkidle');
  await expect(page.getByText(t('accessforge.scope.onlyDemo'))).toBeVisible();
  await expect(page.locator('iframe.revival-frame__iframe')).toHaveAttribute('src', '/legacy/register');
  expect(foreign).toEqual([]);
});
