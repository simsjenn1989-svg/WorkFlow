import sharp from 'sharp';
import { apply, boundsOf, invert, unitSquareToQuad, type Quad } from './homography';

export type AreaMeasurement = {
  /** Median blurred luminance inside the area — the baseline the light map divides by. */
  baseLuma: number;
  /** Mean colour inside the area: the garment's actual tone, which is rarely pure black. */
  garmentHex: string;
  /** Spread of the fold lighting, as a fraction of the baseline. */
  foldRange: number;
};

/**
 * Measure a marked print area without compositing anything.
 *
 * Run when an area is saved, so the template records what its garment actually looks like
 * rather than the renderer assuming. `foldRange` is reported so the editor can warn when an
 * area has been marked somewhere almost flat — a background wall, say — where a print would
 * have no drape to sit in.
 */
export async function measureArea(photo: Buffer, quad: Quad): Promise<AreaMeasurement> {
  const base = sharp(photo).rotate();
  const meta = await base.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) throw new Error('That mockup image could not be read.');

  const resized = await base.removeAlpha().toBuffer();
  const { data: rgb } = await sharp(resized).raw().toBuffer({ resolveWithObject: true });
  const { data: low } = await sharp(resized)
    .greyscale()
    .blur(Math.max(2, Math.round(width / 220)))
    .raw()
    .toBuffer({ resolveWithObject: true });

  const toUnit = invert(unitSquareToQuad(quad));
  const bounds = boundsOf(quad, width, height);

  const lumas: number[] = [];
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  const step = Math.max(
    1,
    Math.floor(Math.min(bounds.right - bounds.left, bounds.bottom - bounds.top) / 160),
  );

  for (let y = bounds.top; y < bounds.bottom; y += step) {
    for (let x = bounds.left; x < bounds.right; x += step) {
      const u = apply(toUnit, { x: x + 0.5, y: y + 0.5 });
      if (u.x < 0 || u.x > 1 || u.y < 0 || u.y > 1) continue;
      const i = (y * width + x) * 3;
      r += rgb[i]!;
      g += rgb[i + 1]!;
      b += rgb[i + 2]!;
      lumas.push(low[y * width + x]!);
      n++;
    }
  }
  if (n === 0) throw new Error('The print area does not overlap the image.');

  lumas.sort((a, z) => a - z);
  const baseLuma = Math.max(1, lumas[Math.floor(lumas.length / 2)]!);
  const p5 = lumas[Math.floor(lumas.length * 0.05)]!;
  const p95 = lumas[Math.floor(lumas.length * 0.95)]!;

  const hx = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  return {
    baseLuma: Math.round(baseLuma),
    garmentHex: `#${hx(r / n)}${hx(g / n)}${hx(b / n)}`,
    foldRange: Number(((p95 - p5) / baseLuma).toFixed(3)),
  };
}
