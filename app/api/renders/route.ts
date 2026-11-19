import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '@/lib/supabase';
import { artworkForArea, artworkMap } from '@/lib/artworks';
import { isMarked, type MockupTemplate } from '@/lib/mockups';

export const runtime = 'nodejs';

const schema = z.object({
  designIds: z.array(z.string().uuid()).min(1).max(200),
  mockupIds: z.array(z.string().uuid()).min(1).max(100),
});

export type Skipped = { designId: string; mockupId: string; reason: string };

/**
 * Plan a batch: work out which design × mockup pairs can actually be rendered, queue those,
 * and report the rest.
 *
 * A pair is skipped when the design has no artwork for one of the mockup's print areas —
 * a front-only design meeting a front-and-back mockup, say. Skipping is reported rather
 * than silent, because the alternative is a listing image missing its back print that
 * nobody notices until it is live.
 */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Bad request.' }, { status: 400 });

  const [{ data: designRows }, { data: mockupRows }] = await Promise.all([
    db().from('designs').select('id,title').in('id', parsed.data.designIds),
    db().from('mockup_templates').select('*').in('id', parsed.data.mockupIds),
  ]);

  const designs = (designRows ?? []) as { id: string; title: string }[];
  const mockups = (mockupRows ?? []) as MockupTemplate[];
  if (designs.length === 0 || mockups.length === 0) {
    return NextResponse.json({ error: 'Nothing to render.' }, { status: 400 });
  }

  const byDesign = await artworkMap(designs.map((d) => d.id));

  const batchId = randomUUID();
  const queued: { id: string; design_id: string; mockup_template_id: string }[] = [];
  const skipped: Skipped[] = [];

  for (const design of designs) {
    const artworks = byDesign.get(design.id);
    for (const mockup of mockups) {
      if (!isMarked(mockup)) {
        skipped.push({ designId: design.id, mockupId: mockup.id, reason: 'no print area marked' });
        continue;
      }

      const missing = mockup.print_areas
        .filter((area) => !artworkForArea(artworks, area.label))
        .map((area) => area.label);

      if (missing.length > 0) {
        skipped.push({
          designId: design.id,
          mockupId: mockup.id,
          reason: `no ${missing.join(' or ')} artwork`,
        });
        continue;
      }

      queued.push({ id: randomUUID(), design_id: design.id, mockup_template_id: mockup.id });
    }
  }

  if (queued.length === 0) {
    return NextResponse.json({ batchId, queued: 0, skipped });
  }

  // Re-running a pair replaces its previous render rather than accumulating files.
  const { error } = await db()
    .from('renders')
    .upsert(
      queued.map((row) => ({
        ...row,
        batch_id: batchId,
        status: 'queued',
        output_path: null,
        error: null,
        finished_at: null,
      })),
      { onConflict: 'design_id,mockup_template_id' },
    );
  if (error) {
    return NextResponse.json({ error: `Queueing failed: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ batchId, queued: queued.length, skipped });
}
