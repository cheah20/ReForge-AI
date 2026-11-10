/**
 * src/shared/schemas.ts
 *
 * Zod schemas shared between the Cloudflare Worker and the browser frontend.
 * Both API request validation and AI response validation use these schemas.
 * Types are derived in types.ts via z.infer<>.
 */

import { z } from 'zod';

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

export const FieldEvidenceSchema = z.object({
  fieldId: z.string().min(1).max(256),
  tooltip: z.string().max(200).optional(),
  fieldType: z.enum(['text', 'checkbox', 'radio', 'dropdown', 'signature']),
  options: z.array(FieldOptionSchema).max(50).optional(),
  required: z.boolean(),
  readOnly: z.boolean(),
  maxLength: z.number().int().positive().max(32767).optional(),
  multiline: z.boolean().optional(),
  widgets: z.array(WidgetSchema).min(1).max(20),
  hasValue: z.boolean(),
});

// ---------------------------------------------------------------------------
// Field analysis — AI response for a single field
// ---------------------------------------------------------------------------

export const FieldAnalysisSchema = z.object({
  fieldId: z.string().min(1).max(256),
  humanLabel: z.string().min(1).max(40),   // enforced: ≤ 40 chars
  question: z.string().min(1).max(120),    // enforced: ≤ 120 chars
  answerType: z.enum([
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
  ]),
  confidence: z.number().min(0).max(1),
});

// ---------------------------------------------------------------------------
// Analyze endpoint
// ---------------------------------------------------------------------------

export const AnalyzeRequestSchema = z.object({
  /** SHA-256 hex of the PDF bytes — used for analysis caching */
  contentHash: z.string().length(64),
  /** At most 30 fields per batch (design decision) */
  fields: z.array(FieldEvidenceSchema).min(1).max(30),
  interfaceLanguage: z.string().min(2).max(20),
  detectedFormLanguage: z.string().max(20).optional(),
  /** ISO 3166-1 alpha-2 */
  detectedCountry: z.string().length(2).optional(),
});

export const AnalyzeResponseSchema = z.object({
  fields: z.array(FieldAnalysisSchema),
  formLanguage: z.string().max(20),
  formLanguageConfidence: z.number().min(0).max(1),
  formCountry: z.string().max(2),
  formCountryConfidence: z.number().min(0).max(1),
  /** true when response was served from precomputed fixture cache */
  servedFromCache: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Retranslate endpoint (language switch — retranslates labels/questions only)
// ---------------------------------------------------------------------------

export const RetranslateRequestSchema = z.object({
  contentHash: z.string().length(64),
  fields: z
    .array(z.object({ fieldId: z.string().min(1).max(256) }))
    .min(1)
    .max(150),
  targetLanguage: z.string().min(2).max(20),
});

export const RetranslateResponseSchema = z.object({
  fields: z.array(
    z.object({
      fieldId: z.string(),
      humanLabel: z.string().max(40),
      question: z.string().max(120),
    }),
  ),
});

// ---------------------------------------------------------------------------
// Translate endpoint (user-triggered description translation)
// ---------------------------------------------------------------------------

export const TranslateRequestSchema = z.object({
  text: z.string().min(1).max(2000),
  sourceLanguage: z.string().min(2).max(20),
  targetLanguage: z.string().min(2).max(20),
});

export const TranslateResponseSchema = z.object({
  translation: z.string(),
});

// ---------------------------------------------------------------------------
// Error shape (all error responses use this)
// ---------------------------------------------------------------------------

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
