/**
 * src/lib/ai/mock.ts
 *
 * Deterministic AiProvider for tests, local development and the demo when real
 * AI is not enabled (decision 11). The UI shows "Demo mode: AI responses are
 * simulated" whenever this provider answers.
 *
 * - Bundled fixture forms are recognised by their field IDs and answered from
 *   the tables in fixtures/mock-analysis/ (answer types and confidences follow
 *   the fixture specification).
 * - Any other form gets a generic answer: the PDF's own type, the tooltip or
 *   field name as the label, and confidence 0.5 (low confidence, so the user
 *   confirms each question).
 * - Same input, same output. Form-language and form-country confidence can be
 *   fixed per instance, so tests can force or skip the confirmation screen.
 */

import clinic from '../../../fixtures/mock-analysis/clinic-registration.json';
import us from '../../../fixtures/mock-analysis/us-community-clinic.json';
import school from '../../../fixtures/mock-analysis/school-enrolment.json';
import translations from '../../../fixtures/mock-analysis/translations.json';
import { translate as t } from '../../packs/language/registry.js';
import type { AnswerType, FieldAnalysis, FieldEvidence } from '../../shared/types.js';
import type { AiProvider, AiReply, AnalyzeCall, RetranslateCall, TranslateCall } from './interface.js';

export const MOCK_MODEL = 'mock';
const GENERIC_CONFIDENCE = 0.5;

interface MockFieldEntry {
  answerType: AnswerType;
  confidence: number;
  /** language tag -> [humanLabel, question] */
  text?: Record<string, [string, string]>;
}

export interface MockFormTable {
  fixture: string;
  formLanguage: string;
  formLanguageConfidence: number;
  formCountry: string;
  formCountryConfidence: number;
  fields: Record<string, MockFieldEntry>;
}

const TABLES = [clinic, us, school] as unknown as MockFormTable[];
const PAIRS = (translations as { pairs: Record<string, Record<string, string>> }).pairs;

export interface MockAiOptions {
  /** Overrides the form-language confidence of every reply. */
  formLanguageConfidence?: number;
  /** Overrides the form-country confidence of every reply. */
  formCountryConfidence?: number;
  /** Extra tables (tests). Checked before the bundled ones. */
  tables?: MockFormTable[];
}

const clip = (s: string, n: number) => [...s].slice(0, n).join('');

/** The table that knows every field in the batch, if any. */
export function matchTable(fieldIds: readonly string[], tables: readonly MockFormTable[] = TABLES): MockFormTable | undefined {
  return tables.find((table) => fieldIds.length > 0 && fieldIds.every((id) => id in table.fields));
}

function genericLabel(field: { fieldId: string; tooltip?: string | undefined }): string {
  return clip(field.tooltip?.trim() || field.fieldId, 40);
}

function genericAnalysis(field: FieldEvidence, language: string): FieldAnalysis {
  const label = genericLabel(field);
  return {
    fieldId: field.fieldId,
    humanLabel: label,
    question: clip(t(language, 'mock.question', { label }), 120),
    answerType: field.fieldType,
    confidence: GENERIC_CONFIDENCE,
  };
}

/** Label and question from a table entry in `language`, falling back to English, then generic. */
function tableText(entry: MockFieldEntry, language: string, fallbackLabel: string): [string, string] {
  const text = entry.text?.[language] ?? entry.text?.['en'];
  if (text) return text;
  return [fallbackLabel, clip(t(language, 'mock.question', { label: fallbackLabel }), 120)];
}

function reply(value: unknown): AiReply {
  return { value, usage: { model: MOCK_MODEL, durationMs: 0 } };
}

export class MockAiProvider implements AiProvider {
  readonly kind = 'mock' as const;
  private readonly tables: MockFormTable[];

  constructor(private readonly options: MockAiOptions = {}) {
    this.tables = [...(options.tables ?? []), ...TABLES];
  }

  async analyze({ request }: AnalyzeCall): Promise<AiReply> {
    const lang = request.interfaceLanguage;
    const table = matchTable(
      request.fields.map((f) => f.fieldId),
      this.tables,
    );

    const fields: FieldAnalysis[] = request.fields.map((field) => {
      const entry = table?.fields[field.fieldId];
      if (!entry) return genericAnalysis(field, lang);
      const [humanLabel, question] = tableText(entry, lang, genericLabel(field));
      return { fieldId: field.fieldId, humanLabel, question, answerType: entry.answerType, confidence: entry.confidence };
    });

    return reply({
      fields,
      formLanguage: table?.formLanguage ?? request.detectedFormLanguage ?? 'en',
      formLanguageConfidence: this.options.formLanguageConfidence ?? table?.formLanguageConfidence ?? GENERIC_CONFIDENCE,
      formCountry: table?.formCountry ?? request.detectedCountry ?? 'MY',
      formCountryConfidence: this.options.formCountryConfidence ?? table?.formCountryConfidence ?? GENERIC_CONFIDENCE,
    });
  }

  async retranslate({ request }: RetranslateCall): Promise<AiReply> {
    const lang = request.targetLanguage;
    const fields = request.fields;
    const table = matchTable(
      fields.map((f) => f.fieldId),
      this.tables,
    );
    return reply({
      fields: fields.map((f) => {
        const entry = table?.fields[f.fieldId];
        const [humanLabel, question] = entry
          ? tableText(entry, lang, genericLabel(f))
          : [f.humanLabel, clip(t(lang, 'mock.question', { label: f.humanLabel }), 120)];
        return { fieldId: f.fieldId, humanLabel, question };
      }),
    });
  }

  async translate({ request }: TranslateCall): Promise<AiReply> {
    const known = PAIRS[`${request.sourceLanguage}:${request.targetLanguage}`]?.[request.text.trim()];
    // Unknown text is marked, never passed off as a real translation.
    return reply({ translation: known ?? `[demo translation] ${request.text}` });
  }
}
