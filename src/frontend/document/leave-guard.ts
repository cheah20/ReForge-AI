/**
 * src/frontend/document/leave-guard.ts
 *
 * The leave-page warning (formbridge-any-document Requirements 20.1, 20.3). A
 * `beforeunload` handler is registered while at least one answer is not empty
 * or a Document_Model is loaded, and removed as soon as neither holds. The
 * browser decides whether to show its dialog; nothing is saved anywhere.
 */

import type { SessionState } from '../state.js';

export interface LeaveTarget {
  addEventListener(type: 'beforeunload', listener: (e: BeforeUnloadEvent) => void): void;
  removeEventListener(type: 'beforeunload', listener: (e: BeforeUnloadEvent) => void): void;
}

/** True while the session holds a document or any non-empty answer. */
export function hasUnsavedWork(state: Pick<SessionState, 'document' | 'fields'>): boolean {
  if (state.document !== null) return true;
  return state.fields.some((f) => (f.rawAnswer ?? '').trim().length > 0 || (f.normalizedOutput ?? '').length > 0);
}

export function onBeforeUnload(e: BeforeUnloadEvent): void {
  e.preventDefault();
  // Older browsers need a value; modern ones ignore it and show their own text.
  e.returnValue = '';
}

/**
 * Keeps the handler in step with the session: call `update` after every state
 * change. Registers once, removes once.
 */
export function createLeaveGuard(target: LeaveTarget): { update(state: Pick<SessionState, 'document' | 'fields'>): void; active(): boolean } {
  let registered = false;
  return {
    update(state) {
      const need = hasUnsavedWork(state);
      if (need && !registered) {
        target.addEventListener('beforeunload', onBeforeUnload);
        registered = true;
      } else if (!need && registered) {
        target.removeEventListener('beforeunload', onBeforeUnload);
        registered = false;
      }
    },
    active: () => registered,
  };
}
