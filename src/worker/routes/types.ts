/**
 * src/worker/routes/types.ts
 */

import type { AiProvider } from '../../lib/ai/interface.js';
import type { RunMeta } from '../../lib/analysis/run.js';

export interface RouteContext {
  provider: AiProvider;
  requestId: string;
}

export interface RouteResult {
  response: Response;
  meta?: RunMeta;
  servedFromCache?: boolean;
}
