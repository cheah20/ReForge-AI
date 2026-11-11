/**
 * src/frontend/screens/AnalysisLoading.tsx
 *
 * Screen 4 (task 29.1): runs the analysis once and shows batch progress.
 * - Says that it can take up to a minute (design: 45 s AI timeout).
 * - On failure: a plain message, "Try again" and a way back to the upload.
 * - On success: the confirmation screen when the form language or country is
 *   uncertain (5.3), otherwise the questions.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FieldEvidence } from '../../shared/types.js';
import { useServices } from '../app-context.js';
import { ScreenHeading } from '../components/ScreenHeading.js';
import { StatusMessage } from '../components/StatusMessage.js';
import { useTranslation } from '../i18n.js';
import { analyzeForm } from '../state.js';
import { errorKeyFor } from '../use-change-language.js';

export interface AnalysisLoadingProps {
  fields: readonly FieldEvidence[];
  contentHash: string;
  onDone: (needsConfirmation: boolean) => void;
  onBack: () => void;
}

export function AnalysisLoading({ fields, contentHash, onDone, onBack }: AnalysisLoadingProps) {
  const { t } = useTranslation();
  const { store, api } = useServices();
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const started = useRef(-1);

  const run = useCallback(async () => {
    setErrorKey(null);
    try {
      const out = await analyzeForm(fields, contentHash, store, {
        api,
        onProgress: (current, total) => setProgress({ current, total }),
      });
      if (out.status === 'done') onDone(store.get().needsConfirmation);
    } catch (err) {
      setErrorKey(errorKeyFor(err));
    }
  }, [fields, contentHash, store, api, onDone]);

  useEffect(() => {
    // One analysis per attempt, also when React runs effects twice in development.
    if (started.current === attempt) return;
    started.current = attempt;
    void run();
  }, [attempt, run]);

  return (
    <>
      <ScreenHeading>{t('analysis.loading')}</ScreenHeading>
      <div className="section stack">
        <div aria-live="polite" className={errorKey ? 'error-panel' : undefined}>
          {errorKey ? (
            <StatusMessage tone="error">{t(errorKey)}</StatusMessage>
          ) : (
            <StatusMessage tone="info">
              {progress && progress.total > 1 ? t('analysis.batch', progress) : t('analysis.loading')}
            </StatusMessage>
          )}
        </div>
        {!errorKey && <p className="hint">{t('analysis.slowNote')}</p>}
        {errorKey && (
          <div className="actions">
            <button type="button" className="button" onClick={() => setAttempt((a) => a + 1)}>
              {t('error.retry')}
            </button>
            <button type="button" className="button button--quiet" onClick={onBack}>
              {t('upload.error.tryAnother')}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
