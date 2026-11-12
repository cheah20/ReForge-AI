/**
 * src/shared/page-schemas.ts
 *
 * Zod schemas for AccessForge (accessforge-skeleton task 2.1), shared by the
 * Worker and the browser. Kept apart from schemas.ts so FormBridge's file stays
 * as it is; the answer-type enum is reused by import.
 *
 * Every string and array is bounded. Model text (labels, questions) is
 * untrusted: the schemas cap its length and require visible text, and make no
 * claim about its content. Safety comes from how it is used (rendered as text
 * only, never as a URL, selector or action).
 *
 * The re-translation schemas belong to Slice 2 (task 25.1) and are not here.
 */

import { z } from 'zod';
import { AnswerTypeSchema } from './schemas.js';

const Hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const Lang = z.string().min(2).max(20);
const Text200 = z.string().max(200);

export const ElementIdSchema = z.string().min(1).max(256);

export const ControlTypeSchema = z.enum(['text', 'select', 'radio', 'checkbox', 'submit', 'reset', 'unsupported']);

export const PageOptionSchema = z
  .object({
    value: z.string().max(200),
    text: Text200,
    /** Present on every radio option; a member of the Page_Model. */
    elementId: ElementIdSchema.optional(),
  })
  .strict();

export const PageEntrySchema = z
  .object({
    elementId: ElementIdSchema,
    control: ControlTypeSchema,
    name: z.string().max(100),
    id: z.string().max(100),
    labelText: Text200,
    neighbourText: Text200,
    nearbyText: Text200,
    /** Checkbox only, else "" (decision F). */
    nextRowText: Text200,
    options: z.array(PageOptionSchema).max(50),
    /** A select has an option with value "" (not listed in options). */
    hasEmptyOption: z.boolean(),
    checkboxValue: z.string().max(200).optional(),
    required: z.boolean(),
    maxLength: z.number().int().min(0).max(524288).nullable(),
    position: z.number().int().min(0),
    /** Requirement 5.8 (Slice 2); always false in Slice 1. */
    duplicateId: z.boolean(),
  })
  .strict();

export const PageModelSchema = z
  .object({
    path: z.literal('/legacy/register'),
    pageVersion: Hex64,
    entries: z.array(PageEntrySchema).min(1).max(50),
  })
  .strict();

/** Natural-language text from the model. Untrusted: length-capped and non-blank only. */
const ModelText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((s) => s.trim().length > 0, 'blank');

/** One plan entry: the closed property set of Requirement 6.6. */
export const PagePlanEntrySchema = z
  .object({
    elementId: ElementIdSchema,
    humanLabel: ModelText(80),
    question: ModelText(200),
    answerType: AnswerTypeSchema,
    confidence: z.number().min(0).max(1),
  })
  .strict();

/** Envelope of a model reply: entries are validated one by one, so one bad entry is dropped, not the reply. */
export const PagePlanReplySchema = z.object({ entries: z.array(z.unknown()).max(100) });

/** 'heuristic' is Slice 2. */
export const AnalysisModeSchema = z.enum(['live', 'mock', 'cached', 'heuristic']);

export const PageAnalyzeRequestSchema = z
  .object({
    pageModel: PageModelSchema,
    interfaceLanguage: Lang,
  })
  .strict();

export const PageAnalyzeResponseSchema = z
  .object({
    analysisMode: AnalysisModeSchema,
    /** Already passed the Plan_Validator. */
    entries: z.array(PagePlanEntrySchema).max(50),
  })
  .strict();

export const PrecomputedPagePlanSchema = z
  .object({
    pageVersion: Hex64,
    interfaceLanguage: Lang,
    entries: z.array(PagePlanEntrySchema).max(50),
  })
  .strict();

/** The only actions the Executor knows. There is no "submit" kind: confirming is the user's own press. */
export const ActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fill'), elementId: ElementIdSchema, value: z.string() }).strict(),
  z.object({ kind: z.literal('select'), elementId: ElementIdSchema, value: z.string() }).strict(),
  z.object({ kind: z.literal('check'), elementId: ElementIdSchema, checked: z.boolean() }).strict(),
  z.object({ kind: z.literal('click'), elementId: ElementIdSchema }).strict(),
]);

export type ElementId = z.infer<typeof ElementIdSchema>;
export type ControlType = z.infer<typeof ControlTypeSchema>;
export type PageOption = z.infer<typeof PageOptionSchema>;
export type PageEntry = z.infer<typeof PageEntrySchema>;
export type PageModel = z.infer<typeof PageModelSchema>;
export type PagePlanEntry = z.infer<typeof PagePlanEntrySchema>;
export type PagePlanReply = z.infer<typeof PagePlanReplySchema>;
export type AnalysisMode = z.infer<typeof AnalysisModeSchema>;
export type PageAnalyzeRequest = z.infer<typeof PageAnalyzeRequestSchema>;
export type PageAnalyzeResponse = z.infer<typeof PageAnalyzeResponseSchema>;
export type PrecomputedPagePlan = z.infer<typeof PrecomputedPagePlanSchema>;
export type Action = z.infer<typeof ActionSchema>;
