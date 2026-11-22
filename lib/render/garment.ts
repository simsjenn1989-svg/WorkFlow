import sharp from 'sharp';
import type { NormQuad } from '@/lib/mockups';

/**
 * Finding the garment in a mockup photo, so a print can be sized to the shirt rather than
 * to the picture.
 *
 * This exists because marking areas by eye went wrong in a specific, repeatable way: a box
 * set to "36% of the photo" is a sensible chest print on a close crop, where the shirt
 * fills the frame, and about 80% of the shirt on a wide shot, where it does not. Measured
 * on these mockups the shoulder width ranges from 39% to 66% of the frame, so no fixed
 * fraction of the image can be right for all of them. Measuring the shirt can.
 *
 * The method is deliberately plain: a black garment is dark AND desaturated, which skin,
 * hair, jeans and a lit background are not. Take the longest run of such pixels on each
 * row; the widest of those is the shoulder line, and its midpoint is the garment's centre —
 * which matters as much as the width, because on a seated or angled shot the shirt sits
 * well off the middle of the frame.
 */

export type Garment = {
  /** Shoulder-to-shoulder span, as a fraction of the image width. */
  width: number;
  /** Centre of that span. Not the centre of the photo. */
  centre: number;
  /** Where the neckline ends, as a fraction of the image height. */
  collar: number;
};

/** Dark enough and grey enough to be black fabric rather than skin, hair, denim or room. */
const MAX_LUMA = 105;
const MAX_SATURATION = 55;

export async function detectGarment(photo: Buffer): Promise<Garment | null> {
  // 400px wide is plenty: this is looking for a torso, not an edge.
  const { data, info } = await sharp(photo)
    .rotate()
    .resize({ width: 400 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels } = info;

  const dark = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += channels, p++) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const saturation = Math.max(r, g, b) - Math.min(r, g, b);
    dark[p] = luma < MAX_LUMA && saturation < MAX_SATURATION ? 1 : 0;
  }

  const runs: { len: number; start: number; end: number }[] = [];
  for (let y = 0; y < h; y++) {
    let best = { len: 0, start: 0, end: 0 };
    let from = -1;
    for (let x = 0; x <= w; x++) {
      const on = x < w && dark[y * w + x] === 1;
      if (on && from < 0) from = x;
      if (!on && from >= 0) {
        const len = x - from;
        if (len > best.len) best = { len, start: from, end: x - 1 };
        from = -1;
      }
    }
    runs.push(best);
  }

  const widest = Math.max(...runs.map((r) => r.len));
  // A photo with no garment in it — or one that is not a dark garment.
  if (widest < w * 0.15) return null;

  const shoulderY = runs.findIndex((r) => r.len >= widest * 0.6);
  const shoulder = runs[shoulderY]!;
  const centrePx = Math.round((shoulder.start + shoulder.end) / 2);

  // Down the garment's own centre column, the first dark pixel is the bottom of the
  // neckline: above it is neck and skin, below it is shirt.
  let collarY = shoulderY;
  for (let y = shoulderY; y < h; y++) {
    if (dark[y * w + centrePx] === 1) {
      collarY = y;
      break;
    }
  }

  // Chest width is the median of the rows just below the collar, not the single widest
  // row — one row can catch a shadow or a dark background behind an arm.
  const band = runs
    .slice(collarY, Math.min(h, collarY + Math.round(h * 0.18)))
    .filter((r) => r.len > widest * 0.5)
    .sort((a, b) => a.len - b.len);
  const chest = band[Math.floor(band.length / 2)] ?? shoulder;

  return {
    width: chest.len / w,
    centre: (chest.start + chest.end) / 2 / w,
    collar: collarY / h,
  };
}

/**
 * How much of the shoulder width a chest print covers.
 *
 * Rendered at 0.52 and 0.60 against the same photos and compared with the shop's real
 * Printify listings: 0.52 reads small, 0.60 matches. The sleeves take the rest.
 */
export const PRINT_OF_SHOULDERS = 0.6;

/** Clear of the neckline without floating below the collarbone. */
export const GAP_BELOW_COLLAR = 0.045;

/**
 * A print area over the measured garment.
 *
 * `imageAspect` turns the width into a height: corners are fractions of the image, so a
 * square on screen is not a square in these numbers.
 */
export function areaOverGarment(
  garment: Garment,
  imageAspect: number,
  /** Shape of the box on screen; designs are roughly square, so this is near 1. */
  boxAspect = 0.95,
  /** The half of the photo this garment occupies, for a two-up photo. */
  span: { from: number; width: number } = { from: 0, width: 1 },
): NormQuad {
  const width = garment.width * span.width * PRINT_OF_SHOULDERS;
  const centre = span.from + garment.centre * span.width;
  const top = garment.collar + GAP_BELOW_COLLAR;
  const height = (width / boxAspect) * imageAspect;

  const half = width / 2;
  return [
    { x: centre - half, y: top },
    { x: centre + half, y: top },
    { x: centre + half, y: top + height },
    { x: centre - half, y: top + height },
  ];
}
