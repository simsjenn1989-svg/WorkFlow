import { db } from '@/lib/supabase';
import { largestPlaceholder, listCatalogVariants, listShops, type CatalogVariant } from './client';

/**
 * A product preset: everything about a product that is the same for every design.
 *
 * Presets exist because the decisions that vary per design (title, tags, which art) are few,
 * and the decisions that do not (blueprint, provider, colour, which sizes, what each size
 * costs, where the art sits) are many. Pushing a design should not mean re-answering the
 * second set.
 */

export type PresetVariant = {
  variantId: number;
  size: string;
  priceCents: number;
};

/** Where art sits in one print area, in Printify's normalised units. */
export type PresetPlacement = {
  x: number;
  y: number;
  scale: number;
  angle: number;
};

export type Preset = {
  id: string;
  name: string;
  shop_id: string;
  shop_title: string | null;
  blueprint_id: number;
  print_provider_id: number;
  colour: string;
  variants: PresetVariant[];
  placements: Record<string, PresetPlacement>;
  print_width_px: number | null;
  print_height_px: number | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

/** Comfort Colors 1717 Unisex Garment-Dyed T-shirt, measured from the live catalogue. */
export const COMFORT_COLORS_1717 = 706;
/** Printify Choice — the provider the shop already uses. */
export const PRINTIFY_CHOICE = 99;

/**
 * Printify's own size ordering is not alphabetical and not the order the API returns. Listing
 * sizes in this order keeps the preset editor reading like a size chart.
 */
const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'];

/**
 * The prices the shop actually charges, read off the live Comfort Colors product rather than
 * guessed: the ladder steps at 2XL, again at 3XL, and again at 4XL. Any size not listed falls
 * back to the base.
 */
const PRICE_LADDER: Record<string, number> = {
  '2XL': 3799,
  '3XL': 4199,
  '4XL': 4599,
};
const BASE_PRICE_CENTS = 3699;

export function priceForSize(size: string): number {
  return PRICE_LADDER[size] ?? BASE_PRICE_CENTS;
}

/**
 * The default placement for a print area.
 *
 * Centred horizontally and slightly above centre vertically, at full print-area width — the
 * values measured off the shop's existing front-and-back tee. Every area starts here and is
 * adjusted per preset, because what looks right differs between a full back print and a small
 * chest graphic.
 */
export const DEFAULT_PLACEMENT: PresetPlacement = { x: 0.5, y: 0.45, scale: 1, angle: 0 };

export function placementFor(
  preset: Pick<Preset, 'placements'>,
  label: string,
): PresetPlacement {
  return preset.placements[label] ?? DEFAULT_PLACEMENT;
}

export function sortSizes(variants: PresetVariant[]): PresetVariant[] {
  return [...variants].sort((a, b) => {
    const ai = SIZE_ORDER.indexOf(a.size);
    const bi = SIZE_ORDER.indexOf(b.size);
    if (ai === -1 || bi === -1) return a.size.localeCompare(b.size);
    return ai - bi;
  });
}

// ---------------------------------------------------------------- reading

export async function listPresets(): Promise<Preset[]> {
  const { data, error } = await db()
    .from('printify_presets')
    .select('*')
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Loading presets failed: ${error.message}`);
  return (data ?? []) as Preset[];
}

export async function getPreset(id: string): Promise<Preset | null> {
  const { data } = await db().from('printify_presets').select('*').eq('id', id).maybeSingle();
  return (data as Preset | null) ?? null;
}

export async function defaultPreset(): Promise<Preset | null> {
  const { data } = await db()
    .from('printify_presets')
    .select('*')
    .eq('is_default', true)
    .maybeSingle();
  return (data as Preset | null) ?? null;
}

// ---------------------------------------------------------------- writing

export type PresetInput = {
  name: string;
  shopId: string;
  shopTitle?: string | null;
  blueprintId: number;
  printProviderId: number;
  colour: string;
  variants: PresetVariant[];
  placements: Record<string, PresetPlacement>;
  printWidthPx?: number | null;
  printHeightPx?: number | null;
  isDefault?: boolean;
};

export async function savePreset(
  id: string | null,
  input: PresetInput,
): Promise<{ id: string | null; error: string | null }> {
  const row = {
    name: input.name,
    shop_id: input.shopId,
    shop_title: input.shopTitle ?? null,
    blueprint_id: input.blueprintId,
    print_provider_id: input.printProviderId,
    colour: input.colour,
    variants: sortSizes(input.variants),
    placements: input.placements,
    print_width_px: input.printWidthPx ?? null,
    print_height_px: input.printHeightPx ?? null,
    is_default: input.isDefault ?? false,
    updated_at: new Date().toISOString(),
  };

  // Only one preset may be the default, enforced by a partial unique index. Clearing the old
  // one first turns what would be a constraint violation into an ordinary switch.
  if (row.is_default) {
    const clear = db().from('printify_presets').update({ is_default: false }).eq('is_default', true);
    await (id ? clear.neq('id', id) : clear);
  }

  if (id) {
    const { error } = await db().from('printify_presets').update(row).eq('id', id);
    return { id: error ? null : id, error: error?.message ?? null };
  }

  const { data, error } = await db().from('printify_presets').insert(row).select('id').single();
  return { id: (data as { id: string } | null)?.id ?? null, error: error?.message ?? null };
}

export async function deletePreset(id: string): Promise<{ error: string | null }> {
  const { error } = await db().from('printify_presets').delete().eq('id', id);
  // A preset that has been pushed with is referenced by printify_products (on delete
  // restrict), so this fails rather than orphaning the record of a real draft.
  return { error: error?.message ?? null };
}

// ---------------------------------------------------------------- first run

/**
 * Build the shop's first preset from live catalogue data.
 *
 * Reads the blueprint's real variants and print areas rather than hardcoding them, so if
 * Printify changes a placeholder size or retires a variant, the preset is simply built from
 * whatever is true now. Nothing is written until the user saves it.
 */
export async function suggestPreset(options?: {
  blueprintId?: number;
  printProviderId?: number;
  colour?: string;
  shopId?: string;
}): Promise<{
  preset: PresetInput;
  shops: { id: string; title: string; salesChannel: string }[];
  areas: string[];
  warnings: string[];
}> {
  const blueprintId = options?.blueprintId ?? COMFORT_COLORS_1717;
  const printProviderId = options?.printProviderId ?? PRINTIFY_CHOICE;
  const colour = options?.colour ?? 'Black';

  const [shopList, variants] = await Promise.all([
    listShops(),
    listCatalogVariants(blueprintId, printProviderId),
  ]);

  const shops = shopList.map((s) => ({
    id: String(s.id),
    title: s.title,
    salesChannel: s.sales_channel,
  }));

  const matching = variants.filter((v) => v.options.color === colour);
  const warnings: string[] = [];
  if (matching.length === 0) {
    warnings.push(
      `The catalogue lists no ${colour} variant for blueprint ${blueprintId} from provider ${printProviderId}.`,
    );
  }

  const areas = printAreasOf(matching);
  const front = largestPlaceholder(matching, 'front');

  // The front and back areas on this blueprint are the same size; if that ever stops being
  // true, art sized for one would be wrong for the other, so it is worth saying out loud.
  for (const area of areas) {
    const size = largestPlaceholder(matching, area);
    if (front && size && (size.width !== front.width || size.height !== front.height)) {
      warnings.push(
        `The ${area} print area (${size.width}x${size.height}) is a different size from the front (${front.width}x${front.height}).`,
      );
    }
  }

  const shopId = options?.shopId ?? shops[0]?.id ?? '';

  return {
    preset: {
      name: `${titleFor(blueprintId, colour)}`,
      shopId,
      shopTitle: shops.find((s) => s.id === shopId)?.title ?? null,
      blueprintId,
      printProviderId,
      colour,
      variants: sortSizes(
        matching.map((v) => ({
          variantId: v.id,
          size: v.options.size ?? v.title,
          priceCents: priceForSize(v.options.size ?? ''),
        })),
      ),
      placements: Object.fromEntries(areas.map((a) => [a, { ...DEFAULT_PLACEMENT }])),
      printWidthPx: front?.width ?? null,
      printHeightPx: front?.height ?? null,
      isDefault: true,
    },
    shops,
    areas,
    warnings,
  };
}

/** Every print position these variants offer, front first. */
export function printAreasOf(variants: CatalogVariant[]): string[] {
  const seen = new Set<string>();
  for (const variant of variants) {
    for (const placeholder of variant.placeholders) seen.add(placeholder.position);
  }
  return [...seen].sort((a, b) => (a === 'front' ? -1 : b === 'front' ? 1 : a.localeCompare(b)));
}

function titleFor(blueprintId: number, colour: string): string {
  return blueprintId === COMFORT_COLORS_1717
    ? `Comfort Colors 1717 — ${colour}`
    : `Blueprint ${blueprintId} — ${colour}`;
}
