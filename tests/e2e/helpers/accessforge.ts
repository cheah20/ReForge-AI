/**
 * tests/e2e/helpers/accessforge.ts
 *
 * Shared steps for the AccessForge browser tests: open the screen, revive the
 * page, answer each Mirror step by Element_Id, read the frame. Not a test file.
 */

import { expect, type FrameLocator, type Page } from '@playwright/test';
import { translate } from '../helpers.js';

export type MirrorAnswer =
  | { kind: 'text'; value: string }
  | { kind: 'date'; day: string; month: string; year: string }
  | { kind: 'option'; value: string }
  | { kind: 'consent'; checked: boolean };

/** The Synthetic_Registration answers of design Question 8, as the user gives them. */
export const SYNTHETIC: Record<string, MirrorAnswer> = {
  'f0:text:nama': { kind: 'text', value: '  LIN MEI TEST ' },
  'f0:text:nokp': { kind: 'text', value: '900101-10-1234' },
  'f0:text:tlahir': { kind: 'date', day: '1', month: '1', year: '1990' },
  'f0:radio:jantina': { kind: 'option', value: 'P' },
  'f0:text:tel': { kind: 'text', value: '+60 11-2345 6789' },
  'f0:text:poskod': { kind: 'text', value: '43000' },
  'f0:select:tujuan': { kind: 'option', value: 'PERIKSA' },
  'f0:checkbox:akuan': { kind: 'consent', checked: true },
};

/** The Intended_Values the legacy form must hold after those answers. */
export const INTENDED: Record<string, string> = {
  nama: 'LIN MEI TEST',
  nokp: '900101101234',
  tlahir: '01/01/1990',
  jantina: 'P',
  tel: '011-2345 6789',
  poskod: '43000',
  tujuan: 'PERIKSA',
  akuan: 'YA',
};

export const legacyFrame = (page: Page): FrameLocator => page.frameLocator('iframe.revival-frame__iframe');

/**
 * Gives the page its own client address. The analysis route allows 20 requests per minute per address
 * (design Question 5), and the whole suite runs from one machine, so each test presents a different
 * address in the header the Worker reads. Production ignores this: Cloudflare sets the header itself.
 */
export async function useOwnClientAddress(page: Page): Promise<void> {
  const part = () => Math.floor(Math.random() * 250) + 1;
  await page.setExtraHTTPHeaders({ 'cf-connecting-ip': `10.${part()}.${part()}.${part()}` });
}

/** Opens AccessForge, waits for the legacy page in the frame, revives it and acknowledges the notice. */
export async function revive(page: Page, lang = 'en', path = '/accessforge'): Promise<void> {
  const t = (k: string) => translate(lang, k);
  await useOwnClientAddress(page);
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  // Attached, not visible: below 1024 px the frame is hidden until the user shows it.
  await expect(legacyFrame(page).locator('form input[name="nama"]')).toHaveCount(1);
  await page.getByRole('button', { name: t('accessforge.start') }).click();
  await page.getByRole('button', { name: t('accessforge.notice.acknowledge') }).click();
  // Generous: a cold dev server can be slow when many tests start together.
  await expect(page.locator('form.mirror-step')).toBeVisible({ timeout: 30_000 });
}

/** The Element_Id of the open step, or null when no step is open. */
export async function currentStep(page: Page): Promise<string | null> {
  const form = page.locator('form.mirror-step');
  if ((await form.count()) === 0) return null;
  return form.getAttribute('data-element-id');
}

/** Fills the open step with an answer, without pressing next. */
export async function fillStep(page: Page, answer: MirrorAnswer): Promise<void> {
  const form = page.locator('form.mirror-step');
  switch (answer.kind) {
    case 'text':
      await form.locator('input:not([type="radio"]):not([type="checkbox"])').first().fill(answer.value);
      return;
    case 'date': {
      const parts = form.locator('.date-parts input');
      await parts.nth(0).fill(answer.day);
      await parts.nth(1).fill(answer.month);
      await parts.nth(2).fill(answer.year);
      return;
    }
    case 'option':
      if ((await form.locator('select').count()) > 0) await form.locator('select').selectOption(answer.value);
      else await form.locator(`input[type="radio"][value="${answer.value}"]`).check();
      return;
    case 'consent':
      await form.locator('input[type="checkbox"]').setChecked(answer.checked);
      return;
  }
}

/** Fills the open step and presses next, then waits until a different step or screen shows. */
export async function answerStep(page: Page, answer: MirrorAnswer, lang = 'en'): Promise<void> {
  const before = await currentStep(page);
  await fillStep(page, answer);
  await page.locator('form.mirror-step').getByRole('button', { name: translate(lang, 'accessforge.step.next') }).click();
  await expect.poll(() => currentStep(page)).not.toBe(before);
}

/** Answers every open step until the review screen, using `answers` by Element_Id. Returns the step ids seen. */
export async function answerAll(page: Page, answers: Record<string, MirrorAnswer> = SYNTHETIC, lang = 'en'): Promise<string[]> {
  const seen: string[] = [];
  for (let i = 0; i < 20; i++) {
    const id = await currentStep(page);
    if (id === null) break;
    seen.push(id);
    const answer = answers[id];
    if (!answer) throw new Error(`no answer for ${id}`);
    await answerStep(page, answer, lang);
  }
  await expect(page.getByRole('heading', { level: 1, name: translate(lang, 'accessforge.review.title') })).toBeVisible();
  return seen;
}

/** The value of a legacy field in the frame, as the browser would submit it. */
export async function frameValue(page: Page, name: string): Promise<string | null> {
  const f = legacyFrame(page);
  if (name === 'jantina') {
    const checked = f.locator('input[name="jantina"]:checked');
    return (await checked.count()) === 0 ? null : checked.getAttribute('value');
  }
  if (name === 'akuan') return (await f.locator('input[name="akuan"]').isChecked()) ? 'YA' : null;
  if (name === 'tujuan') return f.locator('select[name="tujuan"]').inputValue();
  return f.locator(`input[name="${name}"]`).inputValue();
}

/** Every POST the page made to /legacy/register, with its body. */
export function recordLegacyPosts(page: Page): Array<{ body: string }> {
  const posts: Array<{ body: string }> = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === '/legacy/register') posts.push({ body: r.postData() ?? '' });
  });
  return posts;
}
