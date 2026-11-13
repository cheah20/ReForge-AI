/**
 * src/shared/schemas.ts
 *
 * Zod schemas shared between the Cloudflare Worker and the browser frontend.
 * Both API request validation and AI response validation use these schemas.
 * Types are derived in types.ts via z.infer<>.
 *
 * Every string and array is bounded, in requests and in responses, so neither
 * a client nor a model reply can push unbounded data through the API.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared bounds
// ---------------------------------------------------------------------------

/** Maximum fields per analyze batch (design: 30 fields per batch). */
export const MAX_FIELDS_PER_BATCH = 30;
/** Maximum fields in one form (rejection limit). */
export const MAX_FIELDS_PER_FORM = 150;

const ContentHashSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'contentHash must be 64 lowercase hex characters');

const LanguageTagSchema = z.string().min(2).max(20);
const FieldIdSchema = z.string().min(1).max(256);

// ---------------------------------------------------------------------------
// Primitive building blocks
// ---------------------------------------------------------------------------

export const FieldOptionSchema = z.object({
  exportValue: z.string().min(1).max(200),
  displayLabel: z.string().min(1).max(200),
});

export const WidgetSchema = z.object({
  pageNumber: z.number().int().min(1),
  bbox: z.object({
    left: z.number(),
    top: z.number(),
    right: z.number(),
    bottom: z.number(),
  }),
  pageSnippet: z.string().max(200),
});

// ---------------------------------------------------------------------------
// Field evidence — extraction output, sent to /api/forms/analyze
// ---------------------------------------------------------------------------

export const FieldEvidenceSchema = z
  .object({
    fieldId: FieldIdSchema,
    tooltip: z.string().max(200).optional(),
    fieldType: z.enum(['text', 'checkbox', 'radio', 'dropdown', 'signature']),
    options: z.array(FieldOptionSchema).max(50).optional(),
    required: z.boolean(),
    readOnly: z.boolean(),
    maxLength: z.number().int().positive().max(32767).optional(),
    multiline: z.boolean().optional(),
    /** Multi-select choice field: the wizard shows it as "fill this yourself". */
    multiSelect: z.boolean().optional(),
    /**
     * No widget of this field could be placed on a page, so its location is
     * unknown. The wizard shows it as "fill this yourself" and `widgets` may be empty.
     */
    unresolvedPage: z.boolean().optional(),
    /** Duplicate nodes disagree on the field type: "fill this yourself". */
    unsupported: z.boolean().optional(),
    /**
     * The PDF name is longer than 256 characters. `fieldId` is then a local
     * identifier, the field is "fill this yourself" and is never sent to analysis.
     */
    idTooLong: z.boolean().optional(),
    /**
     * The choice field had an option with an empty export value (a "please
     * choose" placeholder). It is dropped from `options`; a blank selection is
     * never written as an answer.
     */
    hasPlaceholderOption: z.boolean().optional(),
    widgets: z.array(WidgetSchema).max(20),
    hasValue: z.boolean(),
  })
  .refine((f) => f.widgets.length > 0 || f.unresolvedPage === true, {
    message: 'A field needs at least one widget unless its page is unresolved',
    path: ['widgets'],
  });

// ---------------------------------------------------------------------------
// Field analysis — AI response for a single field
// ---------------------------------------------------------------------------

/** Non-blank text: at least one non-whitespace character. */
const visibleText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((s) => s.trim().length > 0, 'must contain visible text');

/** Answer types the AI can assign to a field. Also imported by the AccessForge page schemas. */
export const AnswerTypeSchema = z.enum([
  'text',
  'ic',
  'phone',
  'postcode',
  'date',
  'email',
  'checkbox',
  'radio',
  'dropdown',
  'description',
  'signature',
]);

export const FieldAnalysisSchema = z.object({
  fieldId: FieldIdSchema,
  humanLabel: visibleText(40), // enforced: ≤ 40 chars
  question: visibleText(120), // enforced: ≤ 120 chars
  answerType: AnswerTypeSchema,
  confidence: z.number().min(0).max(1),
});

// ---------------------------------------------------------------------------
// Analyze endpoint
// ---------------------------------------------------------------------------

export const AnalyzeRequestSchema = z.object({
  /** SHA-256 hex of the PDF bytes, used for analysis caching */
  contentHash: ContentHashSchema,
  fields: z.array(FieldEvidenceSchema).min(1).max(MAX_FIELDS_PER_BATCH),
  interfaceLanguage: LanguageTagSchema,
  detectedFormLanguage: z.string().max(20).optional(),
  /** ISO 3166-1 alpha-2 */
  detectedCountry: z.string().length(2).optional(),
});

