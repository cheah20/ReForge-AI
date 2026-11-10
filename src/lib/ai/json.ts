/**
 * src/lib/ai/json.ts
 *
 * Extract a JSON value from a model reply. Decision 10: JSON mode is not
 * relied on, so the text may be wrapped in code fences, preceded by reasoning
 * (<think>...</think>) or followed by commentary. Returns undefined when no
 * JSON object can be parsed; the caller then retries or falls back.
 */

/** The text content of a Workers AI chat reply (choices[0].message.content or legacy `response`). */
export function replyContent(reply: unknown): unknown {
  if (typeof reply === 'string') return reply;
  if (!reply || typeof reply !== 'object') return undefined;
  const r = reply as Record<string, unknown>;
  const choices = r['choices'];
  if (Array.isArray(choices) && choices.length > 0) {
    const message = (choices[0] as Record<string, unknown> | undefined)?.['message'];
    if (message && typeof message === 'object') {
      const content = (message as Record<string, unknown>)['content'];
      if (content !== undefined && content !== null) return content;
    }
  }
  if (r['response'] !== undefined) return r['response'];
  return undefined;
}

/** Parse the first top-level JSON object in `text`. */
export function extractJson(content: unknown): unknown {
  if (content && typeof content === 'object') return content; // already parsed by the runtime
  if (typeof content !== 'string') return undefined;

  let text = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) text = fenced[1].trim();

  try {
    return JSON.parse(text);
  } catch {
    // Fall through: find a balanced {...} span.
  }

  const start = text.indexOf('{');
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

/** Token counts from a Workers AI reply; missing counts stay undefined, never 0. */
export function replyUsage(reply: unknown): { promptTokens?: number; completionTokens?: number } {
  const usage = reply && typeof reply === 'object' ? (reply as Record<string, unknown>)['usage'] : undefined;
  if (!usage || typeof usage !== 'object') return {};
  const u = usage as Record<string, unknown>;
  const out: { promptTokens?: number; completionTokens?: number } = {};
  if (typeof u['prompt_tokens'] === 'number') out.promptTokens = u['prompt_tokens'];
  if (typeof u['completion_tokens'] === 'number') out.completionTokens = u['completion_tokens'];
  return out;
}
