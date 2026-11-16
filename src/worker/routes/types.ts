/**
 * src/worker/routes/types.ts
 */

import type { AiProvider } from '../../lib/ai/interface.js';
import type { RunMeta } from '../../lib/analysis/run.js';
import type { PagePlanStore } from '../cache/page-plan-cache.js';

export interface RouteContext {
  provider: AiProvider;
  requestId: string;
  /** Precomputed page plans (AccessForge); the bundled store when absent. */
  pagePlans?: PagePlanStore;
}

export interface RouteResult {
  response: Response;
  meta?: RunMeta;
  servedFromCache?: boolean;
}