export const AnalyzeResponseSchema = z.object({
  fields: z.array(FieldAnalysisSchema).max(MAX_FIELDS_PER_BATCH),
  formLanguage: LanguageTagSchema,
  formLanguageConfidence: z.number().min(0).max(1),
  /** ISO 3166-1 alpha-2 */
  formCountry: z.string().length(2),
  formCountryConfidence: z.number().min(0).max(1),
  /** true when the response was served from the precomputed fixture cache */
  servedFromCache: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Retranslate endpoint (language switch: retranslates labels and questions only)
// ---------------------------------------------------------------------------

/**
 * The Worker is stateless, so the browser sends the current label and question
 * of each field (AI-written wording, never user answers). Batched like analyze:
 * at most 30 fields per request.
 */
export const RetranslateRequestSchema = z.object({
  contentHash: ContentHashSchema,
  fields: z
    .array(
      z.object({
        fieldId: FieldIdSchema,
        humanLabel: visibleText(40),
        question: visibleText(120),
      }),
    )
    .min(1)
    .max(MAX_FIELDS_PER_BATCH),
  targetLanguage: LanguageTagSchema,
});

export const RetranslateResponseSchema = z.object({
  fields: z
    .array(
      z.object({
        fieldId: FieldIdSchema,
        humanLabel: visibleText(40),
        question: visibleText(120),
      }),
    )
    .max(MAX_FIELDS_PER_BATCH),
});

// ---------------------------------------------------------------------------
// Translate endpoint (user-triggered description translation)
// ---------------------------------------------------------------------------

export const TranslateRequestSchema = z.object({
  text: z.string().min(1).max(2000),
  sourceLanguage: LanguageTagSchema,
  targetLanguage: LanguageTagSchema,
});

/** Translations may run longer than the source (e.g. Chinese to Malay), so the bound is 2x. */
export const TranslateResponseSchema = z.object({
  translation: z.string().min(1).max(4000),
});

// ---------------------------------------------------------------------------
// Error shape (all error responses use this)
// ---------------------------------------------------------------------------

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1).max(64),
    message: z.string().min(1).max(500),
  }),
});

// ---------------------------------------------------------------------------
// Label analysis endpoint (FormBridge Document_Path, POST /api/documents/analyze-labels)
// ---------------------------------------------------------------------------

/** Label_Id `p<page>-l<reading order>`: pages 1..5, reading-order index 0..9999, no leading zeros. */
export const LABEL_ID_PATTERN = /^p[1-5]-l(?:0|[1-9]\d{0,3})$/;

/** Answer types the AI can assign to a Kept_Label (no choice types: a document has no options). */
export const LabelAnswerTypeSchema = z.enum([
  'text',
  'ic',
  'phone',
  'postcode',
  'date',
  'email',
  'description',
  'signature',
]);

/** One label the user kept on the Label_Review. Strict: no box, image, value or other text. */
export const KeptLabelSchema = z
  .object({
    labelId: z.string().regex(LABEL_ID_PATTERN),
    text: visibleText(200), // KEPT_LABEL_MAX_CHARS
    pageNumber: z.number().int().min(1).max(5),
    readingOrder: z.number().int().min(0).max(9999),
  })
  .strict();

export const LabelAnalysisRequestSchema = z
  .object({
    labels: z.array(KeptLabelSchema).min(1).max(150), // MAX_KEPT_LABELS
    interfaceLanguage: LanguageTagSchema,
    formLanguage: LanguageTagSchema.optional(),
    formCountry: z.string().regex(/^[A-Z]{2}$/).optional(),
  })
  .strict()
  .refine((r) => new Set(r.labels.map((l) => l.labelId)).size === r.labels.length, {
    message: 'labelId values must be unique',
    path: ['labels'],
  })
  .refine((r) => r.labels.every((l) => l.labelId === `p${l.pageNumber}-l${l.readingOrder}`), {
    message: 'labelId must match pageNumber and readingOrder',
    path: ['labels'],
  });

/** Same shape as FieldAnalysisSchema, with the Label_Id in the fieldId position. */
export const LabelAnalysisSchema = FieldAnalysisSchema.extend({
  fieldId: z.string().regex(LABEL_ID_PATTERN),
  answerType: LabelAnswerTypeSchema,
  explanation: visibleText(200).optional(),
  example: visibleText(60).optional(),
});

/** What the model must return for one batch (the envelope is checked; entries are checked one by one). */
export const LabelBatchReplyEnvelopeSchema = z.object({
  fields: z.array(z.unknown()).max(30),
  formLanguage: LanguageTagSchema,
  formLanguageConfidence: z.number().min(0).max(1),
  formCountry: z.string().length(2),
  formCountryConfidence: z.number().min(0).max(1),
});

export const LabelAnalysisResponseSchema = z.object({
  fields: z.array(LabelAnalysisSchema).max(150),
  formLanguage: LanguageTagSchema,
  formLanguageConfidence: z.number().min(0).max(1),
  formCountry: z.string().length(2),
  formCountryConfidence: z.number().min(0).max(1),
  /** Label_Ids of batches that failed twice; the browser asks those in Original_Label_Mode (13.8). */
  failedLabelIds: z.array(z.string().regex(LABEL_ID_PATTERN)).max(150),
});
