import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '@/lib/supabase';
import { artworkMap } from '@/lib/artworks';
import { enabledAreas, getPreset } from '@/lib/printify/presets';

export const runtime = 'nodejs';

const schema = z.object({
  designIds: z.array(z.string().uuid()).min(1).max(100),
  presetId: z.string().uuid(),
});

export type PrintifySkip = { designId: string; reason: string };

/**
 * Plan a push: queue one row per design, and report the designs that cannot go.
 *
 * A design is only blocked when it has artwork for NONE of the preset's print areas. Missing
 * one of several areas is not a blocker — the product is created with the areas it has and
 * the rest are recorded as skipped, which is what was asked for: "skip, and tell me".
 */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Bad request.' }, { status: 400 });

  const preset = await getPreset(parsed.data.presetId);
  if (!preset) return NextResponse.json({ error: 'That preset no longer exists.' }, { status: 404 });

  const areas = enabledAreas(preset);
  if (areas.length === 0) {
    return NextResponse.json({ error: 'That preset has every print area switched off.' }, { status: 400 });
  }

  const { data: designRows } = await db()
    .from('designs')
    .select('id,title')
    .in('id', parsed.data.designIds);
  const designs = (designRows ?? []) as { id: string; title: string }[];
  if (designs.length === 0) return NextResponse.json({ error: 'Nothing to push.' }, { status: 400 });

  const byDesign = await artworkMap(designs.map((d) => d.id));

  const batchId = randomUUID();
  const queued: { design_id: string; title: string }[] = [];
  const skipped: PrintifySkip[] = [];

  for (const design of designs) {
    const labels = byDesign.get(design.id);
    const usable = areas.filter((area) => labels?.has(area));
    if (usable.length === 0) {
      skipped.push({ designId: design.id, reason: `no ${areas.join(' or ')} artwork` });
      continue;
    }
    queued.push({ design_id: design.id, title: design.title });
  }

  if (queued.length === 0) return NextResponse.json({ batchId, queued: 0, skipped });

  // Re-pushing a design with the same preset reuses its row, so the Printify product id is
  // kept and the existing draft is updated rather than a duplicate being created.
  const { error } = await db()
    .from('printify_products')
    .upsert(
      queued.map((row) => ({
        design_id: row.design_id,
        preset_id: preset.id,
        batch_id: batchId,
        status: 'queued',
        title: row.title,
        shop_id: preset.shop_id,
        error: null,
        skipped: [],
        finished_at: null,
      })),
      { onConflict: 'design_id,preset_id' },
    );
  if (error) {
    return NextResponse.json({ error: `Queueing failed: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ batchId, queued: queued.length, skipped });
}
