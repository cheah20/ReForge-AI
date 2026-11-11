/**
 * src/frontend/screens/DownloadConfirm.tsx
 *
 * Screen 8 (task 33.1): fill the PDF in the browser with the confirmed
 * answers and offer it as "<name>-filled.pdf" (10.4). The app never submits
 * the form anywhere. A character the font cannot draw (8.7) or text that does
 * not fit (10.2) stops the fill, names the field, and sends the user back to
 * review to change it.
 */

import { useEffect, useRef, useState } from 'react';
import { fallbackAnalysis } from '../../lib/analysis/reconcile.js';
import { loadFont } from '../../lib/pdf-fill/font.js';
import { CharacterNotRepresentableError, FillError, fillPdf, TextOverflowError } from '../../lib/pdf-fill/index.js';
import type { UploadedPdf } from '../app-context.js';
import { useSession } from '../app-context.js';
import { ScreenHeading } from '../components/ScreenHeading.js';
import { StatusMessage } from '../components/StatusMessage.js';
import { useTranslation } from '../i18n.js';
import type { FieldState } from '../state.js';
import { answersForFill, filledFileName } from '../wizard-logic.js';

export interface DownloadConfirmProps {
  pdf: UploadedPdf;
  onBackToReview: () => void;
  /** Replaces the fill step (tests). */
  fill?: (pdf: UploadedPdf, fields: readonly FieldState[]) => Promise<Uint8Array>;
}

const defaultFill = async (pdf: UploadedPdf, fields: readonly FieldState[]) => {
  const latin = await loadFont('latin');
  return fillPdf(pdf.bytes, answersForFill(fields), [latin]);
};

type FillState = { kind: 'working' } | { kind: 'ready'; url: string } | { kind: 'failed'; key: string; field?: string };

export function DownloadConfirm({ pdf, onBackToReview, fill = defaultFill }: DownloadConfirmProps) {
  const { t } = useTranslation();
  const session = useSession();
  const [state, setState] = useState<FillState>({ kind: 'working' });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let url: string | null = null;
    const fields = session.fields;
    const labelOf = (id: string) => {
      const f = fields.find((x) => x.evidence.fieldId === id);
      return f ? (f.analysis ?? fallbackAnalysis(f.evidence)).humanLabel : id;
    };
    fill(pdf, fields)
      .then((bytes) => {
        url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
        setState({ kind: 'ready', url });
      })
      .catch((err: unknown) => {
        if (err instanceof CharacterNotRepresentableError) setState({ kind: 'failed', key: 'download.error.glyph', field: labelOf(err.fieldId) });
        else if (err instanceof TextOverflowError) setState({ kind: 'failed', key: 'download.error.overflow', field: labelOf(err.fieldId) });
        else if (err instanceof FillError && err.code === 'MAX_LENGTH') setState({ kind: 'failed', key: 'download.error.overflow', field: labelOf(err.fieldId) });
        else setState({ kind: 'failed', key: 'download.error.generic' });
      });
    return () => {
      // The download link holds the filled PDF in memory; release it when the screen closes.
      if (url) URL.revokeObjectURL(url);
    };
    // Fill once per visit to this screen, with the answers as they were confirmed.
  }, []);

  return (
    <>
      <ScreenHeading>{state.kind === 'ready' ? t('download.ready') : t('download.preparing')}</ScreenHeading>
      <div className="section stack" aria-live="polite">
        {state.kind === 'working' && <StatusMessage tone="info">{t('download.preparing')}</StatusMessage>}
        {state.kind === 'failed' && (
          <div className="error-panel stack">
            <StatusMessage tone="error">
              {state.field ? `${state.field}: ` : ''}
              {t(state.key)}
            </StatusMessage>
          </div>
        )}
        {state.kind === 'ready' && (
          <div className="download-ready stack">
            <span className="stamp" aria-hidden="true">
              {t('download.stamp')}
            </span>
            <p>{t('download.checkNote')}</p>
          </div>
        )}
      </div>
      <div className="actions">
        {state.kind === 'ready' && (
          <a className="button" href={state.url} download={filledFileName(pdf.name)}>
            {t('download.button')}
          </a>
        )}
        <button type="button" className="button button--secondary" onClick={onBackToReview}>
          {t('download.backToReview')}
        </button>
      </div>
    </>
  );
}
