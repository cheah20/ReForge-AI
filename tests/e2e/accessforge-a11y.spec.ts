/**
 * tests/e2e/accessforge-a11y.spec.ts
 *
 * accessforge-skeleton task 19.7: axe on every Mirror state of Requirement
 * 14.8, in `en` and `zh-Hans`, with the Revival_Frame excluded (the legacy
 * pages fail accessibility on purpose), plus target size, body text size and
 * reflow checks. Axe cannot judge focus order, wording or screen-reader use;
 * the manual checklist (task 21.1) covers those.
 * Validates: Requirements 14.1 to 14.9, 14.11
 */

import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { translate } from './helpers.js';
import { SYNTHETIC, answerAll, answerStep, currentStep, fillStep, legacyFrame, revive, useOwnClientAddress } from './helpers/accessforge.js';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function axe(page: Page, state: string) {
  const result = await new AxeBuilder({ page }).withTags(TAGS).exclude('.revival-frame').analyze();
  const summary = result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  expect(summary, `axe violations on ${state}`).toEqual([]);
}

const LANGS = [
  { tag: 'en', locale: 'en-US' },
  { tag: 'zh-Hans', locale: 'zh-CN' },
] as const;

test.beforeEach(({ page }) => useOwnClientAddress(page));

for (const { tag, locale } of LANGS) {
  test.describe(`axe in ${tag}`, () => {
    test.use({ locale, viewport: { width: 1280, height: 800 } });
    test.setTimeout(120_000);
    const t = (k: string, p?: Record<string, string | number>) => translate(tag, k, p);
    const confirm = (page: Page) => page.getByRole('button', { name: t('accessforge.review.confirm') }).click();

    test('start, notice, every step type, a low-confidence step, an error, review and the verified result', async ({ page }) => {
      await page.goto('/accessforge');
      await page.waitForLoadState('networkidle');
      await expect(legacyFrame(page).locator('input[name="nama"]')).toHaveCount(1);
      await axe(page, 'the start screen');
      await page.getByRole('button', { name: t('accessforge.start') }).click();
      await axe(page, 'the data notice');
      await page.getByRole('button', { name: t('accessforge.notice.acknowledge') }).click();
      await expect(page.locator('form.mirror-step')).toBeVisible({ timeout: 15_000 });

      for (let i = 0; i < 20; i++) {
        const id = await currentStep(page);
        if (id === null) break;
        await axe(page, `step ${id}`);
        if (id === 'f0:text:nokp') {
          await fillStep(page, { kind: 'text', value: '901301-10-1234' });
          await page.locator('form.mirror-step').getByRole('button', { name: t('accessforge.step.next') }).click();
          await expect(page.locator('form.mirror-step input[aria-invalid="true"]')).toHaveCount(1);
          await axe(page, 'a validation error');
        }
        await answerStep(page, SYNTHETIC[id]!, tag);
      }
      await axe(page, 'the review screen');
      await confirm(page);
      await expect(page.getByText(t('accessforge.result.received'))).toBeVisible({ timeout: 20_000 });
      await axe(page, 'the verified confirmation');
    });

    test('the could-not-verify report', async ({ page }) => {
      await page.route('**/legacy/register', (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        const body = new URLSearchParams(route.request().postData() ?? '');
        body.set('nama', 'SOMEONE ELSE');
        return route.continue({ postData: body.toString() });
      });
      await revive(page, tag);
      await answerAll(page, SYNTHETIC, tag);
      await confirm(page);
      await expect(page.getByText(t('accessforge.result.notVerified'))).toBeVisible({ timeout: 20_000 });
      await axe(page, 'the could-not-verify report');
    });

    test('the stop message', async ({ page }) => {
      await revive(page, tag);
      await page.evaluate(() => {
        (document.querySelector('iframe.revival-frame__iframe') as HTMLIFrameElement).contentWindow!.location.href = '/legacy/admin';
      });
      await expect(page.getByText(t('accessforge.error.pageNotSupported'))).toBeVisible();
      await axe(page, 'the stop message');
    });

    test('the do-it-yourself report, with larger text on', async ({ page }) => {
      await page.route('**/api/pages/analyze', async (route) => {
        const response = await route.fetch();
        const data = (await response.json()) as { entries: Array<{ elementId: string }> };
        await route.fulfill({ response, json: { ...data, entries: data.entries.filter((e) => e.elementId === 'f0:text:nama') } });
      });
      await revive(page, tag);
      await page.getByLabel(t('accessforge.largerText')).check();
      await axe(page, 'a step with larger text');
      await answerAll(page, SYNTHETIC, tag);
      await expect(page.locator('.diy-list').first()).toBeVisible();
      await axe(page, 'the review with do-it-yourself fields');
    });
  });
}

test.describe('sizes and reflow', () => {
  test.use({ viewport: { width: 360, height: 780 } });

  test('targets, body text and reflow with larger text on', async ({ page }) => {
    await revive(page);
    await page.getByLabel(translate('en', 'accessforge.largerText')).check();
    const form = page.locator('form.mirror-step');
    // Body text is at least 16 px; larger text makes it 20 px.
    const size = await form.locator('.hint').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(16);
    expect(await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.question__title')!).fontSize))).toBeGreaterThanOrEqual(20);
    // Every control is at least 24 x 24, the primary action at least 44 x 44.
    const small = await page.locator('.revival button, .revival input, .revival select, .revival a').evaluateAll((els) =>
      els
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24))
        .map(({ el }) => el.outerHTML.slice(0, 80)),
    );
    expect(small).toEqual([]);
    const next = await form.getByRole('button', { name: translate('en', 'accessforge.step.next') }).boundingBox();
    expect(next!.width).toBeGreaterThanOrEqual(44);
    expect(next!.height).toBeGreaterThanOrEqual(44);
    // No horizontal scroll at 360 px or at the widths of 200% zoom and WCAG reflow.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 'overflow at 360 px').toBeLessThanOrEqual(0);
    // 200% zoom of a 1280 px desktop is 640 px; WCAG 1.4.10 reflow is 320 px.
    for (const width of [640, 320]) {
      await page.setViewportSize({ width, height: 780 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `overflow at ${width} px`).toBeLessThanOrEqual(0);
    }
  });
});
