/**
 * src/frontend/accessforge/useLeaveWarning.ts
 *
 * accessforge-skeleton task 16.4 (Requirements 12.5, 13.4). While `active`,
 * a `beforeunload` handler asks the browser for its leave-page warning;
 * otherwise no handler is registered. Nothing is saved anywhere: the answers
 * live only in memory. Whether a dialog appears is the browser's decision.
 */

import { useEffect } from 'react';

export function leaveWarningHandler(e: BeforeUnloadEvent): void {
  e.preventDefault();
  e.returnValue = '';
}

export function useLeaveWarning(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    window.addEventListener('beforeunload', leaveWarningHandler);
    return () => window.removeEventListener('beforeunload', leaveWarningHandler);
  }, [active]);
}
