/**
 * tests/unit/document-decode.test.ts
 *
 * Page decoding for photos (formbridge-any-document task 9.1) with fake
 * decoders: the pixel limit skips an image before any bitmap exists, at most
 * one full-size bitmap is open and it is always closed, EXIF orientation is
 * applied once, the user's rotation turns the page, and previews are revoked.
 * Validates: Requirements 3.3, 3.4, 3.5, 3.6, 7.1, 7.2
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { decodePhoto, detectDecoderOrientation, discardPreview, PageError, releaseCanvas, type BitmapLike, type CanvasLike, type DecodeDeps } from '../../src/frontend/document/decode.js';
import { drawMatrix, rotatedSize, uprightTransform } from '../../src/lib/document/orientation.js';
import type { Rotation } from '../../src/lib/document/types.js';

const doc = (name: string) => new Blob([readFileSync(path.join('fixtures', 'documents', name)) as unknown as BlobPart]);

interface Calls {
  bitmaps: number;
  open: number;
  maxOpen: number;
  canvases: Array<{ width: number; height: number; matrices: number[][]; drawn: Array<[number, number, number, number]> }>;
  revoked: string[];
}

/** Fake browser: a bitmap of a given size, canvases that record their transform, object URLs. */
function fake(bitmapSize: { width: number; height: number }, opts: { failBitmap?: boolean; noContext?: boolean } = {}): { deps: DecodeDeps; calls: Calls } {
  const calls: Calls = { bitmaps: 0, open: 0, maxOpen: 0, canvases: [], revoked: [] };
  const deps: DecodeDeps = {
    async createImageBitmap(): Promise<BitmapLike> {
      if (opts.failBitmap) throw new Error('cannot decode');
      calls.bitmaps++;
      calls.open++;
      calls.maxOpen = Math.max(calls.maxOpen, calls.open);
      return { ...bitmapSize, close: () => void calls.open-- };
    },
    createCanvas(width, height): CanvasLike {
      const rec: Calls['canvases'][number] = { width, height, matrices: [], drawn: [] };
      calls.canvases.push(rec);
      const canvas: CanvasLike = {
        get width() {
          return rec.width;
        },
        set width(v) {
          rec.width = v;
        },
        get height() {
          return rec.height;
        },
        set height(v) {
          rec.height = v;
        },
        getContext: () =>
          opts.noContext
            ? null
            : {
                setTransform: (...m: number[]) => void rec.matrices.push(m),
                drawImage: (_i: unknown, _x: number, _y: number, w: number, h: number) => void rec.drawn.push([_x, _y, w, h]),
              },
        toBlob: (cb) => cb(new Blob(['jpeg'])),
      };
      return canvas;
    },
    createObjectURL: () => `blob:preview-${calls.canvases.length}`,
    revokeObjectURL: (url) => void calls.revoked.push(url),
  };
  return { deps, calls };
}

describe('pixel limit (3.3)', () => {
  it('skips an image over 20 million pixels from its header, before any bitmap or canvas exists', async () => {
    const bytes = new Uint8Array(await doc('clean-en.png').arrayBuffer()).slice(0, 64);
    new DataView(bytes.buffer).setUint32(16, 5000);
    new DataView(bytes.buffer).setUint32(20, 4500);
    const { deps, calls } = fake({ width: 5000, height: 4500 });
    const out = await decodePhoto(new Blob([bytes as unknown as BlobPart]), deps, true);
    expect(out).toEqual({ kind: 'skipped-too-large', pixels: 22_500_000, width: 5000, height: 4500 });
    expect(calls.bitmaps).toBe(0);
    expect(calls.canvases).toHaveLength(0);
  });

  it('accepts exactly 20 million pixels', async () => {
    const bytes = new Uint8Array(await doc('clean-en.png').arrayBuffer());
    new DataView(bytes.buffer).setUint32(16, 5000);
    new DataView(bytes.buffer).setUint32(20, 4000);
    const { deps } = fake({ width: 5000, height: 4000 });
    expect((await decodePhoto(new Blob([bytes as unknown as BlobPart]), deps, true)).kind).toBe('ok');
  });
});

describe('Working_Image and memory (3.4, 3.5)', () => {
  it('scales the long edge to 2,200 px, keeps one bitmap open at a time and closes it', async () => {
    const { deps, calls } = fake({ width: 3024, height: 4032 });
    const bytes = new Uint8Array(await doc('clean-en.jpg').arrayBuffer());
    const out = await decodePhoto(new Blob([bytes as unknown as BlobPart]), deps, true);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(Math.max(out.photo.width, out.photo.height)).toBe(2200);
    expect(out.photo.width).toBe(1650);
    expect(calls.maxOpen).toBe(1);
    expect(calls.open).toBe(0);
    // The working canvas is drawn once; the preview is a smaller copy of it.
    expect(calls.canvases[0]!.drawn).toHaveLength(1);
  });

  it('makes a preview of at most 1,200 px, releases the preview canvas and revokes the URL on discard', async () => {
    const { deps, calls } = fake({ width: 1556, height: 2200 });
    const out = await decodePhoto(doc('clean-en.png'), deps, true);
    if (out.kind !== 'ok') throw new Error('expected ok');
    const preview = calls.canvases[1]!;
    expect(preview.drawn[0]![2]).toBeLessThanOrEqual(1200);
    expect(Math.max(...preview.drawn[0]!.slice(2))).toBe(1200);
    expect(preview.width).toBe(0);
    expect(out.photo.preview.scale).toBeCloseTo(1200 / 2200);
    discardPreview(out.photo.preview, deps);
    expect(calls.revoked).toEqual([out.photo.preview.url]);
    discardPreview(null, deps);
    expect(calls.revoked).toHaveLength(1);
    releaseCanvas(out.photo.canvas);
    expect(out.photo.canvas.width).toBe(0);
  });
});

