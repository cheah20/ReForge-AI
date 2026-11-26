/**
 * src/frontend/document/crops.ts
 *
 * formbridge-any-document task 11.7 (Requirements 12.2, 12.7, 23.6). The part
 * of the page preview around one Label_Candidate, so the user sees the line in
 * its place with the space where the answer goes. Pure geometry: the preview is
 * the downscaled JPEG the page already holds (`Page.preview`), and nothing is
 * drawn, stored or sent anywhere else. The image is shown inside a clipping
 * frame, so the browser does the drawing and the crop stays an ordinary `img`
 * with a text alternative.
 */
import type { Box } from '../../lib/document/types.js';

/** A rectangle of the preview image, in preview pixels. */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropSize {
  width: number;
  height: number;
}

/** The two crops: a small one beside the candidate, and a larger one with more of the page around it for the dialog. */
export type CropContext = 'thumbnail' | 'dialog';

/** Share of the page width a crop shows at least, so the space to the right of a short label is visible. */
const MIN_WIDTH_SHARE: Record<CropContext, number> = { thumbnail: 0.5, dialog: 0.9 };
/** Lines of padding above and below the line, as a multiple of the line height. */
const PAD_LINES: Record<CropContext, number> = { thumbnail: 0.9, dialog: 2.5 };
const MIN_PAD = 8;

/**
 * The preview rectangle for a line `box` (page units, upright as displayed) on a page of `page` size.
 * `scale` is preview pixels per page unit. The rectangle always lies inside the preview and, when the box
 * fits the page, contains the whole box.
 */
export function cropRect(page: CropSize, box: Box, scale: number, context: CropContext = 'thumbnail'): CropRect {
  const previewW = Math.max(1, Math.round(page.width * scale));
  const previewH = Math.max(1, Math.round(page.height * scale));
  const left = Math.min(box.left, box.right) * scale;
  const right = Math.max(box.left, box.right) * scale;
  const top = Math.min(box.top, box.bottom) * scale;
  const bottom = Math.max(box.top, box.bottom) * scale;
  const pad = Math.max(MIN_PAD, (bottom - top) * PAD_LINES[context]);
  const width = Math.min(previewW, Math.max(right - left + 2 * pad, previewW * MIN_WIDTH_SHARE[context]));
  const height = Math.min(previewH, bottom - top + 2 * pad);
  // Start a little left of the line and keep the rectangle inside the preview.
  const x = Math.min(Math.max(0, left - pad), previewW - width);
  const y = Math.min(Math.max(0, top - pad), previewH - height);
  // Round the two edges, not the position and the size, so the rectangle cannot round past the preview's last pixel.
  const x0 = Math.min(previewW - 1, Math.round(x));
  const y0 = Math.min(previewH - 1, Math.round(y));
  const x1 = Math.min(previewW, Math.max(x0 + 1, Math.round(x + width)));
  const y1 = Math.min(previewH, Math.max(y0 + 1, Math.round(y + height)));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export interface CropStyle {
  /** The clipping frame, in CSS pixels. */
  frame: { width: number; height: number };
  /** The whole preview image, moved so the rectangle fills the frame. */
  image: { width: number; height: number; marginLeft: number; marginTop: number };
}

/** CSS sizes that show `rect` of a preview of `previewSize` at `zoom` preview pixels per CSS pixel (1 = natural size). */
export function cropStyle(rect: CropRect, previewSize: CropSize, zoom: number): CropStyle {
  return {
    frame: { width: rect.width * zoom, height: rect.height * zoom },
    image: { width: previewSize.width * zoom, height: previewSize.height * zoom, marginLeft: -rect.x * zoom, marginTop: -rect.y * zoom },
  };
}

/** The preview's size in preview pixels. */
export function previewSizeOf(page: CropSize, scale: number): CropSize {
  return { width: Math.max(1, Math.round(page.width * scale)), height: Math.max(1, Math.round(page.height * scale)) };
}

/** Zoom steps of the enlarged crop (Requirement 12.7): 100% to 400% in 50% steps. */
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;
export const ZOOM_STEP = 0.5;

export function stepZoom(zoom: number, direction: 1 | -1): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((zoom + direction * ZOOM_STEP) * 100) / 100));
}
