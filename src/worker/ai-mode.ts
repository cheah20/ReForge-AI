/**
 * src/worker/ai-mode.ts
 *
 * Decision 11: the mock AI provider is the default. Local development with the
 * Workers AI binding reaches Cloudflare and spends real neurons, so real AI runs
 * only when it is enabled explicitly with AI_MODE="real" and the binding exists.
 */

export type AiMode = 'real' | 'mock';

export interface AiModeEnv {
  AI?: unknown;
  AI_MODE?: string;
}

export function resolveAiMode(env: AiModeEnv): AiMode {
  return env.AI_MODE === 'real' && env.AI !== undefined && env.AI !== null ? 'real' : 'mock';
}
