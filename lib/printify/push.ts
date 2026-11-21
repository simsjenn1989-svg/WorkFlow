import sharp from 'sharp';
import { BUCKET, db, signedUrl } from '@/lib/supabase';
import { normaliseLabel, type Artwork } from '@/lib/artworks';
import {
  createProduct,
  getShopProduct,
  listCatalogVariants,
  productUrl,
  updateProduct,
  uploadImageByUrl,
  type CreateProductInput,
  type ImagePlacement,
} from './client';
import { makePrintReady } from './print-ready';
import { enabledAreas, type Preset } from './presets';
import { placeArtwork, type Placed } from './geometry';

/**
 * Pushing one design to Printify as a draft.
 *
 * The rule that shapes everything here: a print area whose artwork is missing is SKIPPED and
 * reported, never filled with something else. Falling back to the front graphic for a back
 * area would produce a product that looks fine in the API response and is ruined on the
 * garment, and that failure would only surface after someone bought one.
 *
 * Nothing in this file publishes. The product is created unpublished and stays that way.
 */

export type PushResult = {
  productId: string;
  url: string;
  skipped: string[];
  uploaded: { label: string; imageId: string; width: number; height: number; reused: boolean }[];
  /** Where each one landed, in inches, so the result can be checked rather than assumed. */
  placements: (Placed & { label: string; overridden: boolean })[];
};

export type PushInput = {
  designId: string;
  preset: Preset;
  title: string;
  description: string;
  tags: string[];
  /** Pay for the Atlas upscaler on this push instead of resizing locally. */
  useAtlas?: boolean;
  /** An existing Printify product to update rather than create a second draft. */
  existingProductId?: string | null;
  /**
   * Called the instant Printify returns a product id, before anything else can fail.
   *
   * The id is the only record that a draft now exists in someone else's shop. Writing it
   * only after the whole push succeeds means a throw anywhere later — a dropped response, a
   * failed database write — loses it, and the next push creates a SECOND draft because
   * `existingProductId` is still null. Silent duplicates in a real shop, which is worse than
   * a failed row, because a failed row is visible.
   */
  onProductCreated?: (productId: string) => Promise<void>;
};

export async function pushDesign(input: PushInput): Promise<PushResult> {
  const { preset } = input;

  const { data: artworkRows } = await db()
    .from('design_artworks')
    .select('*')
    .eq('design_id', input.designId);
  const artworks = (artworkRows ?? []) as Artwork[];

  const byLabel = new Map(artworks.map((a) => [normaliseLabel(a.label), a]));

  // Only the areas this preset actually prints. A disabled area sends no placeholder at
  // all, which is the difference between a front-only shirt and one Printify treats as
  // having a second, empty print.
  const areas = enabledAreas(preset);
  if (areas.length === 0) throw new Error('That preset has every print area switched off.');

  const skipped: string[] = [];
  const uploaded: PushResult['uploaded'] = [];
  const placements: PushResult['placements'] = [];
  const placeholders: CreateProductInput['print_areas'][number]['placeholders'] = [];

  for (const area of areas) {
    const artwork = byLabel.get(normaliseLabel(area));
    if (!artwork) {
      skipped.push(area);
      continue;
    }

    const image = await ensureUploaded(artwork, preset, input.useAtlas ?? false);
    uploaded.push({ label: area, ...image });

    const areaWidthPx = preset.print_width_px ?? 4494;
    const areaHeightPx = preset.print_height_px ?? 5097;

    // A normalised canvas is already the print area, with the art placed on it and the rest
    // transparent, so it is sent whole: dead centre, full width, no rotation. Applying the
    // placement rules a second time would shrink the canvas as though the transparent
    // margins were art — a 15in-wide canvas read as 15in of artwork, capped to 12in, and
    // every design would creep inwards and downwards on each push.
    //
    // Anything else is a file of the art alone, at its own aspect ratio, so it still needs
    // placing. Old artwork from before canvases existed takes this path unchanged.
    const whole = image.width === areaWidthPx && image.height === areaHeightPx;
    const computed = whole
      ? {
          x: 0.5,
          y: 0.5,
          scale: 1,
          angle: 0,
          widthIn: areaWidthPx / 300,
          heightIn: areaHeightPx / 300,
          topIn: 0,
          cappedBy: null,
          atTopOfArea: false,
        }
      : placeArtwork({
          artWidthPx: image.width,
          artHeightPx: image.height,
          areaWidthPx,
          areaHeightPx,
          rules: preset.placements[area],
        });

    // A stored override wins, for the one design that wants moving.
    const override = artwork.placement;
    const placed: ImagePlacement = {
      id: image.imageId,
      x: override?.x ?? computed.x,
      y: override?.y ?? computed.y,
      scale: override?.scale ?? computed.scale,
      angle: override?.angle ?? computed.angle,
    };
    placements.push({ label: area, ...computed, overridden: Boolean(override) });
    placeholders.push({ position: area, images: [placed] });
  }

  if (placeholders.length === 0) {
    throw new Error(
      `This design has no artwork for any of the preset's print areas (${areas.join(', ')}).`,
    );
  }

  /**
   * Every variant the PRODUCT has, not just the ones being sold.
   *
   * Measured the hard way, twice. Creating a product with only the seven enabled variants
   * listed in `print_areas[].variant_ids` is accepted. Updating that same product with the
   * same seven is rejected:
   *
   *   400 Variants do not match selected blueprint and print provider. Please make sure that
   *       all product variants are present in the `print_areas.*.variant_ids` field
   *
   * So a push worked and a re-push failed, which is the kind of bug that only appears the
   * second time. Sending the provider's whole catalogue was the obvious fix and it failed
   * too: the catalogue for blueprint 706 / provider 99 holds 378 variants, while the product
   * Printify built from it holds 509 — the extra 131 belong to the blueprint's other print
   * providers. What the field wants is the product's own set.
   *
   * On create there is no product to read yet, and the catalogue list is accepted; Printify
   * expands it to the full set itself. On update the product is read back and its own
   * variant ids are used, which is also what the shop's hand-built listings contain.
   */
  const variantIds = input.existingProductId
    ? (await getShopProduct(preset.shop_id, input.existingProductId)).variants.map((v) => v.id)
    : (await listCatalogVariants(preset.blueprint_id, preset.print_provider_id)).map((v) => v.id);

  const product: CreateProductInput = {
    title: input.title,
    description: input.description,
    tags: input.tags,
    blueprint_id: preset.blueprint_id,
    print_provider_id: preset.print_provider_id,
    variants: preset.variants.map((v) => ({
      id: v.variantId,
      price: v.priceCents,
      is_enabled: true,
    })),
    print_areas: [{ variant_ids: variantIds, placeholders }],
  };

  const created = input.existingProductId
    ? await updateProduct(preset.shop_id, input.existingProductId, product)
    : await createProduct(preset.shop_id, product);

  // Record the id before anything else gets the chance to throw. A draft now exists in a
  // real shop whatever happens next, and this is the only thing that knows it.
  await input.onProductCreated?.(created.id);

  return {
    productId: created.id,
    url: productUrl(preset.shop_id, created.id),
    skipped,
    uploaded,
    placements,
  };
}

