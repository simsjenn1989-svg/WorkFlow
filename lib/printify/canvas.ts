import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { BUCKET, db } from '@/lib/supabase';
import { defaultPreset } from './presets';
import { buildRenderCopy, renderCopyPath } from '@/lib/render/source';
import { DEFAULT_RULES, PRINT_DPI, placeArtwork, type PlacementRules } from './geometry';

/**
 * One canvas, the exact size of the print area, with the art already placed on it.
 *
 * Before this, an approved design's file was whatever the model happened to produce: its own
 * aspect ratio, its own pixel size, and however much empty space it felt like leaving around
 * the art. Two consequences, both visible:
 *
 *   - On a mockup, the marked area is filled with the WHOLE file, padding included. A design
 *     generated with wide margins therefore printed small and floated inside the area, and a
 *     square file in a portrait area printed smaller still. Every design needed its own
 *     fiddling with the corners, which defeats the point of marking an area once.
 *   - The size and position rules lived only in the Printify push, as coordinates sent with
 *     the file. So what a mockup showed and what Printify printed were two different
 *     calculations that only happened to agree.
 *
 * Normalising at approval fixes both at once. The art is trimmed to its visible pixels,
 * scaled to the size the rules allow, and composited onto a transparent canvas that IS the
 * print area. Afterwards every approved design is the same pixel size with its art in the
 * same place, a mockup area can be marked once and reused, and the push sends the canvas
 * whole — so the mockup and the print are the same arithmetic rather than two that match by
 * luck.
 */

/** Comfort Colors 1717 through Printify Choice, when no preset says otherwise. */
export const FALLBACK_AREA = { width: 4494, height: 5097 };

export type CanvasResult = {
  png: Buffer;
  width: number;
  height: number;
  /** The art's own box within the canvas, in pixels. */
  art: { left: number; top: number; width: number; height: number };
  widthIn: number;
  heightIn: number;
  topIn: number;
  trimmed: boolean;
  /** True when the source was smaller than the placed size and had to be enlarged. */
  enlarged: boolean;
};

/**
 * Crop to the pixels you can actually see.
 *
 * `sharp.trim()` compares colours and treats any alpha above zero as content, which sounds
 * right and is not. The background cutout feathers the rim of every shape, and a PNG of a
 * keyed image carries a halo of alpha 1 to 8 — invisible on any screen and at any print
 * size, but enough to count.
 *
 * Measured on the raccoon: visible art ends 2246px down a 3840px file, and alpha above zero
 * runs to 3280px. Trimming on "above zero" therefore declared the art 46% taller than it
 * is, so fitting it to the print area's height made the visible graphic 11.1 x 12.0in
 * instead of filling the panel — the design looked too small and sat too high, with no
 * empty space anywhere to explain why.
 *
 * 8 of 255 is about 3% opacity. Nothing a person can see survives below it.
 */
const INVISIBLE_ALPHA = 8;

/**
 * How much of a row or column must be above the alpha cut for it to count as the edge.
 *
 * One pixel is not an edge. Measured on a real design: the art ended at column 1620, and a
 * single pixel at alpha 9-31 in column 1775 — the last column of the file — stretched the
 * trim box 155 columns past it. Centring that box then put the visible art 78px left of
 * centre, which is the "you didn't centre the designs" everyone can see on a mockup.
 *
 * 0.2% of the opposite dimension, or two pixels, whichever is more: 5 rows on a 2368px-tall
 * design. A real edge — even a soft one — spans far more than that; dust spans one.
 */
const EDGE_FRACTION = 0.002;

export async function trimByAlpha(source: Buffer, cut = INVISIBLE_ALPHA): Promise<Buffer> {
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  const columns = new Int32Array(width);
  const rows = new Int32Array(height);
  for (let y = 0; y < height; y++) {
    const offset = y * width;
    for (let x = 0; x < width; x++) {
      if (data[(offset + x) * channels + 3]! <= cut) continue;
      columns[x]!++;
      rows[y]!++;
    }
  }

  const edge = (counts: Int32Array, across: number) => {
    const need = Math.max(2, Math.round(across * EDGE_FRACTION));
    let from = counts.findIndex((n) => n >= need);
    let to = counts.length - 1;
    while (to >= 0 && counts[to]! < need) to--;

    // A design thinner than the threshold anywhere — a hairline — would come back empty.
    // Fall back to any pixel at all rather than trimming it out of existence.
    if (from < 0 || to < from) {
      from = counts.findIndex((n) => n > 0);
      to = counts.length - 1;
      while (to >= 0 && counts[to]! === 0) to--;
    }
    return { from, to };
  };

  const x = edge(columns, height);
  const y = edge(rows, width);

  // Nothing visible at all: hand back what came in rather than an empty extract, and let
  // the caller's own "this cut out the design" checks deal with it.
  if (x.from < 0 || y.from < 0 || x.to < x.from || y.to < y.from) return source;

  return sharp(source)
    .extract({ left: x.from, top: y.from, width: x.to - x.from + 1, height: y.to - y.from + 1 })
    .png()
    .toBuffer();
}

/** The print area every approved design is normalised to: the default preset's, or the tee's. */
export async function printAreaSize(): Promise<{ width: number; height: number }> {
  const preset = await defaultPreset();
  const width = preset?.print_width_px ?? 0;
  const height = preset?.print_height_px ?? 0;
  return width > 0 && height > 0 ? { width, height } : FALLBACK_AREA;
}

/** True when a file is already a normalised canvas for this area. */
export function isCanvasSized(
  image: { width?: number | null; height?: number | null },
  area: { width: number; height: number },
): boolean {
  return image.width === area.width && image.height === area.height;
}

