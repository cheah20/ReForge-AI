/**
 * src/frontend/state.ts
 *
 * Browser session state and the analysis orchestration (task 26).
 *
 * - The session lives in memory only: no web storage, database or cookies
 *   (requirement 11.1).
 * - `analyzeForm` sends the field evidence in batches of 30, one batch after
 *   another, combines the detected form language and country across batches,
 *   and caches the result by `${contentHash}:${interfaceLanguage}` (5.1, 5.3, 5.8).
 * - `switchLanguage` reuses the cached structure and only re-translates labels
 *   and questions; answers are never touched and never sent (5.8, 11.1).
 * - `activeAnalysisId` guards against stale replies: a reply that arrives
 *   after a re-upload or another language switch is dropped.
 * - `translateDescription` is the only path that sends a user answer to the
 *   backend. The UI calls it only from the translate button (8.6, 11.1).
 *
 * The store is a tiny observable so React can read it with
 * `useSyncExternalStore`, while the async functions always see the latest
 * state when a reply arrives.
 */

import { batchFields, BATCH_SIZE } from '../lib/batch.js';
import {
  LOW_CONFIDENCE_THRESHOLD,
  needsAnalysis,
  reconcileAnalysis,
  type FieldStatus,
} from '../lib/analysis/reconcile.js';
import type { AnalyzeResponse, AnswerType, FieldAnalysis, FieldEvidence } from '../shared/types.js';
import type { DateFormat } from '../packs/country/dates.js';
import type { ApiClient } from './api.js';

export { batchFields, BATCH_SIZE };

export interface DescriptionTranslation {
  /** The answer text the translation was made from. */
  source: string;
  sourceLanguage: string;
  targetLanguage: string;
  /** Machine translation, shown for the user to read, edit and approve. */
  text: string;
  /** Only an approved translation may be written to the PDF (8.6). */
  approved: boolean;
}

export interface FieldState {
  evidence: FieldEvidence;
  analysis: FieldAnalysis | null;
  status: FieldStatus;
  rawAnswer?: string;
  normalizedOutput?: string;
  skipped: boolean;
  userOverrideAnswerType?: AnswerType;
  /** Date format the user confirmed for this field (requirement 7.5). */
  dateFormat?: DateFormat;
  translation?: DescriptionTranslation;
}

/** Detected form language and country, before or after the user confirms them. */
export interface Detection {
  formLanguage: string;
  formLanguageConfidence: number;
  formCountry: string;
  formCountryConfidence: number;
}

export interface SessionState {
  /** BCP 47 tag of the language the user reads. */
  interfaceLanguage: string;
  /** BCP 47 tag of the language the form expects answers in, confirmed by the user when unsure. */
  formLanguage: string;
  /** ISO 3166-1 alpha-2; picks the country pack. */
  formCountry: string;
  /** SHA-256 hex of the uploaded PDF; null before an upload. */
  contentHash: string | null;
  fields: FieldState[];
  /** Keyed by `${contentHash}:${interfaceLanguage}`. */
  analysisCache: Map<string, AnalyzeResponse>;
  currentStep: number;
  /** True when any reply came from the mock provider (Demo mode banner). */
  demoMode: boolean;
  pendingTranslationFieldId?: string;
  /** Id of the analysis or language switch whose replies are still wanted; null when idle. */
  activeAnalysisId: string | null;
  detection: Detection | null;
  /** True when the user must confirm the form language and country before the questions. */
  needsConfirmation: boolean;
}

export interface SessionStore {
  get(): SessionState;
  set(update: (state: SessionState) => SessionState): void;
  subscribe(listener: () => void): () => void;
}

export function createSession(interfaceLanguage = 'en'): SessionState {
  return {
    interfaceLanguage,
    formLanguage: '',
    formCountry: '',
    contentHash: null,
    fields: [],
    analysisCache: new Map(),
    currentStep: 0,
    demoMode: false,
    activeAnalysisId: null,
    detection: null,
    needsConfirmation: false,
  };
}

