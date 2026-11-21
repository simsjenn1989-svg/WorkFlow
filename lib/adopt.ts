import { db } from './supabase';
import { normaliseLabel, putArtwork, PRIMARY_LABEL } from './artworks';

/**
 * Make a variant the design's artwork for its placement.
 *
 * Shared by "Use this one" and by collection, which adopts a single-image generation on
 * its own. Kept out of the server action so the API route can call it without dragging
 * `revalidatePath` into a request that has no page to revalidate.
 *
 * The variant's own label decides the placement. That label came from the Placement field
 * on the Generate screen, travelled on the job and was written onto the variant, so the
 * choice made before spending money is the one that lands.
 */
export async function adoptVariant(
  designId: string,
  variantId: string,
): Promise<{ label: string } | { error: string }> {
  const { data: variant } = await db()
    .from('design_variants')
    .select('id,image_path,design_id,label')
    .eq('id', variantId)
    .maybeSingle();

  const row = variant as { image_path: string; design_id: string; label?: string } | null;
  if (!row) return { error: 'That variant no longer exists.' };
  if (row.design_id !== designId) return { error: 'That variant belongs to another design.' };

  const label = normaliseLabel(row.label ?? PRIMARY_LABEL);

  // Only variants for this placement change hands; art for other placements is untouched.
  await db()
    .from('design_variants')
    .update({ chosen: false })
    .eq('design_id', designId)
    .eq('label', label);
  await db().from('design_variants').update({ chosen: true }).eq('id', variantId);

  const { error: artError } = await putArtwork({ designId, label, imagePath: row.image_path });
  if (artError) return { error: artError };

  const { error } = await db().from('designs').update({ stage: 'approved' }).eq('id', designId);
  if (error) return { error: error.message };

  return { label };
}
