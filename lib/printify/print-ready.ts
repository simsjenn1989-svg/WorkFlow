import sharp from 'sharp';
import { BUCKET, db, signedUrl } from '@/lib/supabase';

/**
 * Turning a generated design into a file worth printing.
 *
 * Atlas returns 1024 x 1024. Comfort Colors 1717 through Printify Choice has a print area of
 * 4494 x 5097 on L and up (and 3703 x 4200 on S — the placeholder size varies by variant, and
 * art has to be made for the largest or the big sizes print a scaled-up file). So every design
 * needs roughly a 4x enlargement before it is print art.
 *
 * Two ways to do that, both measured on a real design rather than argued about:
 *
 *   sharp, Lanczos3     free, instant, keeps the alpha channel natively, 3.7 MB.
 *   Atlas upscaler      $0.01, ~20 s, 20.4 MB, and edges come out measurably crisper:
 *                       mean |Laplacian| 1.288 against 0.494 over the same crop.
 *
 * The two results differ by 0.70/255 on average across the whole image (max 18) — the gain is
 * real but confined to a thin band at each edge. For flat generated art that is not worth a
 * cent and a twenty-second wait, so Lanczos is the default and the upscaler is opt-in for
 * designs with fine lettering.
 *
 * One trap worth stating plainly: the Atlas upscaler DISCARDS TRANSPARENCY. A 1024 PNG with a
 * clean alpha channel comes back as 4096 RGB with the formerly transparent background
 * flattened to near-black (measured: 1,1,1). Uploaded to Printify that prints as a black
 * rectangle over the whole print area. `upscaleWithAtlas` therefore re-attaches an alpha
 * channel taken from the original and resized by the same factor; the geometry is an exact
 * 4x on both, so the mask lines up to the pixel.
 */

export type PrintReadyResult = {
  path: string;
  width: number;
  height: number;
  /** Pixels per inch at the blueprint's physical print size, for showing in the UI. */
  dpi: number | null;
  method: 'lanczos' | 'atlas';
  trimmed: boolean;
  /** Set when the source was already big enough and nothing was enlarged. */
  alreadyLargeEnough: boolean;
};

export type PrintReadyOptions = {
  /** The print area to fill, from the preset. */
  targetWidth: number;
  targetHeight: number;
  /** Pay for the Atlas upscaler instead of resizing locally. */
  useAtlas?: boolean;
  /**
   * Crop fully transparent borders first.
   *
   * On by default, because it makes `scale: 1` mean "the art fills the print area's width".
   * Without it a design generated with wide empty margins prints smaller than the placement
   * says it will, and the only way to find out is to look at the Printify preview.
   */
  trim?: boolean;
};

/** Printify's print areas are 300 DPI by design, so pixels map straight to inches. */
const PRINT_DPI = 300;

export async function makePrintReady(
  artwork: { id: string; design_id: string; label: string; image_path: string },
  options: PrintReadyOptions,
): Promise<PrintReadyResult> {
  const file = await db().storage.from(BUCKET).download(artwork.image_path);
  if (file.error || !file.data) throw new Error('The design image could not be read.');
  // Typed loosely on purpose: the trim step hands back a buffer sharp allocated itself.
  let image: Buffer = Buffer.from(await file.data.arrayBuffer());

  let trimmed = false;
  if (options.trim !== false) {
    const cropped = await trimTransparentBorder(image);
    trimmed = cropped.trimmed;
    image = cropped.buffer;
  }

  const meta = await sharp(image).metadata();
  const sourceWidth = meta.width ?? 0;
  const sourceHeight = meta.height ?? 0;
  if (!sourceWidth || !sourceHeight) throw new Error('That design image has no readable size.');

  // Fit inside the print area, preserving the art's own aspect ratio. Stretching art to the
  // print area's shape would distort every design that is not exactly 4494 x 5097.
  const factor = Math.min(
    options.targetWidth / sourceWidth,
    options.targetHeight / sourceHeight,
  );

  if (factor <= 1) {
    // Already at least as large as the print area. Enlarging would invent detail and
    // shrinking would throw it away, so the file is used as it is.
    const path = await store(artwork, image);
    return {
      path,
      width: sourceWidth,
      height: sourceHeight,
      dpi: PRINT_DPI,
      method: 'lanczos',
      trimmed,
      alreadyLargeEnough: true,
    };
  }

  const width = Math.round(sourceWidth * factor);
  const height = Math.round(sourceHeight * factor);

  const enlarged = options.useAtlas
    ? await upscaleWithAtlas(image, width, height)
    : await upscaleWithSharp(image, width, height);

  const path = await store(artwork, enlarged);
  return {
    path,
    width,
    height,
    dpi: PRINT_DPI,
    method: options.useAtlas ? 'atlas' : 'lanczos',
    trimmed,
    alreadyLargeEnough: false,
  };
}