/**
 * Get a Printify image id for one artwork, making the print-ready file if needed.
 *
 * Printify keeps uploaded images indefinitely and addresses them by id, so an artwork that has
 * already been sent is reused. The stored row remembers which file was sent: if the
 * print-ready file is rebuilt (a different upscaler, a changed print area), the paths stop
 * matching and it is uploaded again rather than silently printing the old version.
 */
async function ensureUploaded(
  artwork: Artwork,
  preset: Preset,
  useAtlas: boolean,
): Promise<{ imageId: string; width: number; height: number; reused: boolean }> {
  const targetWidth = preset.print_width_px ?? 4494;
  const targetHeight = preset.print_height_px ?? 5097;

  // Rebuild the print-ready file when there isn't one, and also when the one on disk is too
  // small for this preset's print area. The second case is the quiet one: changing a preset's
  // blueprint raises the target, and an old 1024-sourced file would still upload happily and
  // print soft.
  let path = artwork.print_ready_path;
  if (path) {
    const current = await measure(path);
    // Art keeps its own aspect ratio, so a print-ready file fills the print area in exactly
    // one direction: a square design maxes out the width, a tall one the height. Requiring
    // both would rebuild a correctly sized tall design on every single push.
    const big =
      current &&
      (current.width >= targetWidth * 0.98 || current.height >= targetHeight * 0.98);
    if (!big) path = null;

    // A canvas built for a DIFFERENT print area passes the test above on one axis and is
    // still the wrong shape, so it is rebuilt rather than stretched.
    if (path && current && current.width !== targetWidth && current.height !== targetHeight) {
      path = null;
    }
  }
  if (!path) {
    // Rebuild as a canvas, the same way approving a design does, so a push can never
    // produce a file shaped differently from the one the mockups were rendered against.
    // `useAtlas` still buys the crisper enlargement, applied to the art before it is
    // placed on the canvas.
    const result = await makePrintReady(artwork, {
      targetWidth,
      targetHeight,
      useAtlas,
      canvas: true,
    });
    path = result.path;
  }

  const { data: existing } = await db()
    .from('printify_uploads')
    .select('*')
    .eq('artwork_id', artwork.id)
    .maybeSingle();
  const row = existing as
    | { printify_image_id: string; width: number; height: number; source_path: string }
    | null;

  if (row && row.source_path === path) {
    return {
      imageId: row.printify_image_id,
      width: row.width,
      height: row.height,
      reused: true,
    };
  }

  // Printify fetches the file itself from a signed URL rather than being handed megabytes of
  // base64 through a serverless function — see lib/printify/client.ts.
  const url = await signedUrl(path, 1800);
  if (!url) throw new Error('The print-ready file could not be handed to Printify.');

  const fileName = `${slug(artwork.design_id)}-${artwork.label}.png`;
  const image = await uploadImageByUrl(fileName, url);

  await db().from('printify_uploads').upsert(
    {
      artwork_id: artwork.id,
      printify_image_id: image.id,
      file_name: image.file_name,
      width: image.width,
      height: image.height,
      source_path: path,
    },
    { onConflict: 'artwork_id' },
  );

  return { imageId: image.id, width: image.width, height: image.height, reused: false };
}

/** The print-ready file still lives under the design's folder; this only names the upload. */
function slug(designId: string): string {
  return designId.slice(0, 8);
}

/** The stored file's pixel size, or null if it cannot be read. */
async function measure(path: string): Promise<{ width: number; height: number } | null> {
  const file = await db().storage.from(BUCKET).download(path);
  if (file.error || !file.data) return null;
  const meta = await sharp(Buffer.from(await file.data.arrayBuffer())).metadata();
  if (!meta.width || !meta.height) return null;
  return { width: meta.width, height: meta.height };
}
