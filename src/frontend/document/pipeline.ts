/**
 * src/frontend/document/pipeline.ts
 *
 * The page pipeline for photos (formbridge-any-document Requirements 3.5, 3.8,
 * 9.4, design Q6). One page at a time: decode to the Working_Image, recognise
 * it, release the Working_Image, build the Page. A page over the pixel limit is
 * skipped without any bitmap. A slow page shows a notice after 60 seconds and
 * the work continues until the user decides: nothing here stops by itself.
 *
 * PDF pages (text layer first, rendering) and the 5-page choice belong to
 * Tier B and are added with PDF input.
 */

import { SLOW_PAGE_NOTICE_MS, type OcrLanguage } from '../../lib/document/limits.js';
import { buildCandidates, buildPage, createModel } from '../../lib/document/model.js';
import { isLowQuality } from '../../lib/document/ocr-map.js';
import type { DocumentModel, Page, Rotation } from '../../lib/document/types.js';
import { classifyByValueRules } from '../../lib/document/value-rules.js';
import { releaseCanvas, type DecodeOutcome } from './decode.js';
import type { OcrService } from './ocr.js';

export interface PipelineDeps {
  /** Decodes the photo with the user's rotation applied. */
  decode(file: Blob, rotation: Rotation): Promise<DecodeOutcome>;
  ocr: Pick<OcrService, 'recognize'>;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ReadPhotoOptions {
  file: Blob;
  pageNumber: number;
  /** Number of degrees the user turned the page. */
  rotation: Rotation;
  ocrLanguage: OcrLanguage;
  signal: AbortSignal;
  /** Called once when this page has taken 60 seconds; reading continues. */
  onSlow?: () => void;
}

/**
 * Reads one photo into a Page. A decode failure or an OCR failure is thrown as
 * its typed error (PageError, OcrError): for a single photo that is a whole-file
 * failure and the caller discards everything (Requirement 3.6).
 */
export async function readPhotoPage(deps: PipelineDeps, o: ReadPhotoOptions): Promise<Page> {
  const timer = o.onSlow ? deps.setTimeout(o.onSlow, SLOW_PAGE_NOTICE_MS) : undefined;
  try {
    const decoded = await deps.decode(o.file, o.rotation);
    if (decoded.kind === 'skipped-too-large') {
      return buildPage({ pageNumber: o.pageNumber, width: decoded.width, height: decoded.height, rotation: o.rotation, textSource: 'ocr', lines: [], status: 'skipped-too-large' });
    }
    const { photo } = decoded;
    try {
      const result = await deps.ocr.recognize(photo.canvas, o.ocrLanguage, o.signal);
      return buildPage({
        pageNumber: o.pageNumber,
        width: photo.width,
        height: photo.height,
        rotation: o.rotation,
        textSource: 'ocr',
        lines: result.lines,
        status: isLowQuality(result) ? 'low-quality' : 'ready',
        preview: photo.preview,
        exifOrientation: photo.exifOrientation,
      });
    } finally {
      // The Working_Image is no longer needed once the page is read (Requirement 3.5).
      releaseCanvas(photo.canvas);
    }
  } finally {
    if (timer !== undefined) deps.clearTimeout(timer);
  }
}

/** A one-page model from a photo, with the value rules applied and nothing preselected. */
export function modelFromPhoto(sourceKind: 'jpeg' | 'png', page: Page, ocrLanguage: OcrLanguage, formLanguage: string | null): DocumentModel {
  return createModel(sourceKind, [page], buildCandidates([page], formLanguage, ocrLanguage, classifyByValueRules));
}

/** Rotate or retake: the page is read again from the file, and only the model's candidates for that page are rebuilt. */
export function candidatesForPage(page: Page, ocrLanguage: OcrLanguage, formLanguage: string | null) {
  return buildCandidates([page], formLanguage, ocrLanguage, classifyByValueRules);
}
