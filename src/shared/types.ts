/**
 * src/shared/types.ts
 *
 * TypeScript types derived from Zod schemas. Import these for compile-time
 * type safety; the schemas in schemas.ts handle runtime validation.
 */

import type { z } from 'zod';
import type {
  FieldOptionSchema,
  WidgetSchema,
  FieldEvidenceSchema,
  FieldAnalysisSchema,
  AnalyzeRequestSchema,
  AnalyzeResponseSchema,
  RetranslateRequestSchema,
  RetranslateResponseSchema,
  TranslateRequestSchema,
  TranslateResponseSchema,
  ApiErrorSchema,
  LabelAnswerTypeSchema,
  KeptLabelSchema,
  LabelAnalysisRequestSchema,
  LabelAnalysisSchema,
  LabelBatchReplyEnvelopeSchema,
  LabelAnalysisResponseSchema,
} from './schemas.js';

export type FieldOption = z.infer<typeof FieldOptionSchema>;
export type Widget = z.infer<typeof WidgetSchema>;
export type FieldEvidence = z.infer<typeof FieldEvidenceSchema>;
export type FieldAnalysis = z.infer<typeof FieldAnalysisSchema>;
export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;
export type AnalyzeResponse = z.infer<typeof AnalyzeResponseSchema>;
export type RetranslateRequest = z.infer<typeof RetranslateRequestSchema>;
export type RetranslateResponse = z.infer<typeof RetranslateResponseSchema>;
export type TranslateRequest = z.infer<typeof TranslateRequestSchema>;
export type TranslateResponse = z.infer<typeof TranslateResponseSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type LabelAnswerType = z.infer<typeof LabelAnswerTypeSchema>;
export type KeptLabel = z.infer<typeof KeptLabelSchema>;
export type LabelAnalysisRequest = z.infer<typeof LabelAnalysisRequestSchema>;
export type LabelAnalysis = z.infer<typeof LabelAnalysisSchema>;
export type LabelBatchReplyEnvelope = z.infer<typeof LabelBatchReplyEnvelopeSchema>;
export type LabelAnalysisResponse = z.infer<typeof LabelAnalysisResponseSchema>;

/** Answer types that the AI can assign to a field */
export type AnswerType =
  | 'text'
  | 'ic'
  | 'phone'
  | 'postcode'
  | 'date'
  | 'email'
  | 'checkbox'
  | 'radio'
  | 'dropdown'
  | 'description'
  | 'signature';

/** PDF field types that come from AcroForm extraction */
export type PdfFieldType = 'text' | 'checkbox' | 'radio' | 'dropdown' | 'signature';
