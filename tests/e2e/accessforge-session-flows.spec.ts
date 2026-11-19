/**
 * tests/e2e/accessforge-session-flows.spec.ts
 *
 * accessforge-skeleton task 19.6, mock provider: cancel, reload, the
 * leave-page warning, the frame toggle at 360 px, the write highlight under
 * reduced motion, the locked language picker, and the legacy portal working
 * on its own with scripts disabled.
 * Validates: Requirements 1.9, 7.11, 8.5, 8.12, 12.4, 12.5, 12.6, 14.12, 18.4
 */

import { test, expect } from '@playwright/test';
import { translate } from './helpers.js';
import { SYNTHETIC, answerStep, currentStep, frameValue, legacyFrame, revive } from './helpers/accessforge.js';

const t = (k: string) => translate('en', k);

test('cancel declined keeps the step; cancel confirmed clears the old page and the answers', async ({ page }) => {
  await revive(page);
  await answerStep(page, SYNTHETIC['f0:text:nama']!);
  const step = await currentStep(page);

  await page.locator('form.mirror-step').getByRole('button', { name: t('accessforge.step.cancel') }).click();
  const dialog = page.getByRole('dialog', { name: t('accessforge.cancel.title') });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: t('accessforge.cancel.decline') }).click();
  await expect(dialog).toBeHidden();
  expect(await currentStep(page)).toBe(step);
  // Focus returns to the control that opened the dialog.
  await expect(page.locator('form.mirror-step').getByRole('button', { name: t('accessforge.step.cancel') })).toBeFocused();

  await page.locator('form.mirror-step').getByRole('button', { name: t('accessforge.step.cancel') }).click();
  await dialog.getByRole('button', { name: t('accessforge.cancel.confirm') }).click();
  await expect(page.getByRole('button', { name: t('accessforge.start') })).toBeEnabled();
  expect(await frameValue(page, 'nama')).toBe('');
  await expect(page.locator('form.mirror-step')).toHaveCount(0);
});

test('a page reload starts fresh with nothing kept', async ({ page }) => {
  await revive(page);
  await answerStep(page, SYNTHETIC['f0:text:nama']!);
  page.on('dialog', (d) => void d.accept());
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: t('accessforge.start') })).toBeVisible();
  expect(await frameValue(page, 'nama')).toBe('');
});

test('the leave-page warning is requested while an answer exists', async ({ page }) => {
  await revive(page);
  await answerStep(page, SYNTHETIC['f0:text:nama']!);
  // The handler is registered and asks for the warning (the test checks the handler, not a dialog).
  const prevented = await page.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
  expect(prevented).toBe(true);
});

test.describe('at 360 px', () => {
  test.use({ viewport: { width: 360, height: 780 } });

  test('the frame toggle shows the old page without changing the step or the answers', async ({ page }) => {
    await revive(page);
    await answerStep(page, SYNTHETIC['f0:text:nama']!);
    const step = await currentStep(page);
    const frame = page.locator('iframe.revival-frame__iframe');
    await expect(frame).toBeHidden();
    await page.getByRole('button', { name: t('accessforge.frame.show') }).click();
    await expect(frame).toBeVisible();
    expect(await currentStep(page)).toBe(step);
    expect(await frameValue(page, 'nama')).toBe('LIN MEI TEST');
    await page.getByRole('button', { name: t('accessforge.frame.hide') }).click();
    await expect(frame).toBeHidden();
    expect(await currentStep(page)).toBe(step);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

test('the write highlight is at least 3 px, without transition under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await revive(page);
  await answerStep(page, SYNTHETIC['f0:text:nama']!);
  const style = await legacyFrame(page)
    .locator('input[name="nama"]')
    .evaluate((el) => ({ width: getComputedStyle(el).outlineWidth, transition: (el as HTMLElement).style.transition }));
  expect(parseFloat(style.width)).toBeGreaterThanOrEqual(3);
  expect(style.transition).toBe('none');
});

test('the language picker is locked while the loop runs', async ({ page }) => {
  await page.goto('/accessforge');
  await page.waitForLoadState('networkidle');
  const picker = page.getByLabel(t('nav.pickLanguage'));
  await expect(picker).toBeEnabled();
  await revive(page);
  await expect(picker).toBeDisabled();
  await expect(page.getByText(t('accessforge.language.locked'))).toBeVisible();
});

test.describe('with scripts disabled', () => {
  test.use({ javaScriptEnabled: false });

  test('the legacy portal works on its own from the home page to the confirmation', async ({ page }) => {
    await page.goto('/legacy/');
    // The menu opens on hover with no script: CSS only.
    await page.getByText('Lain-lain').hover();
    await page.getByRole('link', { name: 'Pendaftaran pesakit baru' }).click();
    await page.locator('input[name="nama"]').fill('LIN MEI TEST');
    await page.locator('input[name="nokp"]').fill('900101101234');
    await page.locator('input[name="tlahir"]').fill('01/01/1990');
    await page.locator('input[name="jantina"][value="P"]').check();
    await page.locator('input[name="tel"]').fill('011-2345 6789');
    await page.locator('input[name="poskod"]').fill('43000');
    await page.locator('select[name="tujuan"]').selectOption('PERIKSA');
    await page.locator('input[name="akuan"]').check();
    await page.locator('input[type="submit"]').click();
    await expect(page.locator('#rujukan')).toHaveText(/^SR-DEMO-\d{8}-\d{6}$/);
  });
});
