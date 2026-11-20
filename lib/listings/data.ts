import { db } from '@/lib/supabase';
import type { ListingParts } from './prompt';

/** The written listing for one pushed draft. */
export type ListingRow = {
  id: string;
  printify_product_id: string;
  title: string | null;
  description: string | null;
  tags: string[];
  parts: ListingParts | null;
  style_id: string | null;
  model: string | null;
  polished_at: string | null;
  applied_at: string | null;
  error: string | null;
  created_at: string;
};

export async function listListings(): Promise<ListingRow[]> {
  const { data, error } = await db().from('listings').select('*');
  if (error) throw new Error(`Loading listings failed: ${error.message}`);
  return (data ?? []) as ListingRow[];
}

export async function getListing(productRowId: string): Promise<ListingRow | null> {
  const { data } = await db()
    .from('listings')
    .select('*')
    .eq('printify_product_id', productRowId)
    .maybeSingle();
  return (data as ListingRow | null) ?? null;
}

export async function saveListing(input: {
  productRowId: string;
  title: string;
  description: string;
  tags: string[];
  parts: ListingParts | null;
  styleId: string | null;
  model: string | null;
  appliedAt?: string | null;
  error?: string | null;
}): Promise<{ error: string | null }> {
  const { error } = await db()
    .from('listings')
    .upsert(
      {
        printify_product_id: input.productRowId,
        title: input.title,
        description: input.description,
        tags: input.tags,
        parts: input.parts,
        style_id: input.styleId,
        model: input.model,
        polished_at: new Date().toISOString(),
        applied_at: input.appliedAt ?? null,
        error: input.error ?? null,
      },
      { onConflict: 'printify_product_id' },
    );
  return { error: error?.message ?? null };
}

/**
 * Overwrite only the words.
 *
 * Separate from `saveListing` on purpose: an edit made in the editor must not wipe the
 * model's structured answer, which is what lets the listing be re-composed after a style
 * change without paying for the copy again.
 */
export async function updateListingText(input: {
  productRowId: string;
  title: string;
  description: string;
  tags: string[];
}): Promise<{ error: string | null }> {
  const { error } = await db()
    .from('listings')
    .upsert(
      {
        printify_product_id: input.productRowId,
        title: input.title,
        description: input.description,
        tags: input.tags,
        polished_at: new Date().toISOString(),
      },
      { onConflict: 'printify_product_id' },
    );
  return { error: error?.message ?? null };
}

export async function markApplied(productRowId: string): Promise<void> {
  await db()
    .from('listings')
    .update({ applied_at: new Date().toISOString(), error: null })
    .eq('printify_product_id', productRowId);
}
