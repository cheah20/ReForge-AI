/**
 * src/lib/ai/cf-workers.ts
 *
 * AiProvider backed by the Workers AI binding (env.AI). No API key: the
 * binding authenticates the Worker.
 *
 * Decision 10: `max_completion_tokens` (not the deprecated `max_tokens`), no
 * reliance on JSON mode, Qwen runs with reasoning_effort "low", and the free
 * quota error (HTTP 429, code 3036) maps to AI_QUOTA, which triggers the
 * fixture cache fallback.
 */

import { AiError, type AiProvider, type AiReply, type AnalyzeCall, type RetranslateCall, type TranslateCall } from './interface.js';
import { extractJson, replyContent, replyUsage } from './json.js';
import { analyzeMessages, retranslateMessages, translateMessages, type ChatMessage } from './prompt.js';

export const GEMMA_MODEL = '@cf/google/gemma-4-26b-a4b-it';
export const QWEN_MODEL = '@cf/qwen/qwen3.8-27b';
/** Default until Spike 1 records the measured choice (design.md, Model Selection Result). */
export const DEFAULT_MODEL = GEMMA_MODEL;

/** The part of the Workers AI binding this provider uses. */
export interface AiBinding {
  run(model: string, inputs: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

export interface CfWorkersAiOptions {
  model?: string;
  /** Per-call timeout in ms (default 25 s, the Worker's request budget). */
  timeoutMs?: number;
  now?: () => number;
}

const MAX_TOKENS = { analyze: 2000, retranslate: 4000, translate: 1500 } as const;

/** Map a binding error to a typed AiError. The original message is not kept (it may echo input). */
export function classifyBindingError(err: unknown): AiError {
  const text = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  if (/\b3036\b|daily free allocation|neurons/i.test(text)) return new AiError('AI_QUOTA', 'Workers AI daily quota exhausted');
  if (/\b429\b|rate.?limit|too many requests/i.test(text)) return new AiError('AI_RATE_LIMITED', 'Workers AI rate limited');
  if (/timed? ?out|timeout|\b408\b|\b504\b/i.test(text)) return new AiError('AI_TIMEOUT', 'Workers AI timed out');
  return new AiError('AI_UNAVAILABLE', 'Workers AI request failed');
}

export class CfWorkersAiProvider implements AiProvider {
  readonly kind = 'real' as const;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(
    private readonly binding: AiBinding,
    options: CfWorkersAiOptions = {},
  ) {
    this.model = options.model ?? DEFAULT_MODEL;
    this.timeoutMs = options.timeoutMs ?? 25_000;
    this.now = options.now ?? (() => Date.now());
  }

  analyze(call: AnalyzeCall): Promise<AiReply> {
    return this.run(analyzeMessages(call), MAX_TOKENS.analyze, 0.2);
  }

  retranslate(call: RetranslateCall): Promise<AiReply> {
    return this.run(retranslateMessages(call), MAX_TOKENS.retranslate, 0.2);
  }

  translate(call: TranslateCall): Promise<AiReply> {
    return this.run(translateMessages(call), MAX_TOKENS.translate, 0);
  }

  /** Model inputs. Exposed for tests. */
  inputs(messages: ChatMessage[], maxTokens: number, temperature: number): Record<string, unknown> {
    const inputs: Record<string, unknown> = { messages, max_completion_tokens: maxTokens, temperature };
    if (this.model === QWEN_MODEL) inputs['reasoning_effort'] = 'low';
    return inputs;
  }

  private async run(messages: ChatMessage[], maxTokens: number, temperature: number): Promise<AiReply> {
    const started = this.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AiError('AI_TIMEOUT', 'Workers AI timed out')), this.timeoutMs);
    });

    let raw: unknown;
    try {
      raw = await Promise.race([this.binding.run(this.model, this.inputs(messages, maxTokens, temperature)), timeout]);
    } catch (err) {
      throw err instanceof AiError ? err : classifyBindingError(err);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }

    const value = extractJson(replyContent(raw));
    if (value === undefined) throw new AiError('AI_INVALID_OUTPUT', 'Model reply was not JSON');
    return { value, usage: { model: this.model, durationMs: this.now() - started, ...replyUsage(raw) } };
  }
}
