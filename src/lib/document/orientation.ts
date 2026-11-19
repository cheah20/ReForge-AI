/**
 * src/lib/document/orientation.ts
 *
 * Pure orientation and size maths (formbridge-any-document Requirements 3.4,
 * 6.6, 7.1, 7.2, design Q6): which transform makes a photo upright exactly
 * once, 90 degree rotation, box mapping into the upright frame and the
 * Working_Image size.
 */

import type { Box, Rotation } from './types.js';

export interface UprightTransform {
  /** Mirror left to right first. */
  mirror: boolean;
  /** Then rotate clockwise by this many degrees. */
  rotation: Rotation;
}

const IDENTITY: UprightTransform = { mirror: false, rotation: 0 };

/** EXIF orientation 1..8 to the transform that makes the picture upright. */
const EXIF_TRANSFORMS: Record<number, UprightTransform> = {
  1: IDENTITY,
  2: { mirror: true, rotation: 0 },
  3: { mirror: false, rotation: 180 },
  4: { mirror: true, rotation: 180 },
  5: { mirror: true, rotation: 270 },
  6: { mirror: false, rotation: 90 },
  7: { mirror: true, rotation: 90 },
  8: { mirror: false, rotation: 270 },
};

/**
 * The EXIF transform is applied exactly once: when the browser's decoder
 * already applies it (`decoderApplies`), nothing is applied here. An
 * orientation outside 1..8 counts as 1.
 */
export function uprightTransform(exif: number, decoderApplies: boolean): UprightTransform {
  if (decoderApplies) return IDENTITY;
  return EXIF_TRANSFORMS[exif] ?? IDENTITY;
}

/**
 * The canvas matrix [a, b, c, d, e, f] that draws a w x h picture mirrored
 * (when asked) and then turned clockwise: x' = a*x + c*y + e, y' = b*x + d*y + f.
 * The picture lands exactly on the turned canvas, whose size is `rotatedSize`.
 */
export function drawMatrix(t: UprightTransform, w: number, h: number): [number, number, number, number, number, number] {
  const flip = (x: number, y: number): [number, number] => (t.mirror ? [w - x, y] : [x, y]);
  const turn = ([x, y]: [number, number]): [number, number] => {
    switch (t.rotation) {
      case 90:
        return [h - y, x];
      case 180:
        return [w - x, h - y];
      case 270:
        return [y, w - x];
      default:
        return [x, y];
    }
  };
  const p = (x: number, y: number) => turn(flip(x, y));
  const [e, f] = p(0, 0);
  const [x1, y1] = p(1, 0);
  const [x2, y2] = p(0, 1);
  return [x1 - e, y1 - f, x2 - e, y2 - f, e, f];
}

/** One press of the rotate control: 90 degrees clockwise (Requirement 7.2). */
export function nextRotation(r: Rotation): Rotation {
  return (((r + 90) % 360) as Rotation);
}

/** Size after turning a width x height picture clockwise by `rotation`. */
export function rotatedSize(width: number, height: number, rotation: Rotation): { width: number; height: number } {
  return rotation === 90 || rotation === 270 ? { width: height, height: width } : { width, height };
}

/** Maps a box of a width x height picture into the frame of the picture turned clockwise by `rotation`. */
export function mapBoxToUpright(box: Box, width: number, height: number, rotation: Rotation): Box {
  const point = (x: number, y: number): [number, number] => {
    switch (rotation) {
      case 90:
        return [height - y, x];
      case 180:
        return [width - x, height - y];
      case 270:
        return [y, width - x];
      default:
        return [x, y];
    }
  };
  const [x1, y1] = point(box.left, box.top);
  const [x2, y2] = point(box.right, box.bottom);
  return { left: Math.min(x1, x2), top: Math.min(y1, y2), right: Math.max(x1, x2), bottom: Math.max(y1, y2) };
}

/**
 * Working_Image size: scaled up or down so the long edge equals `longEdge`,
 * keeping the aspect ratio to within 1 px (Requirement 3.4).
 */
export function workingImageSize(width: number, height: number, longEdge: number): { width: number; height: number; scale: number } {
  const scale = longEdge / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}
