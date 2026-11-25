import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/supabase';
import { productUrl, updateProduct } from '@/lib/printify/client';
import { markApplied, updateListingText } from '@/lib/listings/data';
import { listingTitle } from '@/lib/printify/title';

export const runtime = 'nodejs';
export const maxDuration = 60;

const schema = z.object({
  productRowId: z.string().uuid(),
  title: z.string().min(1).max(500),
  description: z.string().max(20000),
  tags: z.array(z.string().min(1).max(100)).max(30),
});

/**
 * Write the listing onto the Printify draft.
 *
 * Title, description and tags only. The variants, prices and print areas are untouched, and
 * `visible` is not sent, so a product that has since been published by hand is not yanked
 * back out of the shop by a copy edit.
 *
 * This does not publish. It never has.
 */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Bad request.' }, { status: 400 });

  const { data: row } = await db()
    .from('printify_products')
    .select('id,design_id,shop_id,printify_product_id')
    .eq('id', parsed.data.productRowId)
    .maybeSingle();
  const draft = row as
    | { id: string; design_id: string; shop_id: string | null; printify_product_id: string | null }
    | null;

  if (!draft?.shop_id || !draft.printify_product_id) {
    return NextResponse.json({ error: 'That draft is not in Printify yet.' }, { status: 404 });
  }

  // The same caps rule that rejects a product on create rejects an update, so the title is
  // recased here too — and stored recased, so what the panel shows is what Printify holds.
  const title = listingTitle(parsed.data.title);

  // Keep what is about to be sent, so an edit made here is not lost if Printify rejects it.
  await updateListingText({
    productRowId: draft.id,
    title,
    description: parsed.data.description,
    tags: parsed.data.tags,
  });

  try {
    await updateProduct(draft.shop_id, draft.printify_product_id, {
      title,
      description: parsed.data.description,
      tags: parsed.data.tags,
    });
  } catch (error) {
    await db()
      .from('listings')
      .update({ error: (error as Error).message })
      .eq('printify_product_id', draft.id);
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }

  await markApplied(draft.id);

  // The listing is written; the next move is the user's, in Printify. Only advanced from
  // 'pushed', so re-applying copy to something already published does not walk it backwards.
  await db()
    .from('designs')
    .update({ stage: 'polished' })
    .eq('id', draft.design_id)
    .eq('stage', 'pushed');

  return NextResponse.json({ ok: true, url: productUrl(draft.shop_id, draft.printify_product_id) });
}
