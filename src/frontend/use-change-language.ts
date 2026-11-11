/**
 * src/frontend/use-change-language.ts
 *
 * Change the interface language everywhere: the session (labels and questions
 * of a loaded form are re-translated, answers stay) and then the UI strings.
 * The UI switches only after the questions are ready, so the screen never
 * mixes two languages.
 */

import { useCallback, useState } from 'react';
import { ApiRequestError } from './api.js';
import { useServices } from './app-context.js';
import { useTranslation } from './i18n.js';
import { switchLanguage } from './state.js';

export interface ChangeLanguage {
  change: (tag: string) => Promise<void>;
  busy: boolean;
  /** i18n key of the last failure, or null. */
  errorKey: string | null;
}

export function errorKeyFor(err: unknown): string {
  const code = err instanceof ApiRequestError ? err.code : '';
  if (code === 'AI_TIMEOUT') return 'error.timeout';
  if (code === 'AI_UNAVAILABLE' || code === 'RATE_LIMITED') return 'error.aiUnavailable';
  return 'error.generic';
}

export function useChangeLanguage(): ChangeLanguage {
  const { store, api } = useServices();
  const { setLanguage } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const change = useCallback(
    async (tag: string) => {
      setBusy(true);
      setErrorKey(null);
      try {
        const out = await switchLanguage(tag, store, { api });
        if (out.status === 'done') setLanguage(tag);
      } catch (err) {
        setErrorKey(errorKeyFor(err));
      } finally {
        setBusy(false);
      }
    },
    [store, api, setLanguage],
  );

  return { change, busy, errorKey };
}
