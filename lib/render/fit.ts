import sharp from 'sharp';
import { trimByAlpha } from '@/lib/printify/canvas';
import type { Quad } from './homography';

/**
 * The image to warp into a marked area.
 *
 * A mockup's print area and Printify's print area are not the same thing, and treating them
 * as one is what made designs look small on a photograph. Printify's area is a fixed
 * 15 x 17in panel on a real garment; the area marked on a photo is wherever the graphic
 * should appear in THAT shot, on a model who may be cropped at the waist. Feeding the
 * print canvas straight into the renderer meant 3in of empty panel below the art took up a
 * quarter of the marked area, and the design read as floating and undersized.
 *
 * So the renderer gets the art, not the panel. The art is trimmed to its visible pixels and
 * centred on a transparent rectangle shaped like the marked area, which makes "what I marked
 * is where the graphic goes" true again while leaving the Printify canvas untouched.
 *
 * Letterboxed rather than stretched: the renderer warps a whole image onto the quad, so
 * handing it the bare art would squash a tall graphic into a wide area. Fitting inside a
 * correctly shaped rectangle keeps the art's own proportions.
 */
export async function fitToArea(image: Buffer, quad: Quad): Promise<Buffer> {
  const widthPx = (distance(quad[0], quad[1]) + distance(quad[3], quad[2])) / 2;
  const heightPx = (distance(quad[0], quad[3]) + distance(quad[1], quad[2])) / 2;
  if (!(widthPx > 0) || !(heightPx > 0)) return image;
  const areaAspect = widthPx / heightPx;

  const art = await trimByAlpha(image);
  const meta = await sharp(art).metadata();
  const artWidth = meta.width ?? 0;
  const artHeight = meta.height ?? 0;
  if (!artWidth || !artHeight) return image;

  const artAspect = artWidth / artHeight;

  // Work at the art's own resolution so nothing is enlarged here; the warp resamples once,
  // to the size the output actually needs.
  const canvasWidth = artAspect >= areaAspect ? artWidth : Math.round(artHeight * areaAspect);
  const canvasHeight = artAspect >= areaAspect ? Math.round(artWidth / areaAspect) : artHeight;

  return sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: art,
        left: Math.round((canvasWidth - artWidth) / 2),
        top: Math.round((canvasHeight - artHeight) / 2),
      },
    ])
    .png()
    .toBuffer();
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