describe('errors (3.6)', () => {
  it('a file with no readable header, an empty file and a browser refusal are decode-failed, and nothing stays open', async () => {
    const { deps, calls } = fake({ width: 10, height: 10 });
    await expect(decodePhoto(doc('empty.bin'), deps, true)).rejects.toMatchObject({ code: 'decode-failed' });
    expect(calls.bitmaps).toBe(0);
    const refusing = fake({ width: 10, height: 10 }, { failBitmap: true });
    await expect(decodePhoto(doc('clean-en.jpg'), refusing.deps, true)).rejects.toMatchObject({ code: 'decode-failed' });
    // A truncated file has a readable header; the browser's decoder is what refuses it.
    await expect(decodePhoto(doc('truncated.png'), refusing.deps, true)).rejects.toBeInstanceOf(PageError);
    expect(refusing.calls.open).toBe(0);
  });

  it('closes the bitmap even when the canvas has no 2d context, and reports render-failed', async () => {
    const { deps, calls } = fake({ width: 1556, height: 2200 }, { noContext: true });
    await expect(decodePhoto(doc('clean-en.png'), deps, true)).rejects.toMatchObject({ code: 'render-failed' });
    expect(calls.open).toBe(0);
  });
});

describe('EXIF orientation exactly once and the rotate control (7.1, 7.2)', () => {
  it('when the decoder already applied EXIF the bitmap is upright and is drawn with no extra turn', async () => {
    const { deps, calls } = fake({ width: 1556, height: 2200 });
    const out = await decodePhoto(doc('rotated-exif6.jpg'), deps, true);
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(calls.canvases[0]!.matrices[0]).toEqual([1, 0, 0, 1, 0, 0]);
    expect([out.photo.width, out.photo.height]).toEqual([1556, 2200]);
    expect(out.photo.exifOrientation).toBe(6);
  });

  it('when the decoder did not, orientation 6 turns the picture 90 degrees clockwise here', async () => {
    const { deps, calls } = fake({ width: 2200, height: 1556 });
    const out = await decodePhoto(doc('rotated-exif6.jpg'), deps, false);
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect([out.photo.width, out.photo.height]).toEqual([1556, 2200]);
    const m = calls.canvases[0]!.matrices[0]!; // the first transform is the one the picture is drawn with; the last one resets it
    expect([m[0], m[1], m[2], m[3]]).toEqual([0, 1, -1, 0]);
  });

  it('a file with no EXIF tag is drawn upright, and the user\'s rotation turns it by 90 degrees per press', async () => {
    for (const [rotation, size] of [[0, [1556, 2200]], [90, [2200, 1556]], [180, [1556, 2200]], [270, [2200, 1556]]] as Array<[Rotation, number[]]>) {
      const { deps } = fake({ width: 1556, height: 2200 });
      const out = await decodePhoto(doc('clean-en.png'), deps, true, rotation);
      if (out.kind !== 'ok') throw new Error('expected ok');
      expect([out.photo.width, out.photo.height]).toEqual(size);
    }
  });

  it('every EXIF orientation maps the picture exactly onto the turned canvas, and none is applied when the decoder did it', () => {
    const w = 300;
    const h = 200;
    for (let exif = 1; exif <= 8; exif++) {
      const t = uprightTransform(exif, false);
      const [a, b, c, d, e, f] = drawMatrix(t, w, h);
      const size = rotatedSize(w, h, t.rotation);
      const xs: number[] = [];
      const ys: number[] = [];
      for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h]] as const) {
        xs.push(a * x + c * y + e);
        ys.push(b * x + d * y + f);
      }
      expect([Math.min(...xs), Math.max(...xs)]).toEqual([0, size.width]);
      expect([Math.min(...ys), Math.max(...ys)]).toEqual([0, size.height]);
      expect(drawMatrix(uprightTransform(exif, true), w, h)).toEqual([1, 0, 0, 1, 0, 0]);
    }
  });
});

describe('decoder orientation probe', () => {
  it('is true when the probe comes back 1 x 2 and false when it comes back 2 x 1, and closes the bitmap', async () => {
    for (const [size, expected] of [[{ width: 1, height: 2 }, true], [{ width: 2, height: 1 }, false]] as const) {
      const { deps, calls } = fake(size);
      expect(await detectDecoderOrientation(deps)).toBe(expected);
      expect(calls.open).toBe(0);
    }
  });
});
