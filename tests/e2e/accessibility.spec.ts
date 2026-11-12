/**
 * tests/e2e/accessibility.spec.ts
 *
 * Task 35: the accessibility states the Nov 17 path does not reach, in a real
 * browser with the mock AI:
 * - a real <select> dropdown (more than 7 options), a required-field error,
 *   a low-confidence question and a skipped required field in review;
 * - every screen at 360 px width with larger text on: no horizontal scrolling,
 *   targets at least 44 px high, axe clean;
 * - keyboard only: focus lands on each step's heading and the flow works
 *   without a pointer;
 * - prefers-reduced-motion swaps the slide for a short fade.
 * 200% zoom of a 1280 px window is a 640 CSS px viewport; the 360 px run is the
 * stricter case of the same reflow rule (WCAG 1.4.10).
 * Validates: Requirements 13.1 to 13.11
 */

import { test, expect, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { expectNoAxeViolations, translate } from './helpers.js';

test.setTimeout(120_000);
const t = (key: string, params?: Record<string, string | number>) => translate('en', key, params);

/** A small synthetic form: a 10-option dropdown and a required text field. */
async function dropdownForm(file: string): Promise<string> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Synthetic test form', { x: 36, y: 800, size: 16, font });
  page.drawText('District', { x: 36, y: 740, size: 10, font });
  page.drawText('Full name', { x: 36, y: 670, size: 10, font });
  const form = doc.getForm();
  const district = form.createDropdown('address.district');
  district.addOptions(['North', 'South', 'East', 'West', 'Central', 'Harbour', 'Hill', 'River', 'Lake', 'Coast']);
  district.addToPage(page, { x: 36, y: 704, width: 250, height: 24, font });
  const name = form.createTextField('person.name');
  name.enableRequired();
  name.addToPage(page, { x: 36, y: 634, width: 300, height: 24, font });
  await writeFile(file, await doc.save());
  return file;
}

async function noHorizontalScroll(page: Page, screen: string) {
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  expect(scroll, `${screen}: page is ${scroll}px wide in a ${width}px window`).toBeLessThanOrEqual(width);
}

/** Every visible control is at least 44 px high (primary and secondary alike) and 24 px wide. */
async function targetsBigEnough(page: Page, screen: string) {
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('main button, main a.button, header select, main select, main .input, main .textarea, main .language-option, main .choice-option, main .checkbox-row, main summary')]
      .filter((el) => el.offsetParent !== null)
      .map((el) => ({ el: el.className || el.tagName, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.height < 44 - 0.5 || r.width < 24)
      .map(({ el, r }) => `${el} ${Math.round(r.width)}x${Math.round(r.height)}`),
  );
  expect(small, `${screen}: targets smaller than 44 px high`).toEqual([]);
}

async function checkScreen(page: Page, screen: string) {
  await noHorizontalScroll(page, screen);
  await targetsBigEnough(page, screen);
  await expectNoAxeViolations(page, screen);
}

test('a real dropdown, a required-field error and a skipped required field pass axe', async ({ page }, info) => {
  const file = await dropdownForm(info.outputPath('dropdown-form.pdf'));
  await page.goto('/');
  await page.getByLabel('English').check();
  await page.getByRole('button', { name: t('language.picker.continue') }).click();
  await page.getByLabel(t('upload.button')).setInputFiles(file);
  await expect(page.getByText(t('upload.found', { count: 2, pages: 1 }))).toBeVisible();
  await page.getByRole('button', { name: t('upload.acknowledge') }).click();

  // The mock is unsure about an unknown form: confirm its language and country.
  await page.getByRole('button', { name: t('confirm.continue') }).click();

  // Step 1, low confidence: the evidence and the answer-type check come first.
  await expect(page.getByRole('button', { name: t('wizard.confirmQuestion') })).toBeVisible();
  await expectNoAxeViolations(page, 'low-confidence dropdown question');
  await page.getByRole('button', { name: t('wizard.confirmQuestion') }).click();
  const select = page.locator('.question-card select');
  await expect(select).toBeVisible();
  expect(await select.locator('option').count()).toBe(11); // "Choose one" + 10 options
  await expectNoAxeViolations(page, 'real dropdown');
  await select.selectOption('River');
  await page.getByRole('button', { name: t('wizard.next'), exact: true }).click();

  // Step 2, required text: a blank Next is blocked with a linked, announced error.
  await page.getByRole('button', { name: t('wizard.confirmQuestion') }).click();
  const input = page.locator('.question-card input');
  await page.getByRole('button', { name: t('wizard.next'), exact: true }).click();
  await expect(page.getByText(t('validation.required'))).toBeVisible();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expectNoAxeViolations(page, 'required-field error');

  // Skipping it on purpose is allowed, with a warning in review (requirement 7.7).
  await page.getByRole('button', { name: t('wizard.skip') }).click();
  await expect(page.getByRole('heading', { level: 1, name: t('review.title') })).toBeVisible();
  await expect(page.getByText(t('review.field.status.skippedRequired'))).toBeVisible();
  await expectNoAxeViolations(page, 'review with a skipped required field');
});

