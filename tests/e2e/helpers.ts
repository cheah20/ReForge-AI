/**
 * tests/e2e/helpers.ts
 *
 * Shared steps for the acceptance tests. UI text comes from the locale files
 * through `translate`, so the tests use the same strings the user sees and no
 * non-English text is written into test files.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const locales = new Map<string, Record<string, string>>();
function locale(tag: string): Record<string, string> {
  let strings = locales.get(tag);
  if (!strings) {
    strings = JSON.parse(readFileSync(path.resolve(process.cwd(), 'src/packs/language/locales', `${tag}.json`), 'utf8')) as Record<string, string>;
    locales.set(tag, strings);
  }
  return strings;
}

/**
 * Same lookup as the app's `translate` (locale, then English, then the key).
 * Playwright's loader cannot import the JSON locale modules, so they are read here.
 */
export function translate(tag: string, key: string, params: Record<string, string | number> = {}): string {
  const template = locale(tag)[key] ?? locale('en')[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

export const fixture = (name: string) => path.resolve(process.cwd(), 'fixtures', name);

/** Zero axe violations for WCAG 2.0 to 2.2 A and AA (requirement 13.11). */
export async function expectNoAxeViolations(page: Page, screen: string): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const summary = result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  expect(summary, `axe violations on ${screen}`).toEqual([]);
}

export type Answer =
  | { kind: 'type'; value: string }
  | { kind: 'choose'; label: string }
  | { kind: 'skip' };

export interface WizardScript {
  language: string;
  answers: Record<string, Answer>;
  /** Date format to choose when a date field gives none. */
  dateFormat?: string;
  /** Called on each step before answering; return true when the step was handled. */
  onStep?: (fieldId: string) => Promise<boolean>;
  /** Field ids whose step gets an axe check. */
  axeOn?: ReadonlySet<string>;
}

export async function answerWizard(page: Page, script: WizardScript): Promise<string[]> {
  const t = (key: string) => translate(script.language, key);
  const seen: string[] = [];
  for (let guard = 0; guard < 60; guard++) {
    const card = page.locator('.question-card');
    if ((await card.count()) === 0) break;
    const fieldId = (await card.getAttribute('data-field-id'))!;
    if (seen.at(-1) !== fieldId) seen.push(fieldId);

    // Low-confidence question: check it against the PDF, then answer.
    const confirm = card.getByRole('button', { name: t('wizard.confirmQuestion') });
    if (await confirm.count()) {
      if (script.axeOn?.has(`${fieldId}:low`)) await expectNoAxeViolations(page, `low-confidence ${fieldId}`);
      await confirm.click();
    }
    // Date format question.
    if (script.dateFormat && (await card.getByRole('radio', { name: new RegExp(`^${script.dateFormat.replace(/\//g, '\\/')}`) }).count())) {
      if (script.axeOn?.has(`${fieldId}:format`)) await expectNoAxeViolations(page, `date format ${fieldId}`);
      // click, not check: choosing a format replaces the radios with the date input.
      await card.getByRole('radio', { name: new RegExp(`^${script.dateFormat.replace(/\//g, '\\/')}`) }).click();
      await expect(card.locator('input:not([type=radio])')).toBeVisible();
    }
    if (script.onStep && (await script.onStep(fieldId))) continue;

    const answer = script.answers[fieldId];
    if (!answer) throw new Error(`No scripted answer for ${fieldId}`);
    if (script.axeOn?.has(fieldId)) await expectNoAxeViolations(page, `question ${fieldId}`);
    if (answer.kind === 'skip') {
      await page.getByRole('button', { name: t('wizard.skip') }).click();
      continue;
    }
    if (answer.kind === 'choose') await card.getByRole('radio', { name: answer.label, exact: true }).check();
    else await card.locator('input:not([type=radio]), textarea').first().fill(answer.value);
    await page.getByRole('button', { name: t('wizard.next'), exact: true }).click();
  }
  return seen;
}
