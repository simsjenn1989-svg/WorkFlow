import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/supabase';
import { getPreset } from '@/lib/printify/presets';
import { pushDesign } from '@/lib/printify/push';

export const runtime = 'nodejs';

/**
 * Upscaling (locally or through Atlas), uploading a multi-megabyte PNG to Printify for each
 * print area, then creating the product. The Atlas path alone took about 20 s when measured.
 */
export const maxDuration = 120;

const schema = z.object({
  batchId: z.string().uuid(),
  useAtlas: z.boolean().optional(),
  description: z.string().max(8000).optional(),
});

/**
 * Push one queued design and report what is left.
 *
 * One per request, for the same reason renders work that way: a batch of twenty would never
 * fit inside a serverless function's time limit, and a long call that dies halfway leaves
 * nothing to resume from. The client calls again while anything is still queued.
 */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  const { batchId, useAtlas } = parsed.data;

  const { data: next } = await db()
    .from('printify_products')
    .select('id,design_id,preset_id,printify_product_id')
    .eq('batch_id', batchId)
    .eq('status', 'queued')
    .limit(1);

  const job = (next ?? [])[0] as
    | { id: string; design_id: string; preset_id: string; printify_product_id: string | null }
    | undefined;

  if (!job) return NextResponse.json(await progressOf(batchId));

  await db().from('printify_products').update({ status: 'running' }).eq('id', job.id);

  try {
    const preset = await getPreset(job.preset_id);
    if (!preset) throw new Error('That preset no longer exists.');

    const { data: designRow } = await db()
      .from('designs')
      .select('id,title,tags,notes')
      .eq('id', job.design_id)
      .maybeSingle();
    const design = designRow as
      | { id: string; title: string; tags: string[]; notes: string | null }
      | null;
    if (!design) throw new Error('That design no longer exists.');

    const result = await pushDesign({
      designId: design.id,
      preset,
      title: design.title,
      // Phase 6 is where listing copy gets written properly. Until then the draft carries the
      // design's own notes so there is something to react to in Printify, rather than an
      // invented description that would have to be recognised as filler and deleted.
      description: parsed.data.description ?? design.notes ?? '',
      tags: design.tags ?? [],
      useAtlas,
      existingProductId: job.printify_product_id,
      // Written the moment Printify hands back an id, so a failure after this point leaves
      // a row that knows about the draft and updates it next time instead of making another.
      onProductCreated: async (productId) => {
        await db()
          .from('printify_products')
          .update({ printify_product_id: productId, shop_id: preset.shop_id })
          .eq('id', job.id);
      },
    });

    await db()
      .from('printify_products')
      .update({
        status: 'draft',
        printify_product_id: result.productId,
        shop_id: preset.shop_id,
        skipped: result.skipped,
        error: null,
        finished_at: new Date().toISOString(),
      })
      .eq('id', job.id);

    // The design has a draft waiting in Printify; the next move is the user's.
    await db()
      .from('designs')
      .update({ stage: 'pushed' })
      .eq('id', design.id)
      .in('stage', ['approved', 'print_ready', 'mockups_done', 'assets_done']);
  } catch (error) {
    // Marked failed, but the product id written by onProductCreated is deliberately left
    // alone: a draft that reached Printify should be updated by the next push, not
    // duplicated. Rendering and uploading are repeatable, so retrying costs nothing but time.
    await db()
      .from('printify_products')
      .update({
        status: 'failed',
        error: (error as Error).message,
        finished_at: new Date().toISOString(),
      })
      .eq('id', job.id);
  }

  return NextResponse.json(await progressOf(batchId));
}

async function progressOf(batchId: string) {
  const { data } = await db().from('printify_products').select('status').eq('batch_id', batchId);
  const rows = (data ?? []) as { status: string }[];
  const count = (status: string) => rows.filter((r) => r.status === status).length;
  return {
    total: rows.length,
    queued: count('queued') + count('running'),
    done: count('draft'),
    failed: count('failed'),
  };
}