test.describe('360 px wide with larger text', () => {
  test.use({ viewport: { width: 360, height: 780 } });

  test('every screen reflows, keeps large targets and passes axe', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByLabel('English').check();
    await page.getByLabel(t('language.picker.largerText')).check();
    await expect(page.locator('html')).toHaveAttribute('data-text-size', 'large');
    await checkScreen(page, 'language picker');

    await page.getByRole('button', { name: t('language.picker.trySample') }).click();
    await expect(page.getByText(t('upload.found', { count: 22, pages: 1 }))).toBeVisible();
    await page.getByText(t('upload.fieldListTitle')).click();
    await checkScreen(page, 'upload with the field list open');

    await page.getByRole('button', { name: t('upload.acknowledge') }).click();
    await expect(page.getByRole('heading', { level: 1, name: t('confirm.title') })).toBeVisible();
    await checkScreen(page, 'confirm form language');
    await page.getByRole('button', { name: t('confirm.continue') }).click();

    // Text, radio, the low-confidence question and the date-format choice, then skip to review.
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const card = page.locator('.question-card');
      if ((await card.count()) === 0) break;
      const id = (await card.getAttribute('data-field-id'))!;
      if (['patient.fullName', 'patient.gender', 'Text7', 'visit.date', 'medical.description'].includes(id) && !seen.has(id)) {
        seen.add(id);
        await checkScreen(page, `question ${id}`);
      }
      await page.getByRole('button', { name: t('wizard.skip') }).click();
    }
    expect(seen.size).toBe(5);

    await expect(page.getByRole('heading', { level: 1, name: t('review.title') })).toBeVisible();
    await checkScreen(page, 'review');
    await page.getByRole('button', { name: t('review.confirm') }).click();
    await expect(page.getByRole('link', { name: t('download.button') })).toBeVisible();
    await checkScreen(page, 'download');
  });
});

test('keyboard only: focus moves to each heading and the flow works without a pointer', async ({ page }) => {
  await page.goto('/forms/sample');
  await page.waitForLoadState('networkidle');
  // The first Tab reaches the skip link.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: t('app.skipToContent') })).toBeFocused();
  await expect(page.getByText(t('upload.found', { count: 22, pages: 1 }))).toBeVisible();

  const acknowledge = page.getByRole('button', { name: t('upload.acknowledge') });
  for (let i = 0; i < 12 && !(await acknowledge.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
  await expect(acknowledge).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page.getByRole('heading', { level: 1, name: t('confirm.title') })).toBeFocused();
  const confirm = page.getByRole('button', { name: t('confirm.continue') });
  for (let i = 0; i < 6 && !(await confirm.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');

  // Step 1: focus is on the heading; Tab reaches the input; Enter submits.
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('.question-card input')).toBeFocused();
  await page.keyboard.type('LIN MEI TEST');
  await page.keyboard.press('Enter');
  await expect(page.getByText(t('wizard.step', { current: 2, total: 20 }))).toBeVisible();
  await expect(heading).toBeFocused();

  // Step 2: the birth date (format printed on the form).
  await page.keyboard.press('Tab');
  await page.keyboard.type('01/01/1990');
  await page.keyboard.press('Enter');

  // Step 3: a radio group, chosen with the arrow keys.
  await expect(page.getByText(t('wizard.step', { current: 3, total: 20 }))).toBeVisible();
  await expect(heading).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('.question-card input[type=radio]').first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.question-card input[type=radio]:checked')).toHaveValue('M');
  await page.keyboard.press('Enter');
  await expect(page.getByText(t('wizard.step', { current: 4, total: 20 }))).toBeVisible();

  // Back by keyboard keeps the answer.
  const back = page.getByRole('button', { name: t('wizard.back') });
  for (let i = 0; i < 8 && !(await back.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
  await expect(back).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.question-card input[type=radio]:checked')).toHaveValue('M');
});

test.describe('reduced motion', () => {
  for (const [motion, expected] of [
    ['no-preference', 'step-in'],
    ['reduce', 'step-fade'],
  ] as const) {
    test(`prefers-reduced-motion: ${motion} uses ${expected}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: motion });
      await page.goto('/forms/sample');
      await page.getByRole('button', { name: t('upload.acknowledge') }).click();
      await page.getByRole('button', { name: t('confirm.continue') }).click();
      const name = await page.locator('.question-card').evaluate((el) => getComputedStyle(el).animationName);
      expect(name).toBe(expected);
    });
  }
});
