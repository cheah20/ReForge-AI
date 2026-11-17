/**
 * tests/e2e/accessforge-same-data.spec.ts
 *
 * accessforge-skeleton task 19.2 (design Question 8, "End-to-end evidence").
 * Two browser contexts, mock provider: a direct top-level submission of the
 * Intended_Values and a Mirror submission of the user's answers give the same
 * Received_Fields_Summary, and each received value is the documented
 * transformation of the Mirror answer.
 * Validates: Requirements 15.1, 15.2, 15.3, 15.5, 15.6, 15.7
 */

import { test, expect, type Page, type FrameLocator } from '@playwright/test';
import { translate } from './helpers.js';
import { INTENDED, answerAll, legacyFrame, revive } from './helpers/accessforge.js';

const t = (k: string) => translate('en', k);
const ORDER = ['nama', 'nokp', 'tlahir', 'jantina', 'tel', 'poskod', 'tujuan', 'akuan'];

/** Rows of #ringkasan-diterima: name from th[data-name], value from the td text. */
async function summary(root: Page | FrameLocator) {
  const rows = root.locator('#ringkasan-diterima tr');
  const out: Array<{ name: string; value: string }> = [];
  for (let i = 0; i < (await rows.count()); i++) {
    const row = rows.nth(i);
    out.push({ name: (await row.locator('th[data-name]').getAttribute('data-name'))!, value: (await row.locator('td[data-value]').textContent())! });
  }
  return out;
}

test('a direct submission and a Mirror submission give the same received data', async ({ browser }) => {
  test.setTimeout(90_000);

  const direct = await browser.newContext();
  const d = await direct.newPage();
  await d.goto('/legacy/register');
  for (const name of ['nama', 'nokp', 'tlahir', 'tel', 'poskod']) await d.locator(`input[name="${name}"]`).fill(INTENDED[name]!);
  await d.locator('input[name="jantina"][value="P"]').check();
  await d.locator('select[name="tujuan"]').selectOption('PERIKSA');
  await d.locator('input[name="akuan"]').check();
  await d.locator('input[type="submit"]').click();
  await expect(d.locator('#rujukan')).toBeVisible();
  const directRows = await summary(d);

  const mirror = await browser.newContext();
  const m = await mirror.newPage();
  await revive(m);
  await answerAll(m);
  await m.getByRole('button', { name: t('accessforge.review.confirm') }).click();
  await expect(m.getByText(t('accessforge.result.received'))).toBeVisible({ timeout: 20_000 });
  const mirrorRows = await summary(legacyFrame(m));

  // Identical lists: same count, order, names and values, character for character.
  expect(mirrorRows).toEqual(directRows);
  // Exactly the eight fields in form order, no button names, each the documented transformation.
  expect(mirrorRows.map((r) => r.name)).toEqual(ORDER);
  expect(Object.fromEntries(mirrorRows.map((r) => [r.name, r.value]))).toEqual(INTENDED);

  const frameReference = (await legacyFrame(m).locator('#rujukan').textContent())!;
  expect(frameReference).toMatch(/^SR-DEMO-\d{8}-\d{6}$/);
  await expect(m.locator('.mirror-result__reference')).toHaveText(translate('en', 'accessforge.result.reference', { reference: frameReference }));

  await direct.close();
  await mirror.close();
});
