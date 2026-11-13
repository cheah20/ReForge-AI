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
import legacyRegister from '../../../fixtures/mock-analysis/legacy-register.json';
import { translate as t } from '../../packs/language/registry.js';
import type { AnswerType, FieldAnalysis, FieldEvidence, LabelAnswerType } from '../../shared/types.js';
import type { PageEntry } from '../../shared/page-schemas.js';
import type {
  AiProvider,
  AiReply,
  AnalyzeCall,
  LabelAnalyzeCall,
  PageAnalyzeCall,
  RetranslateCall,
  TranslateCall,
} from './interface.js';

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

// ---------------------------------------------------------------------------
// Label analysis (formbridge-any-document Requirement 13.12)
// ---------------------------------------------------------------------------

/** Keyword table, English and Malay, checked in this order; the first match decides. */
const LABEL_KEYWORDS: ReadonlyArray<[RegExp, LabelAnswerType]> = [
  [/tandatangan|signature/i, 'signature'],
  [/kad pengenalan|\bic\b|mykad/i, 'ic'],
  [/e-?mel|e-?mail/i, 'email'],
  [/telefon|phone/i, 'phone'],
  [/poskod|postcode|\bzip\b/i, 'postcode'],
  [/tarikh|\bdate\b/i, 'date'],
  [/sebab|reason|symptoms?/i, 'description'],
  [/\bnama\b|\bname\b/i, 'text'],
];

const LABEL_MATCH_CONFIDENCE = 0.9;

export function mockLabelAnswerType(text: string): { answerType: LabelAnswerType; confidence: number } {
  const hit = LABEL_KEYWORDS.find(([re]) => re.test(text));
  return hit ? { answerType: hit[1], confidence: LABEL_MATCH_CONFIDENCE } : { answerType: 'text', confidence: GENERIC_CONFIDENCE };
}

/** The label as a short human label: trailing colon, leaders and spaces removed, at most 40 code points. */
function shortLabel(text: string): string {
  const cleaned = text.replace(/[\s:._\u2026]+$/u, '').trim();
  return clip(cleaned || text.trim(), 40);
}

// ---------------------------------------------------------------------------
// AccessForge page analysis (accessforge-skeleton design, AiProvider additions)
// ---------------------------------------------------------------------------

interface PageTableEntry {
  answerType: AnswerType;
  confidence: number;
  text: Record<string, [string, string]>;
}

const PAGE_TABLE = (legacyRegister as unknown as { entries: Record<string, PageTableEntry> }).entries;

function genericPageAnswerType(entry: PageEntry): AnswerType {
  if (entry.control === 'select') return 'dropdown';
  if (entry.control === 'radio') return 'radio';
  if (entry.control === 'checkbox') return 'checkbox';
  return 'text';
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

  /**
   * Deterministic: keyword table for the answer type, confidence 0.9 on a
   * match and 0.5 otherwise, a `[demo]` question built from the label and the
   * fixed fictional example of the answer type from the locale files.
   */
  async analyzeLabels(call: LabelAnalyzeCall): Promise<AiReply> {
    const lang = call.interfaceLanguage;
    const fields = call.labels.map((label) => {
      const { answerType, confidence } = mockLabelAnswerType(label.text);
      const humanLabel = shortLabel(label.text);
      const entry: Record<string, unknown> = {
        fieldId: label.labelId,
        humanLabel,
        question: clip(`[demo] ${t(lang, 'mock.question', { label: humanLabel })}`, 120),
        answerType,
        confidence,
      };
      if (answerType !== 'signature') entry['example'] = clip(t(lang, `document.example.${answerType}`), 60);
      return entry;
    });
    return reply({
      fields,
      formLanguage: call.formLanguage ?? 'en',
      formLanguageConfidence: this.options.formLanguageConfidence ?? (call.formLanguage ? LABEL_MATCH_CONFIDENCE : GENERIC_CONFIDENCE),
      formCountry: call.formCountry ?? 'MY',
      formCountryConfidence: this.options.formCountryConfidence ?? (call.formCountry ? LABEL_MATCH_CONFIDENCE : GENERIC_CONFIDENCE),
    });
  }

  /**
   * Answers from fixtures/mock-analysis/legacy-register.json by Element_Id,
   * English fallback; unknown controls get a generic entry at confidence 0.5.
   * Submit and reset controls get no entry.
   */
  async analyzePage({ request }: PageAnalyzeCall): Promise<AiReply> {
    const lang = request.interfaceLanguage;
    const entries = request.pageModel.entries
      .filter((e) => e.control !== 'submit' && e.control !== 'reset')
      .map((e) => {
        const known = PAGE_TABLE[e.elementId];
        if (known) {
          const [humanLabel, question] = known.text[lang] ?? known.text['en']!;
          return { elementId: e.elementId, humanLabel, question, answerType: known.answerType, confidence: known.confidence };
        }
        const label = clip(e.labelText.trim() || e.name.trim() || e.elementId, 80);
        return {
          elementId: e.elementId,
          humanLabel: label,
          question: clip(t(lang, 'mock.question', { label }), 200),
          answerType: genericPageAnswerType(e),
          confidence: GENERIC_CONFIDENCE,
        };
      });
    return reply({ entries });
  }
}
