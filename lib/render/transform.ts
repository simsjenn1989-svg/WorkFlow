import type { NormPoint, NormQuad } from '@/lib/mockups';

/**
 * Whole-area manipulation.
 *
 * Corners alone can express any shape, but nudging a print up by a few millimetres means
 * moving four of them by the same amount without disturbing the shape — which is fiddly
 * enough that it stops being worth doing. These move, scale and rotate the area as one.
 *
 * Coordinates are fractions of the image, so x and y are not the same length on screen.
 * Moving and scaling are unaffected: both axes carry the same factor either way. Rotation
 * is not, so it converts to a square space first, turns, and converts back — otherwise a
 * rotated area shears instead of turning.
 */

export function centroidOf(corners: NormQuad): NormPoint {
  return {
    x: (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4,
    y: (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4,
  };
}

const clamp = (v: number) => Math.min(1.2, Math.max(-0.2, v));

export function moveQuad(corners: NormQuad, dx: number, dy: number): NormQuad {
  return corners.map((p) => ({ x: clamp(p.x + dx), y: clamp(p.y + dy) })) as NormQuad;
}

export function scaleQuad(corners: NormQuad, factor: number): NormQuad {
  const c = centroidOf(corners);
  return corners.map((p) => ({
    x: clamp(c.x + (p.x - c.x) * factor),
    y: clamp(c.y + (p.y - c.y) * factor),
  })) as NormQuad;
}

/**
 * Rotate about the centre by `degrees`.
 *
 * `aspect` is the image's width divided by its height. Without it a 45° turn on a 4:3 photo
 * comes out as a shear, because a step in x covers more of the picture than the same step
 * in y.
 */
export function rotateQuad(corners: NormQuad, degrees: number, aspect: number): NormQuad {
  const c = centroidOf(corners);
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  return corners.map((p) => {
    // Into a space where one unit is the same length on both axes.
    const x = (p.x - c.x) * aspect;
    const y = p.y - c.y;
    const rx = x * cos - y * sin;
    const ry = x * sin + y * cos;
    return { x: clamp(c.x + rx / aspect), y: clamp(c.y + ry) };
  }) as NormQuad;
}

/** Even-odd ray cast. Used to tell which area a press inside the picture belongs to. */
export function isInsideQuad(corners: NormQuad, point: NormPoint): boolean {
  let inside = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    const a = corners[i]!;
    const b = corners[j]!;
    const straddles = a.y > point.y !== b.y > point.y;
    if (straddles && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}
