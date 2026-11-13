/**
 * src/lib/analysis/run-labels.ts
 *
 * Label analysis for the FormBridge Document_Path (formbridge-any-document
 * Requirements 13.5 to 13.7 and 13.11, design Q2). No HTTP and no I/O, so
 * every branch is unit-testable with a scripted provider.
 *
 *   Kept_Labels in page and reading order -> batches of at most 30 ->
 *   per batch: call, check the envelope, retry once after an invalid reply or
 *   a timeout -> sanitise the entries one by one -> combine detection.
 *
 * A batch that fails twice adds its Label_Ids to `failedLabelIds`; the browser
 * asks those in Original_Label_Mode. Only when every batch failed does the run
 * throw, so the route answers 503 AI_UNAVAILABLE (504 AI_TIMEOUT when every
 * failure was a timeout).
 */

import { LabelAnalysisSchema, LabelBatchReplyEnvelopeSchema } from '../../shared/schemas.js';
import type { KeptLabel, LabelAnalysis, LabelAnalysisRequest, LabelAnalysisResponse, LabelBatchReplyEnvelope } from '../../shared/types.js';
import { AiError, type AiProvider, type AiReply } from '../ai/interface.js';
import { combineVotes } from './detection.js';
import type { RunMeta, RunResult } from './run.js';

/** Batch size of the existing analysis (design: 30 fields per batch). */
export const LABEL_BATCH_SIZE = 30;

export interface LabelRunLanguages {
  interfaceLanguageName: string;
  formLanguageName?: string;
}

/** Page order, then reading order (Requirement 4.6). */
export function orderLabels(labels: readonly KeptLabel[]): KeptLabel[] {
  return [...labels].sort((a, b) => a.pageNumber - b.pageNumber || a.readingOrder - b.readingOrder);
}

export function labelBatches(labels: readonly KeptLabel[], size = LABEL_BATCH_SIZE): KeptLabel[][] {
  const ordered = orderLabels(labels);
  const batches: KeptLabel[][] = [];
  for (let i = 0; i < ordered.length; i += size) batches.push(ordered.slice(i, i + size));
  return batches;
}


/**
 * Requirements 13.5 and 13.6. Each entry is checked on its own:
 * - a failing `explanation` or `example` is dropped and the rest is kept;
 * - an entry that still fails the schema (blank text, over-long text, an answer
 *   type outside the eight allowed, a confidence outside 0..1) is dropped;
 * - an entry whose `fieldId` was not in the batch, and every entry after the
 *   first for the same `fieldId`, is dropped.
 * Unknown keys are not carried over (the schema strips them).
 */
export function sanitizeLabelEntries(entries: readonly unknown[], batchIds: readonly string[]): LabelAnalysis[] {
  const allowed = new Set(batchIds);
  const seen = new Set<string>();
  const kept: LabelAnalysis[] = [];
  for (const raw of entries) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
    const entry: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
    if (!LabelAnalysisSchema.shape.explanation.safeParse(entry['explanation']).success) delete entry['explanation'];
    if (!LabelAnalysisSchema.shape.example.safeParse(entry['example']).success) delete entry['example'];
    const parsed = LabelAnalysisSchema.safeParse(entry);
    if (!parsed.success) continue;
    const id = parsed.data.fieldId;
    if (!allowed.has(id) || seen.has(id)) continue;
    seen.add(id);
    kept.push(parsed.data);
  }
  return kept;
}

type BatchOutcome =
  | { ok: true; envelope: LabelBatchReplyEnvelope; fields: LabelAnalysis[] }
  | { ok: false; reason: 'invalid' | 'timeout' | 'stop' };

/** Failures that end the whole run: every later batch would fail the same way. */
function stopsRun(err: AiError): boolean {
  return err.code === 'AI_QUOTA' || err.code === 'AI_RATE_LIMITED';
}

async function runBatch(
  provider: AiProvider,
  batch: KeptLabel[],
  request: LabelAnalysisRequest,
  languages: LabelRunLanguages,
  meta: RunMeta,
): Promise<BatchOutcome> {
  let last: 'invalid' | 'timeout' = 'invalid';
  for (let attempt = 0; attempt < 2; attempt++) {
    meta.attempts++;
    let reply: AiReply;
    try {
      reply = await provider.analyzeLabels({
        labels: batch,
        interfaceLanguage: request.interfaceLanguage,
        interfaceLanguageName: languages.interfaceLanguageName,
        ...(request.formLanguage ? { formLanguage: request.formLanguage } : {}),
        ...(languages.formLanguageName ? { formLanguageName: languages.formLanguageName } : {}),
        ...(request.formCountry ? { formCountry: request.formCountry } : {}),
      });
    } catch (err) {
      if (!(err instanceof AiError)) throw err;
      if (err.code === 'AI_INVALID_OUTPUT') {
        last = 'invalid';
        continue;
      }
      if (err.code === 'AI_TIMEOUT') {
        last = 'timeout';
        continue;
      }
      if (stopsRun(err)) return { ok: false, reason: 'stop' };
      // AI_UNAVAILABLE: not about the reply, so it is not retried.
      return { ok: false, reason: 'invalid' };
    }
    meta.usage.push(reply.usage);
    const envelope = LabelBatchReplyEnvelopeSchema.safeParse(reply.value);
    if (!envelope.success) {
      last = 'invalid';
      continue;
    }
    return {
      ok: true,
      envelope: envelope.data,
      fields: sanitizeLabelEntries(envelope.data.fields, batch.map((l) => l.labelId)),
    };
  }
  return { ok: false, reason: last };
}

export async function runAnalyzeLabels(
  provider: AiProvider,
  request: LabelAnalysisRequest,
  languages: LabelRunLanguages,
): Promise<RunResult<LabelAnalysisResponse>> {
  const meta: RunMeta = { attempts: 0, usedFallback: false, usage: [] };
  const fields: LabelAnalysis[] = [];
  const failedLabelIds: string[] = [];
  const envelopes: LabelBatchReplyEnvelope[] = [];
  const failures: Array<'invalid' | 'timeout' | 'stop'> = [];
  let stopped = false;

  for (const batch of labelBatches(request.labels)) {
    const outcome: BatchOutcome = stopped ? { ok: false, reason: 'stop' } : await runBatch(provider, batch, request, languages, meta);
    if (outcome.ok) {
      envelopes.push(outcome.envelope);
      fields.push(...outcome.fields);
      continue;
    }
    if (outcome.reason === 'stop') stopped = true;
    failures.push(outcome.reason);
    failedLabelIds.push(...batch.map((l) => l.labelId));
  }

  if (envelopes.length === 0) {
    const allTimeouts = failures.length > 0 && failures.every((f) => f === 'timeout');
    throw new AiError(allTimeouts ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE', 'Every label batch failed');
  }

  const lang = combineVotes(envelopes.map((e) => ({ value: e.formLanguage, confidence: e.formLanguageConfidence })));
  const country = combineVotes(envelopes.map((e) => ({ value: e.formCountry.toUpperCase(), confidence: e.formCountryConfidence })));
  return {
    meta,
    value: {
      fields,
      formLanguage: lang.value,
      formLanguageConfidence: lang.confidence,
      formCountry: country.value,
      formCountryConfidence: country.confidence,
      failedLabelIds,
    },
  };
}
