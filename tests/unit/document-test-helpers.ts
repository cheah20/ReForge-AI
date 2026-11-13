/**
 * tests/unit/document-test-helpers.ts
 *
 * Shared helpers for the label analysis tests (formbridge-any-document task 2):
 * a Worker with a recording logger, a provider wrapper that records the exact
 * prompt the Workers AI provider would send, and a scripted provider.
 */

import { createHandler, type Env } from '../../src/worker/index.js';
import { MockAiProvider } from '../../src/lib/ai/mock.js';
import { AiError, type AiProvider, type AiReply, type LabelAnalyzeCall } from '../../src/lib/ai/interface.js';
import { analyzeLabelsMessages, type ChatMessage } from '../../src/lib/ai/prompt.js';
import type { LogEntry } from '../../src/worker/http.js';
import type { KeptLabel } from '../../src/shared/types.js';

export const LABEL_ROUTE = '/api/documents/analyze-labels';

export function keptLabel(pageNumber: number, readingOrder: number, text: string): KeptLabel {
  return { labelId: `p${pageNumber}-l${readingOrder}`, text, pageNumber, readingOrder };
}

export function labelRequest(labels: KeptLabel[], extra: Record<string, unknown> = {}) {
  return { labels, interfaceLanguage: 'en', ...extra };
}

export interface RecordingProvider extends AiProvider {
  /** The messages the Workers AI provider would send for each analyzeLabels call. */
  prompts: ChatMessage[][];
  calls: LabelAnalyzeCall[];
}

/** Wraps a provider; analyzeLabels records the real prompt, then delegates. */
export function recording(inner: AiProvider = new MockAiProvider()): RecordingProvider {
  const prompts: ChatMessage[][] = [];
  const calls: LabelAnalyzeCall[] = [];
  return {
    kind: inner.kind,
    prompts,
    calls,
    analyze: (c) => inner.analyze(c),
    retranslate: (c) => inner.retranslate(c),
    translate: (c) => inner.translate(c),
    analyzePage: (c) => inner.analyzePage(c),
    analyzeLabels: (c) => {
      calls.push(c);
      prompts.push(analyzeLabelsMessages(c));
      return inner.analyzeLabels(c);
    },
  };
}

export type ScriptStep = { value: unknown } | AiError | Error | ((call: LabelAnalyzeCall) => unknown);

/** A provider whose analyzeLabels answers with the next scripted step (the last one repeats). */
export function scriptedLabels(steps: ScriptStep[]): AiProvider & { calls: LabelAnalyzeCall[] } {
  const calls: LabelAnalyzeCall[] = [];
  const mock = new MockAiProvider();
  const next = async (c: LabelAnalyzeCall): Promise<AiReply> => {
    const step = steps[Math.min(calls.length, steps.length - 1)]!;
    calls.push(c);
    if (step instanceof Error) throw step;
    const value = typeof step === 'function' ? step(c) : step.value;
    return { value, usage: { model: 'scripted', durationMs: 1 } };
  };
  return {
    kind: 'real',
    calls,
    analyze: (c) => mock.analyze(c),
    retranslate: (c) => mock.retranslate(c),
    translate: (c) => mock.translate(c),
    analyzePage: (c) => mock.analyzePage(c),
    analyzeLabels: next,
  };
}

export function setupWorker(provider: AiProvider = new MockAiProvider(), env: Env = {}) {
  const logs: LogEntry[] = [];
  const handler = createHandler({ provider, logger: (e) => logs.push(e), requestId: () => 'req-1', now: () => 1000 });
  const call = (body: unknown, path = LABEL_ROUTE) =>
    handler.fetch(
      new Request(`https://reforge.example${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
      env,
    );
  return { call, logs };
}

/** A valid envelope answering every label of the call with a plain text entry. */
export function validEnvelope(c: LabelAnalyzeCall, extra: Record<string, unknown> = {}) {
  return {
    fields: c.labels.map((l) => ({ fieldId: l.labelId, humanLabel: 'Label', question: 'What is it?', answerType: 'text', confidence: 0.8 })),
    formLanguage: 'ms',
    formLanguageConfidence: 0.9,
    formCountry: 'MY',
    formCountryConfidence: 0.9,
    ...extra,
  };
}

/** The data section of a label prompt, parsed back. */
export function dataSection(messages: ChatMessage[]): unknown {
  const user = messages.find((m) => m.role === 'user')!.content;
  const lines = user.split('\n');
  const open = lines.indexOf('<form_data>');
  const close = lines.indexOf('</form_data>');
  return JSON.parse(lines.slice(open + 1, close).join('\n'));
}
