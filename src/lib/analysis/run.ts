/**
 * src/lib/analysis/run.ts
 *
 * Provider orchestration for the three AI jobs, with no HTTP or I/O, so every
 * branch is unit-testable with the mock provider.
 *
 * Analyze (requirements 5.4, 5.5, 5.5a, 5.6):
 *   call -> validate with AnalyzeResponseSchema -> on failure retry once ->
 *   on second failure return the fallback analysis (PDF labels and types,
 *   confidence 0). Unknown and duplicate entries are dropped and answer types
 *   are made compatible. Fields the model left out are simply absent; the
 *   browser marks them "fill this yourself" (reconcileAnalysis).
 *
 * Failures that are not about the reply (quota, rate limit, timeout,
 * unavailable) are not retried: they propagate as AiError for the route to map
 * to the fixture cache or an error response.
 */

import {
  AnalyzeResponseSchema,
  RetranslateResponseSchema,
  TranslateResponseSchema,
} from '../../shared/schemas.js';
import type {
  AnalyzeRequest,
  AnalyzeResponse,
  FieldAnalysis,
  RetranslateRequest,
  RetranslateResponse,
  TranslateRequest,
  TranslateResponse,
} from '../../shared/types.js';
import { AiError, type AiProvider, type AiReply, type AiUsage } from '../ai/interface.js';
import { fallbackAnalysis, reconcileAnalysis } from './reconcile.js';

export interface RunMeta {
  /** Provider calls made (1 or 2). */
  attempts: number;
  /** True when the fallback answer was used because both replies were invalid. */
  usedFallback: boolean;
  usage: AiUsage[];
}

export interface RunResult<T> {
  value: T;
  meta: RunMeta;
}

/** Call the provider up to twice until `parse` accepts the reply. */
async function withRetry<T>(
  call: () => Promise<AiReply>,
  parse: (value: unknown) => T | undefined,
): Promise<{ value: T | undefined; meta: RunMeta }> {
  const meta: RunMeta = { attempts: 0, usedFallback: false, usage: [] };
  for (let attempt = 0; attempt < 2; attempt++) {
    meta.attempts++;
    let reply: AiReply;
    try {
      reply = await call();
    } catch (err) {
      // An unparseable reply is retried like an invalid one; other failures propagate.
      if (err instanceof AiError && err.code === 'AI_INVALID_OUTPUT') continue;
      throw err;
    }
    meta.usage.push(reply.usage);
    const value = parse(reply.value);
    if (value !== undefined) return { value, meta };
  }
  return { value: undefined, meta };
}

export async function runAnalyze(
  provider: AiProvider,
  request: AnalyzeRequest,
  interfaceLanguageName: string,
): Promise<RunResult<AnalyzeResponse>> {
  const { value, meta } = await withRetry(
    () => provider.analyze({ request, interfaceLanguageName }),
    (v) => {
      const parsed = AnalyzeResponseSchema.safeParse(v);
      return parsed.success ? parsed.data : undefined;
    },
  );

  if (!value) {
    meta.usedFallback = true;
    return {
      meta,
      value: {
        fields: request.fields.map(fallbackAnalysis),
        formLanguage: request.detectedFormLanguage || 'en',
        formLanguageConfidence: 0,
        formCountry: request.detectedCountry ?? 'MY',
        formCountryConfidence: 0,
      },
    };
  }

  // Requirement 5.5 / 5.5a: keep only first entries for submitted fields, with compatible types.
  const reconciled = reconcileAnalysis(request.fields, value.fields);
  const fields: FieldAnalysis[] = reconciled.fields.flatMap((f) => (f.analysis ? [f.analysis] : []));
  return { meta, value: { ...value, fields, servedFromCache: false } };
}

export async function runRetranslate(
  provider: AiProvider,
  request: RetranslateRequest,
  targetLanguageName: string,
): Promise<RunResult<RetranslateResponse>> {
  const submitted = new Set(request.fields.map((f) => f.fieldId));
  const { value, meta } = await withRetry(
    () => provider.retranslate({ request, targetLanguageName }),
    (v) => {
      const parsed = RetranslateResponseSchema.safeParse(v);
      return parsed.success ? parsed.data : undefined;
    },
  );
  if (!value) throw new AiError('AI_INVALID_OUTPUT', 'Retranslation reply was invalid twice');

  // Only submitted fields, first entry wins; missing ones keep their current wording in the browser.
  const seen = new Set<string>();
  const fields = value.fields.filter((f) => {
    if (!submitted.has(f.fieldId) || seen.has(f.fieldId)) return false;
    seen.add(f.fieldId);
    return true;
  });
  return { meta, value: { fields } };
}

export async function runTranslate(
  provider: AiProvider,
  request: TranslateRequest,
  sourceLanguageName: string,
  targetLanguageName: string,
): Promise<RunResult<TranslateResponse>> {
  const { value, meta } = await withRetry(
    () => provider.translate({ request, sourceLanguageName, targetLanguageName }),
    (v) => {
      const parsed = TranslateResponseSchema.safeParse(v);
      return parsed.success ? parsed.data : undefined;
    },
  );
  if (!value) throw new AiError('AI_INVALID_OUTPUT', 'Translation reply was invalid twice');
  return { meta, value };
}