export function createSessionStore(initial: SessionState = createSession()): SessionStore {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(update) {
      state = update(state);
      for (const l of listeners) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function cacheKey(contentHash: string, interfaceLanguage: string): string {
  return `${contentHash}:${interfaceLanguage}`;
}

export interface OrchestrationDeps {
  api: ApiClient;
  /** Unique id per analysis or language switch. */
  newId?: () => string;
  /** Called before each batch with its 1-based number and the batch count. */
  onProgress?: (batch: number, total: number) => void;
}

let counter = 0;
const defaultId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `analysis-${++counter}`);

// ---------------------------------------------------------------------------
// Combining detection across batches (design: Multi-Batch Result Aggregation)
// ---------------------------------------------------------------------------

export interface Vote {
  value: string;
  confidence: number;
}

/**
 * Confidence-weighted vote. The winner is the value with the largest summed
 * confidence (first seen wins a tie). Its final confidence is the average over
 * all batches, counting 0 for batches that voted for something else. When a
 * batch disagrees with confidence 0.7 or more, the result is held below the
 * threshold so the user confirms (requirement 5.3).
 */
export function combineVotes(votes: readonly Vote[]): Vote {
  if (votes.length === 0) return { value: '', confidence: 0 };
  const sums = new Map<string, number>();
  for (const v of votes) sums.set(v.value, (sums.get(v.value) ?? 0) + v.confidence);
  let winner = votes[0]!.value;
  for (const [value, sum] of sums) if (sum > sums.get(winner)!) winner = value;

  let confidence = sums.get(winner)! / votes.length;
  const confidentDissent = votes.some((v) => v.value !== winner && v.confidence >= LOW_CONFIDENCE_THRESHOLD);
  if (confidentDissent) confidence = Math.min(confidence, BELOW_THRESHOLD);
  return { value: winner, confidence };
}

/** Largest two-decimal value below the 0.7 threshold. */
const BELOW_THRESHOLD = 0.69;

export function combineDetection(responses: readonly AnalyzeResponse[]): Detection {
  const lang = combineVotes(responses.map((r) => ({ value: r.formLanguage, confidence: r.formLanguageConfidence })));
  const country = combineVotes(
    responses.map((r) => ({ value: r.formCountry.toUpperCase(), confidence: r.formCountryConfidence })),
  );
  return {
    formLanguage: lang.value,
    formLanguageConfidence: lang.confidence,
    formCountry: country.value,
    formCountryConfidence: country.confidence,
  };
}

export function detectionNeedsConfirmation(d: Detection): boolean {
  return d.formLanguageConfidence < LOW_CONFIDENCE_THRESHOLD || d.formCountryConfidence < LOW_CONFIDENCE_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

export type AnalyzeOutcome = { status: 'done'; fromCache: boolean } | { status: 'stale' };

function fieldsFrom(evidence: readonly FieldEvidence[], response: AnalyzeResponse): FieldState[] {
  return reconcileAnalysis(evidence, response.fields).fields.map((f) => ({
    evidence: f.evidence,
    analysis: f.analysis,
    status: f.status,
    skipped: false,
  }));
}

/**
 * Analyze a newly uploaded form. Replaces the fields of any earlier form, and
 * makes replies of any earlier analysis stale. API errors propagate as
 * ApiRequestError for the loading screen to show with a retry button.
 */
export async function analyzeForm(
  evidence: readonly FieldEvidence[],
  contentHash: string,
  store: SessionStore,
  deps: OrchestrationDeps,
): Promise<AnalyzeOutcome> {
  const id = (deps.newId ?? defaultId)();
  const language = store.get().interfaceLanguage;
  const key = cacheKey(contentHash, language);
  store.set((s) => ({ ...s, activeAnalysisId: id, contentHash, fields: [], currentStep: 0, detection: null }));

  let combined = store.get().analysisCache.get(key);
  const fromCache = combined !== undefined;
  let demoMode = store.get().demoMode;

  if (!combined) {
    const batches = batchFields(evidence.filter(needsAnalysis), BATCH_SIZE);
    const replies: AnalyzeResponse[] = [];
    for (const [i, batch] of batches.entries()) {
      deps.onProgress?.(i + 1, batches.length);
      const reply = await deps.api.analyze({ contentHash, fields: batch, interfaceLanguage: language });
      if (store.get().activeAnalysisId !== id) return { status: 'stale' };
      if (reply.aiMode === 'mock') demoMode = true;
      replies.push(reply.data);
    }
    combined = { ...combineDetection(replies), fields: replies.flatMap((r) => r.fields) };
  }

  const result = combined;
  const detection: Detection = {
    formLanguage: result.formLanguage,
    formLanguageConfidence: result.formLanguageConfidence,
    formCountry: result.formCountry,
    formCountryConfidence: result.formCountryConfidence,
  };
  store.set((s) => {
    const analysisCache = new Map(s.analysisCache);
    analysisCache.set(key, result);
    return {
      ...s,
      analysisCache,
      fields: fieldsFrom(evidence, result),
      detection,
      formLanguage: detection.formLanguage,
      formCountry: detection.formCountry,
      needsConfirmation: detectionNeedsConfirmation(detection),
      demoMode,
      activeAnalysisId: null,
    };
  });
  return { status: 'done', fromCache };
}

/** The user confirmed (or corrected) the form language and country. */
export function confirmFormSettings(store: SessionStore, formLanguage: string, formCountry: string): void {
  store.set((s) => ({ ...s, formLanguage, formCountry: formCountry.toUpperCase(), needsConfirmation: false }));
}

// ---------------------------------------------------------------------------
// Language switch
// ---------------------------------------------------------------------------

export type SwitchOutcome = { status: 'done'; fromCache: boolean } | { status: 'stale' };

/** Copy labels and questions from `wording` onto the fields; nothing else changes. */
function applyWording(fields: readonly FieldState[], wording: ReadonlyMap<string, Pick<FieldAnalysis, 'humanLabel' | 'question'>>): FieldState[] {
  return fields.map((f) => {
    const w = f.analysis && wording.get(f.analysis.fieldId);
    return w && f.analysis ? { ...f, analysis: { ...f.analysis, humanLabel: w.humanLabel, question: w.question } } : f;
  });
}

/**
 * Switch the interface language. With no form loaded this only changes the
 * language. Otherwise the cached wording for the new language is used, or the
 * current labels and questions are re-translated in batches of 30. Answers,
 * statuses, answer types and the current step stay as they are.
 */
export async function switchLanguage(newLanguage: string, store: SessionStore, deps: OrchestrationDeps): Promise<SwitchOutcome> {
  const start = store.get();
  const hash = start.contentHash;
  const analysed = start.fields.filter((f) => f.analysis);
  if (!hash || analysed.length === 0) {
    store.set((s) => ({ ...s, interfaceLanguage: newLanguage }));
    return { status: 'done', fromCache: false };
  }

  const key = cacheKey(hash, newLanguage);
  const cached = start.analysisCache.get(key);
  if (cached) {
    const wording = new Map(cached.fields.map((f) => [f.fieldId, f]));
    store.set((s) => ({ ...s, interfaceLanguage: newLanguage, fields: applyWording(s.fields, wording), activeAnalysisId: null }));
    return { status: 'done', fromCache: true };
  }

  const id = (deps.newId ?? defaultId)();
  store.set((s) => ({ ...s, activeAnalysisId: id }));
  const wording = new Map<string, Pick<FieldAnalysis, 'humanLabel' | 'question'>>();
  const batches = batchFields(
    analysed.map((f) => ({ fieldId: f.analysis!.fieldId, humanLabel: f.analysis!.humanLabel, question: f.analysis!.question })),
    BATCH_SIZE,
  );
  let demoMode = start.demoMode;
  for (const [i, batch] of batches.entries()) {
    deps.onProgress?.(i + 1, batches.length);
    const reply = await deps.api.retranslate({ contentHash: hash, fields: batch, targetLanguage: newLanguage });
    if (store.get().activeAnalysisId !== id) return { status: 'stale' };
    if (reply.aiMode === 'mock') demoMode = true;
    for (const f of reply.data.fields) wording.set(f.fieldId, f);
  }

  store.set((s) => {
    const fields = applyWording(s.fields, wording);
    // Cache the full structure in the new language; fields the reply left out keep their current wording.
    const base = s.analysisCache.get(cacheKey(hash, s.interfaceLanguage));
    const analysisCache = new Map(s.analysisCache);
    if (base) {
      analysisCache.set(key, {
        ...base,
        fields: base.fields.map((a) => {
          const current = fields.find((f) => f.analysis?.fieldId === a.fieldId)?.analysis;
          return current ? { ...a, humanLabel: current.humanLabel, question: current.question } : a;
        }),
      });
    }
    return { ...s, interfaceLanguage: newLanguage, fields, analysisCache, demoMode, activeAnalysisId: null };
  });
  return { status: 'done', fromCache: false };
}

// ---------------------------------------------------------------------------
// Answers and the description translation gate
// ---------------------------------------------------------------------------

function updateField(store: SessionStore, fieldId: string, update: (f: FieldState) => FieldState): void {
  store.set((s) => ({ ...s, fields: s.fields.map((f) => (f.evidence.fieldId === fieldId ? update(f) : f)) }));
}

/** Record what the user typed. A changed answer drops any translation made from the old text. */
export function setAnswer(store: SessionStore, fieldId: string, rawAnswer: string, normalizedOutput?: string): void {
  updateField(store, fieldId, (f) => {
    const { normalizedOutput: _old, translation, ...rest } = f;
    return {
      ...rest,
      rawAnswer,
      skipped: false,
      ...(normalizedOutput !== undefined ? { normalizedOutput } : {}),
      ...(translation && translation.source === rawAnswer ? { translation } : {}),
    };
  });
}

export type TranslateOutcome = 'done' | 'busy' | 'not-a-description' | 'empty';

/**
 * Translate one description answer into the form language. Call this only from
 * the translate button's click handler: it is the single path that sends a
 * user answer to the backend (requirements 8.6, 11.1). A second press while a
 * translation is running sends nothing.
 */
export async function translateDescription(store: SessionStore, fieldId: string, deps: Pick<OrchestrationDeps, 'api'>): Promise<TranslateOutcome> {
  const s = store.get();
  if (s.pendingTranslationFieldId !== undefined) return 'busy';
  const field = s.fields.find((f) => f.evidence.fieldId === fieldId);
  const type = field?.userOverrideAnswerType ?? field?.analysis?.answerType;
  if (!field || type !== 'description') return 'not-a-description';
  const text = field.rawAnswer?.trim() ?? '';
  if (!text) return 'empty';

  const sourceLanguage = s.interfaceLanguage;
  const targetLanguage = s.formLanguage;
  store.set((st) => ({ ...st, pendingTranslationFieldId: fieldId }));
  try {
    const reply = await deps.api.translate({ text, sourceLanguage, targetLanguage });
    updateField(store, fieldId, (f) =>
      f.rawAnswer?.trim() === text
        ? { ...f, translation: { source: f.rawAnswer ?? text, sourceLanguage, targetLanguage, text: reply.data.translation, approved: false } }
        : f,
    );
    return 'done';
  } finally {
    store.set((st) => {
      const { pendingTranslationFieldId: _done, ...rest } = st;
      return rest;
    });
  }
}

/** The user approved the (possibly edited) translation; only now may it be written to the PDF. */
export function approveTranslation(store: SessionStore, fieldId: string, editedText: string): void {
  updateField(store, fieldId, (f) =>
    f.translation ? { ...f, translation: { ...f.translation, text: editedText, approved: true }, normalizedOutput: editedText.trim() } : f,
  );
}
