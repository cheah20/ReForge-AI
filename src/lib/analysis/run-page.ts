/**
 * src/lib/analysis/run-page.ts
 *
 * accessforge-skeleton task 13.5 (design "Orchestration", Requirement 6.10).
 * One page-analysis call with the retry rule of the design: attempt 1; when
 * the reply fails PagePlanReplySchema or the attempt times out, attempt 2
 * with the same input. Quota, rate-limit and unavailable errors are not
 * retried. The outcome is classified by the last attempt. No HTTP, no I/O.
 *
 * A timeout is retried here, unlike the PDF analysis, because Requirement
 * 6.10 says so and 2 x 20 s stays inside the browser's 45 s limit.
 */

import { PagePlanReplySchema, type PageAnalyzeRequest } from '../../shared/page-schemas.js';
import { AiError, type AiProvider, type AiReply } from '../ai/interface.js';
import type { RunMeta } from './run.js';

export type PageRunFailure = 'invalid' | 'timeout' | 'quota' | 'rate_limited' | 'unavailable';

export type PageRunOutcome =
  | { ok: true; entries: unknown[]; meta: RunMeta }
  | { ok: false; reason: PageRunFailure; meta: RunMeta };

export async function runPageAnalyze(provider: AiProvider, request: PageAnalyzeRequest, interfaceLanguageName: string): Promise<PageRunOutcome> {
  const meta: RunMeta = { attempts: 0, usedFallback: false, usage: [] };
  let last: PageRunFailure = 'invalid';
  for (let attempt = 0; attempt < 2; attempt++) {
    meta.attempts++;
    let reply: AiReply;
    try {
      reply = await provider.analyzePage({ request, interfaceLanguageName });
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
      const reason: PageRunFailure = err.code === 'AI_QUOTA' ? 'quota' : err.code === 'AI_RATE_LIMITED' ? 'rate_limited' : 'unavailable';
      return { ok: false, reason, meta };
    }
    meta.usage.push(reply.usage);
    const envelope = PagePlanReplySchema.safeParse(reply.value);
    if (!envelope.success) {
      last = 'invalid';
      continue;
    }
    return { ok: true, entries: envelope.data.entries, meta };
  }
  return { ok: false, reason: last, meta };
}
