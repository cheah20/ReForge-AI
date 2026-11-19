/**
 * src/frontend/document/DocumentReading.tsx
 *
 * The reading screen of the Document_Path for one photo (formbridge-any-document
 * Requirements 7.2, 8, 9.4, 10.1, 3.8): language question, page preview with
 * a turn control, one-time download of the reading tool, reading with Cancel,
 * and the retake, no-labels and error states. The photo is decoded and read
 * in this browser; nothing is sent.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { VALIDATED_OCR_LANGUAGES, type OcrLanguage } from '../../lib/document/limits.js';
import { nextRotation } from '../../lib/document/orientation.js';
import type { DocumentModel, Rotation } from '../../lib/document/types.js';
import { getLanguageEntry } from '../../packs/language/registry.js';
import { ScreenHeading } from '../components/ScreenHeading.js';
import { StatusMessage } from '../components/StatusMessage.js';
import { useTranslation } from '../i18n.js';
import { discardPreview, PageError, releaseCanvas, type DecodedPhoto } from './decode.js';
import { OcrError } from './ocr.js';
import { modelFromPhoto, readDecodedPhoto, type PipelineDeps } from './pipeline.js';
import { ocrService, pipelineDeps } from './services.js';
import { ocrLanguageTag } from '../../lib/document/model.js';
import './document.css';

export interface DocumentReadingProps {
  file: File;
  onRead: (model: DocumentModel, ocrLanguage: OcrLanguage) => void;
  onBack: () => void;
  /** Replaces the browser services (tests). */
  deps?: PipelineDeps;
  /** Interface language, used to preselect the OCR language. */
  interfaceLanguage: string;
}

type Stage =
  | { kind: 'language'; another: boolean }
  | { kind: 'decoding' }
  | { kind: 'preview'; photo: DecodedPhoto }
  | { kind: 'download'; photo: DecodedPhoto; bytes: number; done: number | null }
  | { kind: 'reading'; photo: DecodedPhoto; slow: boolean }
  | { kind: 'retake' }
  | { kind: 'noLabels' }
  | { kind: 'error'; messageKey: string; retry: boolean };

const MB = 1_048_576;

function errorKey(e: unknown): { messageKey: string; retry: boolean } {
  if (e instanceof PageError) return { messageKey: e.code === 'encrypted' ? 'document.error.encrypted' : 'document.error.decode', retry: false };
  if (e instanceof OcrError && e.code === 'unsupported') return { messageKey: 'document.ocr.unsupportedBrowser', retry: false };
  return { messageKey: 'document.ocr.loadFailed', retry: true };
}

