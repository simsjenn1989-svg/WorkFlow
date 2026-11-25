import sharp from 'sharp';
import { BUCKET, db } from '@/lib/supabase';

/**
 * The artwork a mockup render should be composited from.
 *
 * Not the print canvas. That file exists to be sent to Printify: 4494x5097, PNG, 16-27 MB.
 * The renderer warps it into a quad measured in photo pixels, and across these mockups the
 * widest quad is 1902px — so better than half the canvas's detail is thrown away by the
 * warp, after being downloaded in full. Measured: every render pulled 17 MB, and one batch
 * of 325 was 5.6 GB of egress, which is most of a month's allowance on the free plan.
 *
 * A 2400px WebP copy of the same canvas is 0.68 MB, still 1.26x the widest quad, and the
 * renders are indistinguishable. Rendered four mockups both ways and compared every pixel
 * at full output resolution: mean absolute difference 0.16 to 0.29 out of 255, with the
 * largest differences on the anti-aliased rim of an outline, where any resample differs.
 * Nothing about placement, size or framing can change, because those come from the quad
 * rather than from the file.
 *
 * Only the renderer uses this. Printify still gets the canvas, downloads still hand over
 * the original, and the render it produces is the same JPEG as before.
 */

/** 1.26x the widest print area measured across these mockups, which is ample for a warp. */
export const RENDER_WIDTH = 2400;

/** Where a canvas's render copy lives. Derived, so it needs no column of its own — and the
 *  canvas path already carries a hash of its bytes, so a rebuilt canvas gets a new copy. */
export function renderCopyPath(canvasPath: string): string {
  return canvasPath.replace('/print-ready/', '/render-ready/').replace(/\.png$/, '.webp');
}

/** Make the render copy from canvas bytes already in hand. */
export async function buildRenderCopy(canvas: Buffer): Promise<Buffer> {
  return sharp(canvas).resize({ width: RENDER_WIDTH, withoutEnlargement: true }).webp({ quality: 90 }).toBuffer();
}

/**
 * Bytes to composite, preferring the render copy.
 *
 * Builds and stores one the first time it is needed, the same way thumbnails work, so no
 * backfill is required: an artwork approved before this existed pays one full download
 * once and never again.
 */
export async function renderSource(path: string): Promise<Buffer> {
  if (!path.includes('/print-ready/')) {
    const plain = await db().storage.from(BUCKET).download(path);
    if (plain.error || !plain.data) throw new Error('A design image could not be read.');
    return Buffer.from(await plain.data.arrayBuffer());
  }

  const copyPath = renderCopyPath(path);
  const existing = await db().storage.from(BUCKET).download(copyPath);
  if (!existing.error && existing.data) return Buffer.from(await existing.data.arrayBuffer());

  const canvas = await db().storage.from(BUCKET).download(path);
  if (canvas.error || !canvas.data) throw new Error('A design image could not be read.');
  const bytes = Buffer.from(await canvas.data.arrayBuffer());

  const copy = await buildRenderCopy(bytes);
  // Storing is best effort: a failure costs the next render another full download, which
  // is worse than this one failing would be.
  await db()
    .storage.from(BUCKET)
    .upload(copyPath, copy, { contentType: 'image/webp', upsert: true })
    .catch(() => undefined);

  return copy;
}
