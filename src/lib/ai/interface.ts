/**
 * src/lib/ai/interface.ts
 *
 * The single AI provider interface. Every caller (Worker routes, the fixture
 * cache generator) depends on this, so swapping providers changes no callers.
 *
 * Providers return the model's reply as an unvalidated value (`unknown`).
 * Callers validate it with the shared zod schemas, retry once, then fall back
 * (requirement 5.6). Providers throw the typed errors below for failures the
 * caller must handle differently.
 */

import type { AnalyzeRequest, RetranslateRequest, TranslateRequest } from '../../shared/types.js';

/** Analyze request plus what the provider needs to word the questions. */
export interface AnalyzeCall {
  request: AnalyzeRequest;
  /** Language name used in the prompt, e.g. "Simplified Chinese". */
  interfaceLanguageName: string;
}

export interface RetranslateCall {
  /** Holds the current label and question of each field; only the wording is translated. */
  request: RetranslateRequest;
  targetLanguageName: string;
}

export interface TranslateCall {
  request: TranslateRequest;
  sourceLanguageName: string;
  targetLanguageName: string;
}

/** Operational metadata only: never prompts, replies or form content. */
export interface AiUsage {
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  durationMs: number;
}

export interface AiReply {
  /** Parsed JSON value from the model, not yet validated. */
  value: unknown;
  usage: AiUsage;
}

export interface AiProvider {
  readonly kind: 'real' | 'mock';
  analyze(call: AnalyzeCall): Promise<AiReply>;
  retranslate(call: RetranslateCall): Promise<AiReply>;
  translate(call: TranslateCall): Promise<AiReply>;
}

export type AiErrorCode = 'AI_QUOTA' | 'AI_RATE_LIMITED' | 'AI_TIMEOUT' | 'AI_INVALID_OUTPUT' | 'AI_UNAVAILABLE';

/** A typed AI failure. The message never contains form content. */
export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

/** Failures that trigger the precomputed fixture cache (requirement 12.7). */
export function isCacheFallbackError(err: unknown): boolean {
  return err instanceof AiError && (err.code === 'AI_QUOTA' || err.code === 'AI_RATE_LIMITED' || err.code === 'AI_TIMEOUT');
}
