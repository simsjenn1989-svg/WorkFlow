import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/supabase';
import { getShopProduct } from '@/lib/printify/client';
import { printedPositions, sampleShop, styleForShop, getStyle } from '@/lib/listings/style';
import { generateListing } from '@/lib/listings/generate';
import { composeListing } from '@/lib/listings/compose';
import { saveListing } from '@/lib/listings/data';
import { CopyError } from '@/lib/copy/models';

export const runtime = 'nodejs';
/** Reading the draft and three example listings, then a model call measured at 8-27 s. */
export const maxDuration = 120;

const schema = z.object({
  productRowId: z.string().uuid(),
  model: z.string().min(1),
  styleId: z.string().uuid().nullable().optional(),
  note: z.string().max(600).optional(),
});

/**
 * Write the listing for one pushed draft.
 *
 * The product is read back from Printify rather than trusted from our own record, because
 * what is actually printed decides what the copy may claim. A description that promises a
 * back print on a one-sided shirt is a refund.
 */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Bad request.' }, { status: 400 });

  const { data: row } = await db()
    .from('printify_products')
    .select('id,design_id,shop_id,printify_product_id,status')
    .eq('id', parsed.data.productRowId)
    .maybeSingle();

  const draft = row as
    | { id: string; design_id: string; shop_id: string | null; printify_product_id: string | null; status: string }
    | null;

  if (!draft?.shop_id || !draft.printify_product_id) {
    return NextResponse.json({ error: 'That draft is not in Printify yet.' }, { status: 404 });
  }

  try {
    const style = parsed.data.styleId
      ? await getStyle(parsed.data.styleId)
      : await styleForShop(draft.shop_id);
    if (!style) {
      return NextResponse.json(
        { error: 'No listing style yet — learn one from your shop first.' },
        { status: 400 },
      );
    }

    const [product, { data: designRow }] = await Promise.all([
      getShopProduct(draft.shop_id, draft.printify_product_id),
      db().from('designs').select('title,tags,notes,prompt_id').eq('id', draft.design_id).maybeSingle(),
    ]);
    const design = designRow as
      | { title: string; tags: string[]; notes: string | null; prompt_id: string | null }
      | null;

    const printedAreas = printedPositions(product);
    if (printedAreas.length === 0) {
      return NextResponse.json({ error: 'That draft has no artwork on it.' }, { status: 400 });
    }

    // Voice examples, skipping the draft being written and anything not written in the
    // house style yet — an unpolished listing is not an example of how the shop writes.
    const examples = style.learn_from_shop
      ? (await sampleShop(draft.shop_id, 8))
          .filter((s) => s.paragraphs.length >= 3 && s.title !== product.title)
          .slice(0, 3)
      : [];

    const parts = await generateListing(parsed.data.model, {
      style,
      designTitle: design?.title ?? product.title,
      designTags: design?.tags ?? [],
      designPrompt: design?.notes ?? null,
      printedAreas,
      examples,
      note: parsed.data.note,
    });

    const composed = composeListing(parts, style, { bothSides: printedAreas.length > 1 });

    const saved = await saveListing({
      productRowId: draft.id,
      title: composed.title,
      description: composed.description,
      tags: composed.tags,
      parts,
      styleId: style.id,
      model: parsed.data.model,
    });
    if (saved.error) return NextResponse.json({ error: saved.error }, { status: 500 });

    return NextResponse.json({ ...composed, printedAreas, examplesUsed: examples.length });
  } catch (error) {
    const status = error instanceof CopyError ? 502 : 500;
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}
