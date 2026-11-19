/**
 * src/frontend/document/decode.ts
 *
 * Page decoding for photos (formbridge-any-document Requirements 3.3 to 3.6,
 * 7.1, 7.2, design Q6). A photo is decoded to one full-size bitmap, drawn once
 * onto a canvas whose long edge is 2,200 px (the Working_Image), and the
 * bitmap is closed at once, so at most one full-size bitmap exists at a time.
 * EXIF orientation is applied exactly once: by the browser's decoder when it
 * does so, otherwise here. The user's rotation is added on top.
 *
 * Everything that touches the browser is injected (`DecodeDeps`), so the
 * limits, the single-bitmap rule and the errors are tested with fakes.
 */

import { displayedSize, readImageHeader } from '../../lib/document/image-header.js';
import { IMAGE_HEADER_READ_MAX, MAX_DECODED_PIXELS, PREVIEW_LONG_EDGE, WORKING_LONG_EDGE } from '../../lib/document/limits.js';
import { drawMatrix, uprightTransform, workingImageSize } from '../../lib/document/orientation.js';
import type { Rotation } from '../../lib/document/types.js';
import { exifProbeBlob } from './probe-jpeg.js';

export type PageErrorCode = 'decode-failed' | 'encrypted' | 'truncated' | 'render-failed';

/** A typed failure for one page. The message never holds document content. */
export class PageError extends Error {
  constructor(readonly code: PageErrorCode) {
    super(code);
    this.name = 'PageError';
  }
}

export interface BitmapLike {
  width: number;
  height: number;
  close(): void;
}

export interface Context2dLike {
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  drawImage(image: unknown, dx: number, dy: number, dw: number, dh: number): void;
}

export interface CanvasLike {
  width: number;
  height: number;
  getContext(kind: '2d'): Context2dLike | null;
  toBlob(callback: (blob: Blob | null) => void, type: string, quality: number): void;
}

export interface DecodeDeps {
  createImageBitmap(blob: Blob, options: { imageOrientation: 'from-image' | 'none' }): Promise<BitmapLike>;
  createCanvas(width: number, height: number): CanvasLike;
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}

export function browserDecodeDeps(): DecodeDeps {
  return {
    createImageBitmap: (blob, options) => createImageBitmap(blob, options),
    createCanvas: (width, height) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas as unknown as CanvasLike;
    },
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
  };
}

/**
 * True when the browser applies EXIF orientation while decoding (the probe,
 * 2 x 1 px with orientation 6, comes back 1 x 2). Run once per page load.
 */
export async function detectDecoderOrientation(deps: Pick<DecodeDeps, 'createImageBitmap'>): Promise<boolean> {
  const bitmap = await deps.createImageBitmap(exifProbeBlob(), { imageOrientation: 'from-image' });
  const applies = bitmap.width === 1 && bitmap.height === 2;
  bitmap.close();
  return applies;
}

export interface DecodedPhoto {
  /** The Working_Image: long edge 2,200 px, upright, with the user's rotation applied. */
  canvas: CanvasLike;
  width: number;
  height: number;
  /** A JPEG of the page for Page_Crops, as an object URL. Revoke it with `discardPreview`. */
  preview: { url: string; scale: number };
  exifOrientation: number;
}

export type DecodeOutcome = { kind: 'ok'; photo: DecodedPhoto } | { kind: 'skipped-too-large'; pixels: number; width: number; height: number };

function toBlob(canvas: CanvasLike, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new PageError('render-failed'))), 'image/jpeg', quality);
  });
}

/**
 * Decodes one JPEG or PNG. `userRotation` is the number of degrees the user
 * turned the page with the rotate control (Requirement 7.2). An image over the
 * pixel limit is skipped before any bitmap exists (Requirement 3.3).
 */
export async function decodePhoto(file: Blob, deps: DecodeDeps, decoderApplies: boolean, userRotation: Rotation = 0): Promise<DecodeOutcome> {
  const head = new Uint8Array(await file.slice(0, IMAGE_HEADER_READ_MAX).arrayBuffer());
  const header = readImageHeader(head);
  if (!header) throw new PageError('decode-failed');
  const shown = displayedSize(header);
  const pixels = shown.width * shown.height;
  if (pixels > MAX_DECODED_PIXELS) return { kind: 'skipped-too-large', pixels, width: shown.width, height: shown.height };

  let bitmap: BitmapLike;
  try {
    bitmap = await deps.createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // The browser refused the bytes: truncated and damaged files both end here.
    throw new PageError('decode-failed');
  }

  try {
    const exif = uprightTransform(header.orientation, decoderApplies);
    const rotation = (((exif.rotation + userRotation) % 360) as Rotation);
    const quarter = rotation === 90 || rotation === 270;
    // The picture as the bitmap holds it (already upright when the decoder applied EXIF), before our turn.
    const bw = bitmap.width;
    const bh = bitmap.height;
    const turnedW = quarter ? bh : bw;
    const turnedH = quarter ? bw : bh;
    const size = workingImageSize(turnedW, turnedH, WORKING_LONG_EDGE);
    const canvas = deps.createCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new PageError('render-failed');

    // Draw the bitmap scaled by `size.scale`, mirrored first when EXIF says so, then turned clockwise.
    const dw = bw * size.scale;
    const dh = bh * size.scale;
    ctx.setTransform(...drawMatrix({ mirror: exif.mirror, rotation }, dw, dh));
    ctx.drawImage(bitmap, 0, 0, dw, dh);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    const previewScale = Math.min(1, PREVIEW_LONG_EDGE / Math.max(size.width, size.height));
    const previewCanvas = deps.createCanvas(Math.max(1, Math.round(size.width * previewScale)), Math.max(1, Math.round(size.height * previewScale)));
    const pctx = previewCanvas.getContext('2d');
    if (!pctx) throw new PageError('render-failed');
    pctx.drawImage(canvas, 0, 0, previewCanvas.width, previewCanvas.height);
    const url = deps.createObjectURL(await toBlob(previewCanvas, 0.8));
    previewCanvas.width = 0;
    previewCanvas.height = 0;

    return { kind: 'ok', photo: { canvas, width: size.width, height: size.height, preview: { url, scale: previewScale }, exifOrientation: header.orientation } };
  } finally {
    // The one full-size bitmap is closed before anything else happens (Requirement 3.5).
    bitmap.close();
  }
}

/** Release a Working_Image once it has been recognised. */
export function releaseCanvas(canvas: CanvasLike): void {
  canvas.width = 0;
  canvas.height = 0;
}

/** Revoke a preview URL when its page or the whole model is discarded. */
export function discardPreview(preview: { url: string } | null, deps: Pick<DecodeDeps, 'revokeObjectURL'>): void {
  if (preview) deps.revokeObjectURL(preview.url);
}
