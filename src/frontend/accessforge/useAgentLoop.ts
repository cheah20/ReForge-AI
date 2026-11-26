/**
 * src/frontend/accessforge/useAgentLoop.ts
 *
 * accessforge-skeleton task 16.3. React wrapper around `LoopRunner`: one
 * runner per screen, its state through `useSyncExternalStore`, disposed on
 * unmount. The runner holds everything in memory; nothing is stored.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AgentState } from '../../lib/accessforge/agent-machine.js';
import { analyzePage, fetchCachedPlan, retranslatePage } from '../api.js';
import { LoopRunner, type LoopDeps } from './loop-runner.js';
import { highlightControl, prefersReducedMotion } from './RevivalFrame.js';

export function useAgentLoop(language: string, deps: Partial<LoopDeps> = {}) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [runner] = useState(
    () =>
      new LoopRunner(
        {
          frame: () => frameRef.current,
          appOrigin: typeof window !== 'undefined' ? window.location.origin : '',
          analyze: (request, options) => analyzePage(request, options),
          retranslate: (request, options) => retranslatePage(request, options),
          cachedPlan: (version, language, options) => fetchCachedPlan(version, language, options),
          highlight: (el) => highlightControl(el, prefersReducedMotion()),
          ...deps,
        },
        language,
      ),
  );
  const state: AgentState = useSyncExternalStore(
    (fn) => runner.subscribe(fn),
    () => runner.get(),
    () => runner.get(),
  );
  useEffect(() => () => runner.dispose(), [runner]);
  // The analysis language follows the interface language while the loop is not running.
  useEffect(() => runner.dispatch({ type: 'LANGUAGE_SET', language }), [runner, language]);
  return { state, dispatch: runner.dispatch, frameRef, onFrameLoad: runner.onFrameLoad, showField: (elementId: string) => runner.showField(elementId), runner };
}
