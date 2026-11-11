/**
 * src/frontend/screens/Upload.tsx
 *
 * Screen 2 (tasks 28.1, 28.2): choose a PDF, read its fields in the browser
 * and show what was found, or why the file cannot be used.
 * - The privacy notice is shown before anything is sent (9.5, 11.4).
 * - The PDF is read here, in the browser; its bytes are never uploaded.
 * - "Continue" exists only after a successful read, and pressing it is the
 *   acknowledgement that starts the analysis (5.1).
 * - A rejected file shows its reason in the interface language and a
 *   "Try another file" button; nothing crashes.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { extractFields, type ExtractionResult } from '../../lib/pdf-extract/index.js';
import { MAX_FILE_SIZE_BYTES } from '../../lib/pdf-extract/rejection.js';
import type { FieldEvidence } from '../../shared/types.js';
import type { UploadedPdf } from '../app-context.js';
import { ScreenHeading } from '../components/ScreenHeading.js';
import { StatusMessage } from '../components/StatusMessage.js';
import { useTranslation } from '../i18n.js';
import { ensurePdfJsWorker } from '../pdfjs-worker.js';
import type { SampleSource } from '../sample-form.js';

export type Extractor = (bytes: Uint8Array) => Promise<ExtractionResult>;

const defaultExtractor: Extractor = async (bytes) => {
  await ensurePdfJsWorker();
  return extractFields(bytes);
};

export interface ExtractedForm {
  pdf: UploadedPdf;
  fields: FieldEvidence[];
  contentHash: string;
  pageCount: number;
}

export interface UploadProps {
  onContinue: (form: ExtractedForm) => void;
  /** Replaces the PDF reader (tests). */
  extractor?: Extractor;
  /** "Try a sample form" (task 28.5): read this PDF as if the user had chosen it. */
  sample?: SampleSource | undefined;
}

type UploadState =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'rejected'; messageKey: string }
  | { kind: 'ready'; form: ExtractedForm };

/** File bytes. `Blob.arrayBuffer` is missing on older Safari, so FileReader is the fallback. */
export function readFileBytes(file: Blob): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer().then((b) => new Uint8Array(b));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/** Label for the field list: the PDF tooltip, else the PDF field name. */
function fieldName(f: FieldEvidence): string {
  return f.tooltip?.trim() || f.fieldId;
}

export function Upload({ onContinue, extractor = defaultExtractor, sample }: UploadProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<UploadState>({ kind: 'idle' });
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const noticeId = useId();
  const run = useRef(0);

  // The sample form goes through the same reading path as a chosen file.
  const sampleRead = useRef<SampleSource | null>(null);
  useEffect(() => {
    if (!sample || sampleRead.current === sample) return;
    sampleRead.current = sample;
    void read(sample.name, sample.load);
  }, [sample]);

  async function readFile(file: File) {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      run.current++;
      setState({ kind: 'rejected', messageKey: 'upload.error.tooLarge' });
      return;
    }
    await read(file.name, () => readFileBytes(file));
  }

  async function read(name: string, load: () => Promise<Uint8Array>) {
    const thisRun = ++run.current;
    setState({ kind: 'reading' });
    let result: ExtractionResult;
    let bytes: Uint8Array;
    try {
      bytes = await load();
      result = await extractor(bytes);
    } catch {
      result = { ok: false, code: 'INVALID_PDF', messageKey: 'upload.error.invalidPdf' };
      bytes = new Uint8Array();
    }
    if (thisRun !== run.current) return; // a newer file was chosen meanwhile
    if (!result.ok) {
      setState({ kind: 'rejected', messageKey: result.messageKey });
      return;
    }
    setState({
      kind: 'ready',
      form: { pdf: { name, bytes }, fields: result.fields, contentHash: result.fileHash, pageCount: result.pageCount },
    });
  }

  function tryAnother() {
    run.current++;
    setState({ kind: 'idle' });
    if (inputRef.current) {
      inputRef.current.value = '';
      inputRef.current.focus();
    }
  }

  return (
    <>
      <ScreenHeading>{t('upload.title')}</ScreenHeading>

      <div className="section stack">
        <div className="notice" id={noticeId}>
          <p>{t('upload.privacyNotice')}</p>
        </div>

        <div className="file-picker">
          <label htmlFor={inputId}>{t('upload.button')}</label>
          <input
            ref={inputRef}
            id={inputId}
            className="file-picker__input"
            type="file"
            accept="application/pdf,.pdf"
            aria-describedby={noticeId}
            disabled={state.kind === 'reading'}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void readFile(file);
            }}
          />
        </div>
      </div>

      <div className="section stack">
        {/* Only the status text is a live region, so buttons are not read out. */}
        <div aria-live="polite" className={state.kind === 'rejected' ? 'error-panel' : undefined}>
          {state.kind === 'reading' && <StatusMessage tone="info">{t('upload.analyzing')}</StatusMessage>}
          {state.kind === 'rejected' && <StatusMessage tone="error">{t(state.messageKey)}</StatusMessage>}
          {state.kind === 'ready' && (
            <StatusMessage tone="success">
              {t('upload.found', { count: state.form.fields.length, pages: state.form.pageCount })}
            </StatusMessage>
          )}
        </div>

        {state.kind === 'rejected' && (
          <div className="actions">
            <button type="button" className="button button--secondary" onClick={tryAnother}>
              {t('upload.error.tryAnother')}
            </button>
          </div>
        )}

        {state.kind === 'ready' && (
          <div className="stack">
            <details>
              <summary>{t('upload.fieldListTitle')}</summary>
              <ul className="field-list">
                {state.form.fields.map((f) => (
                  // PDF labels are in the form's language, which is not known yet.
                  <li key={f.fieldId} lang="">
                    {fieldName(f)}
                  </li>
                ))}
              </ul>
            </details>
            <div className="actions">
              <button type="button" className="button" onClick={() => onContinue(state.form)}>
                {t('upload.acknowledge')}
              </button>
              <button type="button" className="button button--quiet" onClick={tryAnother}>
                {t('upload.error.tryAnother')}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
