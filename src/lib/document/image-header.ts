/**
 * src/lib/document/image-header.ts
 *
 * Reads width, height and the EXIF orientation from the first bytes of a PNG
 * or JPEG, without decoding the picture, so an image over the pixel limit can
 * be skipped before any bitmap is allocated (formbridge-any-document
 * Requirement 3.3, design Q6). Pure and total: returns null when the header
 * cannot be read, never throws.
 */

import { IMAGE_HEADER_READ_MAX } from './limits.js';

export interface ImageHeader {
  width: number;
  height: number;
  /** EXIF orientation 1 to 8; 1 when there is none. */
  orientation: number;
}

const u16 = (b: Uint8Array, o: number) => (b[o]! << 8) | b[o + 1]!;
const u32 = (b: Uint8Array, o: number) => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;

function readPng(b: Uint8Array): ImageHeader | null {
  if (b.length < 24) return null;
  const width = u32(b, 16);
  const height = u32(b, 20);
  return width > 0 && height > 0 ? { width, height, orientation: 1 } : null;
}

/** Orientation tag (0x0112) from the Exif APP1 payload, which starts at "Exif\0\0". */
function exifOrientation(b: Uint8Array, start: number, end: number): number {
  const tiff = start + 6;
  if (end - tiff < 8) return 1;
  const little = b[tiff] === 0x49 && b[tiff + 1] === 0x49;
  if (!little && !(b[tiff] === 0x4d && b[tiff + 1] === 0x4d)) return 1;
  const r16 = (o: number) => (little ? b[o]! | (b[o + 1]! << 8) : (b[o]! << 8) | b[o + 1]!);
  const r32 = (o: number) => (little ? (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0 : u32(b, o));
  const ifd = tiff + r32(tiff + 4);
  if (ifd + 2 > end) return 1;
  const count = r16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return 1;
    if (r16(entry) === 0x0112) {
      const v = r16(entry + 8);
      return v >= 1 && v <= 8 ? v : 1;
    }
  }
  return 1;
}

function readJpeg(b: Uint8Array): ImageHeader | null {
  const limit = Math.min(b.length, IMAGE_HEADER_READ_MAX);
  let orientation = 1;
  let o = 2;
  while (o + 4 <= limit) {
    if (b[o] !== 0xff) return null;
    const marker = b[o + 1]!;
    if (marker === 0xff) {
      o += 1; // fill byte
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      o += 2; // markers without a length
      continue;
    }
    const length = u16(b, o + 2);
    if (length < 2) return null;
    const segEnd = o + 2 + length;
    if (marker === 0xe1 && b[o + 4] === 0x45 && b[o + 5] === 0x78 && b[o + 6] === 0x69 && b[o + 7] === 0x66) {
      orientation = exifOrientation(b, o + 4, Math.min(segEnd, limit));
    }
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (o + 9 > limit) return null;
      const height = u16(b, o + 5);
      const width = u16(b, o + 7);
      return width > 0 && height > 0 ? { width, height, orientation } : null;
    }
    if (marker === 0xda) return null; // start of scan: no frame header was found
    o = segEnd;
  }
  return null;
}

export function readImageHeader(head: Uint8Array): ImageHeader | null {
  if (head[0] === 0x89 && head[1] === 0x50) return readPng(head);
  if (head[0] === 0xff && head[1] === 0xd8) return readJpeg(head);
  return null;
}

/** Width and height as displayed: orientations 5 to 8 swap them. */
export function displayedSize(h: ImageHeader): { width: number; height: number } {
  return h.orientation >= 5 ? { width: h.height, height: h.width } : { width: h.width, height: h.height };
}
