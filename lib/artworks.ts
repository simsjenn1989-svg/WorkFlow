import { db, signedUrl } from './supabase';

/**
 * A design holds one artwork per placement.
 *
 * A tee with a big front graphic and different back text is one design, not two, so the art
 * lives keyed by label. Rendering matches an artwork to a print area by that label, and a
 * design with no back art skips a back area rather than printing the front twice.
 */
export type Artwork = {
  id: string;
  design_id: string;
  label: string;
  image_path: string;
  print_ready_path: string | null;
  source_model: string | null;
  created_at: string;
  url: string | null;
};

/** The placement a design gets when nothing says otherwise. */
export const PRIMARY_LABEL = 'front';

/** Labels offered in the UI. Anything else can still be typed. */
export const COMMON_LABELS = ['front', 'back', 'sleeve', 'pocket'] as const;

export function normaliseLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 40) || PRIMARY_LABEL;
}

/** The file to print or composite: the print-ready version if there is one, else the raw art. */
export function artworkPath(artwork: Pick<Artwork, 'image_path' | 'print_ready_path'>): string {
  return artwork.print_ready_path ?? artwork.image_path;
}

/** Front first, then alphabetical — so the primary artwork leads any list. */
export function sortArtworks<T extends { label: string }>(artworks: T[]): T[] {
  return [...artworks].sort((a, b) => {
    if (a.label === PRIMARY_LABEL) return -1;
    if (b.label === PRIMARY_LABEL) return 1;
    return a.label.localeCompare(b.label);
  });
}

export async function listArtworks(designId: string): Promise<Artwork[]> {
  const { data, error } = await db()
    .from('design_artworks')
    .select('*')
    .eq('design_id', designId);
  if (error) throw new Error(`Loading artwork failed: ${error.message}`);

  const rows = sortArtworks((data ?? []) as Omit<Artwork, 'url'>[]);
  return Promise.all(rows.map(async (row) => ({ ...row, url: await signedUrl(row.image_path) })));
}

/** Artwork paths for several designs at once, keyed by design then label. */
export async function artworkMap(
  designIds: string[],
): Promise<Map<string, Map<string, string>>> {
  const map = new Map<string, Map<string, string>>();
  if (designIds.length === 0) return map;

  const { data } = await db()
    .from('design_artworks')
    .select('design_id,label,image_path,print_ready_path')
    .in('design_id', designIds);

  for (const row of (data ?? []) as Pick<
    Artwork,
    'design_id' | 'label' | 'image_path' | 'print_ready_path'
  >[]) {
    if (!map.has(row.design_id)) map.set(row.design_id, new Map());
    map.get(row.design_id)!.set(row.label, artworkPath(row));
  }
  return map;
}

/**
 * Pick the artwork for a print area.
 *
 * An exact label match wins. Nothing else does: falling back to the front artwork for a
 * back area would silently print the same graphic twice, which is the mistake this whole
 * model exists to avoid.
 */
export function artworkForArea(
  byLabel: Map<string, string> | undefined,
  areaLabel: string,
): string | null {
  return byLabel?.get(normaliseLabel(areaLabel)) ?? null;
}

/** Create or replace a design's artwork for one placement. */
export async function putArtwork(input: {
  designId: string;
  label: string;
  imagePath: string;
  sourceModel?: string | null;
  sourceParams?: unknown;
}): Promise<{ error: string | null }> {
  const { error } = await db()
    .from('design_artworks')
    .upsert(
      {
        design_id: input.designId,
        label: normaliseLabel(input.label),
        image_path: input.imagePath,
        source_model: input.sourceModel ?? null,
        source_params: input.sourceParams ?? null,
      },
      { onConflict: 'design_id,label' },
    );
  return { error: error?.message ?? null };
}
