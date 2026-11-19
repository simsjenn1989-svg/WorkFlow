export type Point = { x: number; y: number };
/** Corner order is always top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];

export type Matrix3 = readonly number[]; // row-major, length 9

/**
 * The 3x3 homography mapping the unit square (0,0)-(1,1) onto `quad`.
 *
 * Solved as a plain 8x8 linear system rather than with the usual closed-form shortcut —
 * it is done once per render, so clarity beats micro-optimisation.
 */
export function unitSquareToQuad(quad: Quad): Matrix3 {
  const [tl, tr, br, bl] = quad;
  const src: Point[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  const dst = [tl, tr, br, bl];

  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const s = src[i]!;
    const d = dst[i]!;
    a.push([s.x, s.y, 1, 0, 0, 0, -s.x * d.x, -s.y * d.x]);
    b.push(d.x);
    a.push([0, 0, 0, s.x, s.y, 1, -s.x * d.y, -s.y * d.y]);
    b.push(d.y);
  }

  const h = solve(a, b);
  return [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!, 1];
}

export function invert(m: Matrix3): Matrix3 {
  const [a, b, c, d, e, f, g, h, i] = m as [
    number, number, number, number, number, number, number, number, number,
  ];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) throw new Error('The print area is degenerate — its corners are collinear.');
  return [
    (e * i - f * h) / det,
    (c * h - b * i) / det,
    (b * f - c * e) / det,
    (f * g - d * i) / det,
    (a * i - c * g) / det,
    (c * d - a * f) / det,
    (d * h - e * g) / det,
    (b * g - a * h) / det,
    (a * e - b * d) / det,
  ];
}

export function apply(m: Matrix3, p: Point): Point {
  const w = m[6]! * p.x + m[7]! * p.y + m[8]!;
  return {
    x: (m[0]! * p.x + m[1]! * p.y + m[2]!) / w,
    y: (m[3]! * p.x + m[4]! * p.y + m[5]!) / w,
  };
}

/** Gaussian elimination with partial pivoting. */
function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(m[row]![col]!) > Math.abs(m[pivot]![col]!)) pivot = row;
    }
    if (Math.abs(m[pivot]![col]!) < 1e-12) {
      throw new Error('The print area is degenerate — its corners are collinear.');
    }
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];

    const p = m[col]![col]!;
    for (let j = col; j <= n; j++) m[col]![j]! /= p;

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = m[row]![col]!;
      if (factor === 0) continue;
      for (let j = col; j <= n; j++) m[row]![j]! -= factor * m[col]![j]!;
    }
  }

  return m.map((row) => row[n]!);
}

/** Area of a quad in square pixels, by the shoelace formula. Sign is discarded. */
export function quadArea(quad: Quad): number {
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i]!;
    const b = quad[(i + 1) % 4]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/**
 * Reject a print area too small or too thin to hold a visible print.
 *
 * Without this a collapsed quad — four corners dragged onto nearly the same line — saves
 * happily and then renders nothing at all, which looks like a broken renderer rather than a
 * badly marked area.
 */
export function describeAreaProblem(
  quad: Quad,
  imageWidth: number,
  imageHeight: number,
): string | null {
  const area = quadArea(quad);
  const imageArea = imageWidth * imageHeight;
  if (imageArea <= 0) return 'That mockup image has no size.';

  if (area / imageArea < 0.002) {
    return 'That print area is too small to hold a design. Drag the corners further apart.';
  }

  const xs = quad.map((p) => p.x);
  const ys = quad.map((p) => p.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  if (width < 8 || height < 8) {
    return 'That print area has collapsed to a line. Drag the corners apart.';
  }

  return null;
}

/** Axis-aligned bounds of a quad, clamped to the image and rounded outward. */
export function boundsOf(quad: Quad, width: number, height: number) {
  const xs = quad.map((p) => p.x);
  const ys = quad.map((p) => p.y);
  return {
    left: Math.max(0, Math.floor(Math.min(...xs))),
    top: Math.max(0, Math.floor(Math.min(...ys))),
    right: Math.min(width, Math.ceil(Math.max(...xs))),
    bottom: Math.min(height, Math.ceil(Math.max(...ys))),
  };
}
