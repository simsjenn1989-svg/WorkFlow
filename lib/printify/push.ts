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
import { placementFor, type Preset } from './presets';

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
};

export async function pushDesign(input: PushInput): Promise<PushResult> {
  const { preset } = input;

  const { data: artworkRows } = await db()
    .from('design_artworks')
    .select('*')
    .eq('design_id', input.designId);
  const artworks = (artworkRows ?? []) as Artwork[];

  const byLabel = new Map(artworks.map((a) => [normaliseLabel(a.label), a]));

  const areas = Object.keys(preset.placements);
  if (areas.length === 0) throw new Error('That preset has no print areas configured.');

  const skipped: string[] = [];
  const uploaded: PushResult['uploaded'] = [];
  const placeholders: CreateProductInput['print_areas'][number]['placeholders'] = [];

  for (const area of areas) {
    const artwork = byLabel.get(normaliseLabel(area));
    if (!artwork) {
      skipped.push(area);
      continue;
    }

    const image = await ensureUploaded(artwork, preset, input.useAtlas ?? false);
    uploaded.push({ label: area, ...image });

    const placement = placementFor(preset, area);
    const placed: ImagePlacement = {
      id: image.imageId,
      x: placement.x,
      y: placement.y,
      scale: placement.scale,
      angle: placement.angle,
    };
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

  return {
    productId: created.id,
    url: productUrl(preset.shop_id, created.id),
    skipped,
    uploaded,
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
  }
  if (!path) {
    const result = await makePrintReady(artwork, { targetWidth, targetHeight, useAtlas });
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