/** Lanczos3 enlargement. Keeps the alpha channel; no network, no cost. */
async function upscaleWithSharp(image: Buffer, width: number, height: number): Promise<Buffer> {
  return sharp(image)
    .resize(width, height, { kernel: 'lanczos3', fit: 'fill' })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * Atlas's texture-aware upscaler, with transparency put back afterwards.
 *
 * `outscale` is capped at 4 by the model, and it decides the output size itself, so the result
 * is resized to the exact target afterwards rather than trusted to land on it.
 */
async function upscaleWithAtlas(image: Buffer, width: number, height: number): Promise<Buffer> {
  const key = process.env.ATLAS_CLOUD_API_KEY;
  if (!key) throw new Error('ATLAS_CLOUD_API_KEY is not set, so the Atlas upscaler is unavailable.');

  // The model takes a URL, so the source goes to storage briefly and is handed out signed.
  const scratch = `scratch/upscale-${crypto.randomUUID()}.png`;
  const upload = await db()
    .storage.from(BUCKET)
    .upload(scratch, image, { contentType: 'image/png', upsert: true });
  if (upload.error) throw new Error(`Preparing the upscale failed: ${upload.error.message}`);

  try {
    const url = await signedUrl(scratch, 1800);
    if (!url) throw new Error('Could not hand the design to the upscaler.');

    const meta = await sharp(image).metadata();
    const outscale = Math.min(4, Math.max(1, width / (meta.width ?? width)));

    const submitted = await fetch('https://api.atlascloud.ai/api/v1/model/generateImage', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'atlascloud/image-upscaler',
        image: url,
        outscale,
        output_format: 'png',
      }),
      cache: 'no-store',
    });
    const start = (await submitted.json()) as { data?: { id?: string }; message?: string };
    const id = start.data?.id;
    if (!id) throw new Error(`The upscaler refused the job: ${start.message ?? 'no id returned'}`);

    const output = await waitForPrediction(id, key);

    const fetched = await fetch(output, { cache: 'no-store' });
    if (!fetched.ok) throw new Error(`Fetching the upscaled image returned ${fetched.status}.`);
    const rgb = Buffer.from(await fetched.arrayBuffer());

    // The upscaler drops the alpha channel. Rebuild it from the original at the same size:
    // both are the identical shape scaled by the identical factor, so it registers exactly.
    const alpha = await sharp(image)
      .ensureAlpha()
      .extractChannel(3)
      .resize(width, height, { kernel: 'lanczos3', fit: 'fill' })
      .toColourspace('b-w')
      .toBuffer();

    return sharp(rgb)
      .resize(width, height, { kernel: 'lanczos3', fit: 'fill' })
      .removeAlpha()
      .joinChannel(alpha)
      .png({ compressionLevel: 9 })
      .toBuffer();
  } finally {
    await db().storage.from(BUCKET).remove([scratch]);
  }
}

async function waitForPrediction(id: string, key: string): Promise<string> {
  // Atlas quotes 5–15 s for image tools; the observed run took about 20. Well inside the
  // route's 60 s, and a ceiling means a stuck job fails rather than hanging the request.
  for (let attempt = 0; attempt < 25; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const response = await fetch(
      `https://api.atlascloud.ai/api/v1/model/prediction/${encodeURIComponent(id)}`,
      { headers: { Authorization: `Bearer ${key}` }, cache: 'no-store' },
    );
    const body = (await response.json()) as {
      data?: { status?: string; outputs?: string[]; error?: string };
    };
    const data = body.data;
    if (data?.status === 'completed' && data.outputs?.[0]) return data.outputs[0];
    if (data?.status === 'failed') throw new Error(`The upscaler failed: ${data.error ?? 'no reason given'}`);
  }
  throw new Error('The upscaler did not finish in time.');
}

/**
 * Crop away rows and columns that are entirely transparent.
 *
 * sharp's own `trim` works on a background colour and gives up on an alpha-only edge, so the
 * bounding box is found from the alpha channel directly.
 */
async function trimTransparentBorder(
  image: Buffer,
): Promise<{ buffer: Buffer; trimmed: boolean }> {
  const meta = await sharp(image).metadata();
  if (!meta.hasAlpha || !meta.width || !meta.height) return { buffer: image, trimmed: false };

  const { width, height } = meta;
  const alpha = await sharp(image).ensureAlpha().extractChannel(3).raw().toBuffer();

  let top = height;
  let left = width;
  let right = -1;
  let bottom = -1;

  // Anything under 8/255 is invisible on fabric and is treated as empty, so a stray almost
  // transparent pixel does not defeat the crop.
  const THRESHOLD = 8;

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (alpha[row + x]! < THRESHOLD) continue;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }

  // Fully transparent, or already tight against every edge.
  if (right < 0) return { buffer: image, trimmed: false };
  if (top === 0 && left === 0 && right === width - 1 && bottom === height - 1) {
    return { buffer: image, trimmed: false };
  }

  const buffer = await sharp(image)
    .extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
    .png()
    .toBuffer();
  return { buffer, trimmed: true };
}

async function store(
  artwork: { design_id: string; label: string; id: string },
  bytes: Buffer,
): Promise<string> {
  const path = `designs/${artwork.design_id}/print-ready/${artwork.label}.png`;
  const { error } = await db()
    .storage.from(BUCKET)
    .upload(path, bytes, { contentType: 'image/png', upsert: true });
  if (error) throw new Error(`Saving the print-ready file failed: ${error.message}`);

  await db().from('design_artworks').update({ print_ready_path: path }).eq('id', artwork.id);
  return path;
}

/** Physical inches a print file covers at Printify's 300 DPI. */
export function inchesAt300(pixels: number): number {
  return pixels / PRINT_DPI;
}
