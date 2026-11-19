/**
 * src/frontend/document/label-client.ts
 *
 * Sends the kept labels to POST /api/documents/analyze-labels, one batch after
 * another (formbridge-any-document Requirements 13.8, 13.11, 14.1). Whatever
 * goes wrong, the user is never stuck: a batch that fails is asked in
 * Original_Label_Mode, and when every batch fails the whole form is. There is
 * no automatic retry here (the Worker already retries once). Results and
 * errors carry codes only, never label text.
 */

import { LabelAnalysisResponseSchema, ApiErrorSchema } from '../../shared/schemas.js';
import type { LabelAnalysis, LabelAnalysisRequest } from '../../shared/types.js';
import { combineVotes } from '../../lib/analysis/detection.js';

export type FailureReason = 'network' | 'timeout' | 'quota' | 'unavailable';

export type LabelClientResult =
  | {
      mode: 'ai';
      analyses: Map<string, LabelAnalysis>;
      /** Label_Ids to ask in Original_Label_Mode (their batch failed, or the reply left them out). */
      failedLabelIds: string[];
      detection: { formLanguage: string; formLanguageConfidence: number; formCountry: string; formCountryConfidence: number };
      /** True when the Worker answered with the mock provider (Demo mode banner). */
      demoMode: boolean;
    }
  | { mode: 'original-label'; reason: FailureReason; failedLabelIds: string[] };

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

const AI_MODE_HEADER = 'x-reforge-ai-mode';
export const ANALYZE_LABELS_PATH = '/api/documents/analyze-labels';

class BatchFailure extends Error {
  constructor(readonly reason: FailureReason) {
    super(reason);
  }
}

function reasonFor(code: string): FailureReason {
  if (code === 'AI_TIMEOUT') return 'timeout';
  if (code === 'RATE_LIMITED') return 'quota';
  if (code === 'NETWORK_ERROR') return 'network';
  return 'unavailable';
}

async function postBatch(fetchFn: FetchFn, request: LabelAnalysisRequest) {
  let response: Response;
  try {
    response = await fetchFn(ANALYZE_LABELS_PATH, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
  } catch {
    throw new BatchFailure('network');
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new BatchFailure(response.ok ? 'unavailable' : 'network');
  }
  if (!response.ok) {
    const err = ApiErrorSchema.safeParse(payload);
    throw new BatchFailure(err.success ? reasonFor(err.data.error.code) : 'unavailable');
  }
  const parsed = LabelAnalysisResponseSchema.safeParse(payload);
  if (!parsed.success) throw new BatchFailure('unavailable');
  return { data: parsed.data, mock: response.headers.get(AI_MODE_HEADER) === 'mock' };
}

export async function analyzeKeptLabels(
  requests: readonly LabelAnalysisRequest[],
  fetchFn: FetchFn,
  onProgress?: (batch: number, total: number) => void,
): Promise<LabelClientResult> {
  const analyses = new Map<string, LabelAnalysis>();
  const failedLabelIds: string[] = [];
  const langVotes: Array<{ value: string; confidence: number }> = [];
  const countryVotes: Array<{ value: string; confidence: number }> = [];
  let demoMode = false;
  let succeeded = 0;
  let firstFailure: FailureReason | null = null;
  let stop = false;

  for (const [i, request] of requests.entries()) {
    const ids = request.labels.map((l) => l.labelId);
    if (stop) {
      failedLabelIds.push(...ids);
      continue;
    }
    onProgress?.(i + 1, requests.length);
    try {
      const { data, mock } = await postBatch(fetchFn, request);
      succeeded++;
      demoMode ||= mock;
      const asked = new Set(ids);
      for (const f of data.fields) if (asked.has(f.fieldId) && !analyses.has(f.fieldId)) analyses.set(f.fieldId, f);
      failedLabelIds.push(...data.failedLabelIds.filter((id) => asked.has(id)));
      langVotes.push({ value: data.formLanguage, confidence: data.formLanguageConfidence });
      countryVotes.push({ value: data.formCountry.toUpperCase(), confidence: data.formCountryConfidence });
    } catch (e) {
      if (!(e instanceof BatchFailure)) throw e;
      firstFailure ??= e.reason;
      failedLabelIds.push(...ids);
      // A used-up quota or a full rate limit would fail every later batch the same way.
      if (e.reason === 'quota') stop = true;
    }
  }

  if (succeeded === 0) return { mode: 'original-label', reason: firstFailure ?? 'unavailable', failedLabelIds };
  // A label the reply left out is asked in Original_Label_Mode too (13.8).
  const allIds = requests.flatMap((r) => r.labels.map((l) => l.labelId));
  const missing = allIds.filter((id) => !analyses.has(id) && !failedLabelIds.includes(id));
  const lang = combineVotes(langVotes);
  const country = combineVotes(countryVotes);
  return {
    mode: 'ai',
    analyses,
    failedLabelIds: [...failedLabelIds, ...missing],
    detection: { formLanguage: lang.value, formLanguageConfidence: lang.confidence, formCountry: country.value, formCountryConfidence: country.confidence },
    demoMode,
  };
}