export async function buildPrintCanvas(
  source: Buffer,
  area: { width: number; height: number },
  rules?: Partial<PlacementRules>,
  /**
   * How to reach the placed size. Lanczos by default; the push passes the Atlas upscaler
   * when it was paid for, so the option keeps working now that the canvas is what gets
   * uploaded rather than the bare art.
   */
  enlarge?: (image: Buffer, width: number, height: number) => Promise<Buffer>,
): Promise<CanvasResult> {
  // Trim first, always. Every number below is about where the ART sits, and without this
  // "the top of the art" means the top of whatever empty space the model generated.
  const before = await sharp(source).metadata();
  const trimmedBuffer = await trimByAlpha(source);
  const art = await sharp(trimmedBuffer).metadata();
  const artWidth = art.width ?? 0;
  const artHeight = art.height ?? 0;
  if (!artWidth || !artHeight) throw new Error('That design image has no readable size.');

  const placed = placeArtwork({
    artWidthPx: artWidth,
    artHeightPx: artHeight,
    areaWidthPx: area.width,
    areaHeightPx: area.height,
    rules,
  });

  const width = Math.round(placed.widthIn * PRINT_DPI);
  const height = Math.round(placed.heightIn * PRINT_DPI);

  // `y` is the art's centre as a fraction of the area, which is what Printify wants; here
  // the top-left corner is what sharp wants. Deriving one from the other rather than
  // recomputing it keeps the canvas and the push in step by construction.
  const left = Math.round((area.width - width) / 2);
  const top = Math.max(0, Math.min(area.height - height, Math.round(placed.y * area.height - height / 2)));

  const scaled = enlarge
    ? await enlarge(trimmedBuffer, width, height)
    : await sharp(trimmedBuffer).resize(width, height, { kernel: 'lanczos3', fit: 'fill' }).png().toBuffer();

  const png = await sharp({
    create: {
      width: area.width,
      height: area.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: scaled, left, top }])
    .png({ compressionLevel: 9 })
    .toBuffer();

  return {
    png,
    width: area.width,
    height: area.height,
    art: { left, top, width, height },
    widthIn: placed.widthIn,
    heightIn: placed.heightIn,
    topIn: placed.topIn,
    trimmed: art.width !== before.width || art.height !== before.height,
    enlarged: width > artWidth,
  };
}

/**
 * Normalise every artwork a design holds, replacing any canvas built earlier.
 *
 * Runs when a keeper is picked or art is added, which is the moment the design becomes a
 * thing you put on products. Failure is reported but not fatal anywhere it is called from:
 * the artwork still exists, and the renderer falls back to the raw image exactly as it did
 * before this existed.
 */
export async function normaliseDesign(
  designId: string,
  rules?: Partial<PlacementRules>,
): Promise<{ label: string; error: string | null; result: CanvasResult | null }[]> {
  const area = await printAreaSize();
  /*
    The preset's own rules for each placement — the drop below the collar and the size caps
    set in the preset editor.
    Moving placement from push time to approval time quietly dropped these: the canvas was
    built from DEFAULT_RULES and then sent whole, so changing "top below collar" in the
    preset would have had no effect on anything. It has none today only because this shop's
    preset overrides nothing.
  */
  const preset = await defaultPreset();
  const { data } = await db()
    .from('design_artworks')
    .select('id,label,image_path,print_ready_path')
    .eq('design_id', designId);

  const rows = (data ?? []) as {
    id: string;
    label: string;
    image_path: string;
    print_ready_path: string | null;
  }[];
  const out: { label: string; error: string | null; result: CanvasResult | null }[] = [];

  for (const row of rows) {
    const previous = row.print_ready_path;
    try {
      const file = await db().storage.from(BUCKET).download(row.image_path);
      if (file.error || !file.data) throw new Error('the image could not be read');

      const built = await buildPrintCanvas(
        Buffer.from(await file.data.arrayBuffer()),
        area,
        { ...preset?.placements[row.label], ...rules },
      );

      /*
        The canvas's own content decides its filename.

        Writing to a fixed path per placement looked tidier and was wrong: `printify_uploads`
        remembers which file it sent by path, so rebuilding a canvas in place left that row
        matching, and the next push would reuse the image Printify already had — the old one.
        A design re-approved after any change would have pushed its previous art. With the
        hash in the name, different bytes are a different path and the push re-uploads by
        construction.
      */
      const digest = createHash('sha1').update(built.png).digest('hex').slice(0, 8);
      const safeLabel = row.label.replace(/\s+/g, '-');
      const path = `designs/${designId}/print-ready/${safeLabel}-${digest}.png`;

      if (path !== previous) {
        const { error } = await db()
          .storage.from(BUCKET)
          .upload(path, built.png, { contentType: 'image/png', upsert: true });
        if (error) throw new Error(error.message);

        await db().from('design_artworks').update({ print_ready_path: path }).eq('id', row.id);

        // The renderer's copy, made here because the canvas bytes are already in hand —
        // so it costs nothing, where making it later costs a full download.
        await db()
          .storage.from(BUCKET)
          .upload(renderCopyPath(path), await buildRenderCopy(built.png), {
            contentType: 'image/webp',
            upsert: true,
          })
          .catch(() => undefined);

        // The canvas this replaces is referenced by nothing once the row is updated. Left
        // behind it is a 20 MB orphan per re-approval, and its render copy with it.
        if (previous) {
          await db().storage.from(BUCKET).remove([previous, renderCopyPath(previous)]);
        }
      }
      out.push({ label: row.label, error: null, result: built });
    } catch (e) {
      out.push({ label: row.label, error: (e as Error).message, result: null });
    }
  }
  return out;
}