export function DocumentReading({ file, onRead, onBack, deps, interfaceLanguage }: DocumentReadingProps) {
  const { t } = useTranslation();
  const services = useRef<PipelineDeps>(deps ?? pipelineDeps());
  const [stage, setStage] = useState<Stage>({ kind: 'language', another: false });
  const [language, setLanguage] = useState<OcrLanguage | 'another'>(interfaceLanguage === 'ms' ? 'msa' : 'eng');
  const rotation = useRef<Rotation>(0);
  const abort = useRef<AbortController | null>(null);
  const photoRef = useRef<DecodedPhoto | null>(null);
  const groupId = useId();

  // Leaving this screen frees the page buffer and ends any reading in progress.
  useEffect(
    () => () => {
      abort.current?.abort();
      if (photoRef.current) releaseCanvas(photoRef.current.canvas);
    },
    [],
  );

  function keep(photo: DecodedPhoto | null) {
    if (photoRef.current && photoRef.current !== photo) releaseCanvas(photoRef.current.canvas);
    photoRef.current = photo;
  }

  async function decode() {
    setStage({ kind: 'decoding' });
    try {
      const outcome = await services.current.decode(file, rotation.current);
      if (outcome.kind === 'skipped-too-large') {
        setStage({ kind: 'error', messageKey: 'document.error.decode', retry: false });
        return;
      }
      keep(outcome.photo);
      setStage({ kind: 'preview', photo: outcome.photo });
    } catch (e) {
      setStage({ kind: 'error', ...errorKey(e) });
    }
  }

  async function turn() {
    if (photoRef.current) discardPreview(photoRef.current.preview, { revokeObjectURL: (u) => URL.revokeObjectURL(u) });
    keep(null);
    rotation.current = nextRotation(rotation.current);
    await decode();
  }

  async function prepare(photo: DecodedPhoto) {
    const lang = language as OcrLanguage;
    try {
      const pending = await ocrService().pendingDownloadBytes(lang);
      if (pending > 0) {
        setStage({ kind: 'download', photo, bytes: pending, done: null });
        return;
      }
    } catch {
      // No size known: reading starts and the reading tool reports its own failure.
    }
    await read(photo);
  }

  async function download(photo: DecodedPhoto, bytes: number) {
    const lang = language as OcrLanguage;
    const controller = new AbortController();
    abort.current = controller;
    setStage({ kind: 'download', photo, bytes, done: 0 });
    try {
      await ocrService().download(lang, (done) => setStage({ kind: 'download', photo, bytes, done }), controller.signal);
    } catch (e) {
      if (e instanceof OcrError && e.code === 'cancelled') {
        setStage({ kind: 'preview', photo });
        return;
      }
      setStage({ kind: 'error', ...errorKey(e) });
      return;
    }
    await read(photo);
  }

  async function read(photo: DecodedPhoto) {
    const lang = language as OcrLanguage;
    const controller = new AbortController();
    abort.current = controller;
    setStage({ kind: 'reading', photo, slow: false });
    try {
      const page = await readDecodedPhoto(
        services.current,
        photo,
        {
          file,
          pageNumber: 1,
          rotation: rotation.current,
          ocrLanguage: lang,
          signal: controller.signal,
          onSlow: () => setStage((s) => (s.kind === 'reading' ? { ...s, slow: true } : s)),
        },
      );
      // The Working_Image was released by the reader; its preview now belongs to the page.
      photoRef.current = null;
      const model = modelFromPhoto(file.type === 'image/png' ? 'png' : 'jpeg', page, lang, ocrLanguageTag(lang));
      if (page.status === 'low-quality' || page.status === 'skipped-too-large') {
        setStage({ kind: 'retake' });
        return;
      }
      if (model.candidates.length === 0) {
        setStage({ kind: 'noLabels' });
        return;
      }
      onRead(model, lang);
    } catch (e) {
      photoRef.current = null;
      if (e instanceof OcrError && e.code === 'cancelled') {
        await decode();
        return;
      }
      setStage({ kind: 'error', ...errorKey(e) });
    }
  }

  function cancel() {
    abort.current?.abort();
    void ocrService().cancel();
  }

  return (
    <>
      <ScreenHeading focusKey={stage.kind}>{stage.kind === 'language' ? t('document.ocrLanguage.title') : stage.kind === 'preview' ? t('document.preview.title') : t('document.reading.title')}</ScreenHeading>

      {stage.kind === 'language' && (
        <div className="section stack">
          <fieldset className="document-language" aria-describedby={`${groupId}-hint`}>
            <legend className="visually-hidden">{t('document.ocrLanguage.title')}</legend>
            {VALIDATED_OCR_LANGUAGES.map((tag) => (
              <label key={tag} className="checkbox-row">
                <input type="radio" name={groupId} checked={language === tag} onChange={() => setLanguage(tag)} />
                <span lang={ocrLanguageTag(tag)}>{getLanguageEntry(ocrLanguageTag(tag))?.nativeName ?? tag}</span>
              </label>
            ))}
            <label className="checkbox-row">
              <input type="radio" name={groupId} checked={language === 'another'} onChange={() => setLanguage('another')} />
              <span>{t('document.ocrLanguage.another')}</span>
            </label>
          </fieldset>
          <p className="hint" id={`${groupId}-hint`}>
            {t('document.ocrLanguage.handwriting')}
          </p>
          {stage.another && <StatusMessage tone="caution">{t('document.ocrLanguage.notYet')}</StatusMessage>}
          <div className="actions">
            <button
              type="button"
              className="button"
              onClick={() => (language === 'another' ? setStage({ kind: 'language', another: true }) : void decode())}
            >
              {t('document.ocrLanguage.continue')}
            </button>
            <button type="button" className="button button--quiet" onClick={onBack}>
              {t('document.ocrLanguage.stop')}
            </button>
          </div>
        </div>
      )}

      {stage.kind === 'decoding' && (
        <div className="section" aria-live="polite">
          <StatusMessage tone="info">{t('document.ocr.preparing')}</StatusMessage>
        </div>
      )}

      {stage.kind === 'preview' && (
        <div className="section stack">
          <img className="document-preview" src={stage.photo.preview.url} alt={t('document.preview.alt', { page: 1 })} />
          <div className="actions">
            <button type="button" className="button" onClick={() => void prepare(stage.photo)}>
              {t('document.preview.read')}
            </button>
            <button type="button" className="button button--secondary" onClick={() => void turn()}>
              {t('document.rotate')}
            </button>
            <button type="button" className="button button--quiet" onClick={onBack}>
              {t('document.ocr.backToStart')}
            </button>
          </div>
        </div>
      )}

      {stage.kind === 'download' && (
        <div className="section stack">
          <h2>{t('document.ocr.download.title')}</h2>
          <p>{t('document.ocr.download.body', { size: Math.max(1, Math.round(stage.bytes / MB)) })}</p>
          <div aria-live="polite">
            {stage.done !== null && (
              <StatusMessage tone="info">
                {t('document.ocr.download.progress', { done: Math.round(stage.done / MB), total: Math.max(1, Math.round(stage.bytes / MB)) })}
              </StatusMessage>
            )}
          </div>
          <div className="actions">
            <button type="button" className="button" disabled={stage.done !== null} onClick={() => void download(stage.photo, stage.bytes)}>
              {t('document.ocr.download.continue')}
            </button>
            <button type="button" className="button button--quiet" onClick={stage.done === null ? () => setStage({ kind: 'preview', photo: stage.photo }) : cancel}>
              {t('document.ocr.cancel')}
            </button>
          </div>
        </div>
      )}

      {stage.kind === 'reading' && (
        <div className="section stack">
          <div aria-live="polite">
            <StatusMessage tone="info">{t('document.ocr.reading', { current: 1, total: 1 })}</StatusMessage>
            {stage.slow && (
              <p>
                {t('document.page.slow')} {t('document.page.slowHint')}
              </p>
            )}
          </div>
          <div className="actions">
            <button type="button" className="button button--secondary" onClick={cancel}>
              {t('document.ocr.cancel')}
            </button>
          </div>
        </div>
      )}

      {(stage.kind === 'retake' || stage.kind === 'noLabels') && (
        <div className="section stack">
          <StatusMessage tone="caution">{t(stage.kind === 'retake' ? 'document.retake.advice' : 'document.noLabels')}</StatusMessage>
          <div className="actions">
            <button type="button" className="button" onClick={onBack}>
              {t('document.retake.again')}
            </button>
          </div>
        </div>
      )}

      {stage.kind === 'error' && (
        <div className="section stack">
          <StatusMessage tone="error">{t(stage.messageKey)}</StatusMessage>
          <div className="actions">
            {stage.retry && photoRef.current === null && (
              <button type="button" className="button" onClick={() => void decode()}>
                {t('document.ocr.retry')}
              </button>
            )}
            <button type="button" className="button button--secondary" onClick={onBack}>
              {t('document.ocr.backToStart')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
