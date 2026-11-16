// @vitest-environment jsdom
/**
 * tests/unit/accessforge-mock.test.ts
 *
 * accessforge-skeleton tasks 13.1 and 13.9: the mock provider's page analysis
 * is deterministic and answers from fixtures/mock-analysis/legacy-register.json.
 * Validates: Requirements 1.11, 7.1
 */

import { describe, it, expect } from 'vitest';
import { MockAiProvider } from '../../src/lib/ai/mock.js';
import { validatePlanReply } from '../../src/lib/accessforge/plan-validator.js';
import table from '../../fixtures/mock-analysis/legacy-register.json';
import type { PageModel } from '../../src/shared/page-schemas.js';
import { MODEL } from './accessforge-helpers.js';

const TABLE = (table as unknown as { entries: Record<string, { text: Record<string, [string, string]> }> }).entries;
const ask = (model: PageModel, lang: string) => new MockAiProvider().analyzePage({ request: { pageModel: model, interfaceLanguage: lang }, interfaceLanguageName: lang });

describe('MockAiProvider.analyzePage', () => {
  it('gives an identical plan for an identical Page_Model and language', async () => {
    const a = await ask(MODEL, 'zh-Hans');
    const b = await ask(MODEL, 'zh-Hans');
    expect(JSON.stringify(a.value)).toBe(JSON.stringify(b.value));
  });

  it('maps every field with a valid plan; the reason for visit has confidence 0.6', async () => {
    const plan = validatePlanReply(MODEL, (await ask(MODEL, 'en')).value)!;
    expect(plan.mapped.size).toBe(8);
    expect(plan.doItYourself.size).toBe(0);
    expect(plan.mapped.get('f0:select:tujuan')?.confidence).toBe(0.6);
    expect([...plan.mapped.values()].filter((e) => e.confidence < 0.7).map((e) => e.elementId)).toEqual(['f0:select:tujuan']);
  });

  it.each(['en', 'zh-Hans'])('takes the %s texts from the table', async (lang) => {
    const entries = ((await ask(MODEL, lang)).value as { entries: Array<{ elementId: string; humanLabel: string; question: string }> }).entries;
    for (const e of entries) expect([e.humanLabel, e.question]).toEqual(TABLE[e.elementId]!.text[lang]);
  });

  it('falls back to English for a language the table lacks', async () => {
    const entries = ((await ask(MODEL, 'ta')).value as { entries: Array<{ elementId: string; humanLabel: string }> }).entries;
    expect(entries.find((e) => e.elementId === 'f0:text:nama')?.humanLabel).toBe(TABLE['f0:text:nama']!.text['en']![0]);
  });

  it('gives an unknown control a generic entry at confidence 0.5 and no entry to buttons', async () => {
    const extra = { ...MODEL.entries[0]!, elementId: 'f0:text:alamat', name: 'alamat', labelText: 'Alamat', position: 10 };
    const entries = ((await ask({ ...MODEL, entries: [...MODEL.entries, extra] }, 'en')).value as { entries: Array<{ elementId: string; confidence: number; humanLabel: string }> }).entries;
    expect(entries.find((e) => e.elementId === 'f0:text:alamat')).toMatchObject({ confidence: 0.5, humanLabel: 'Alamat' });
    expect(entries.some((e) => e.elementId === 'f0:submit:' || e.elementId === 'f0:reset:')).toBe(false);
  });
});
