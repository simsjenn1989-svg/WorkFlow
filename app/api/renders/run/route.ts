import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { z } from 'zod';
import { BUCKET, db } from '@/lib/supabase';
import { renderMockup, type Placement } from '@/lib/render/compose';
import { describeAreaProblem } from '@/lib/render/homography';
import { artworkForArea, artworkMap } from '@/lib/artworks';
import { fitToArea } from '@/lib/render/fit';
import { toPixelQuad, type MockupTemplate, type NormQuad } from '@/lib/mockups';
import { renderSource } from '@/lib/render/source';

export const runtime = 'nodejs';

/** One composite of a full-resolution photo; well inside this, but not inside the default. */
export const maxDuration = 60;

const schema = z.object({ batchId: z.string().uuid() });

/**
 * Render one queued pair and report what is left.
 *
 * Deliberately one per request. A batch of fifty would never finish inside a serverless
 * function's time limit, and a single long call that dies halfway leaves nothing to resume
 * from. One row per invocation keeps every call short and makes the batch restartable: the
 * client simply calls again while anything is still queued.
 */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  const { batchId } = parsed.data;

  const { data: next } = await db()
    .from('renders')
    .select('id,design_id,mockup_template_id')
    .eq('batch_id', batchId)
    .eq('status', 'queued')
    .limit(1);

  const job = (next ?? [])[0] as
    | { id: string; design_id: string; mockup_template_id: string }
    | undefined;

  if (!job) return NextResponse.json(await progressOf(batchId));

  await db().from('renders').update({ status: 'running' }).eq('id', job.id);

  try {
    const { data: mockupRow } = await db()
      .from('mockup_templates')
      .select('*')
      .eq('id', job.mockup_template_id)
      .maybeSingle();
    const mockup = mockupRow as MockupTemplate | null;
    if (!mockup) throw new Error('That mockup no longer exists.');

    const byDesign = await artworkMap([job.design_id]);
    const artworks = byDesign.get(job.design_id);

    const photoFile = await db().storage.from(BUCKET).download(mockup.source_path);
    if (photoFile.error || !photoFile.data) throw new Error('The mockup photo could not be read.');
    const photo = Buffer.from(await photoFile.data.arrayBuffer());

    const meta = await sharp(photo).rotate().metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;

    const files = new Map<string, Buffer>();
    const placements: Placement[] = [];

    for (const area of mockup.print_areas) {
      const path = artworkForArea(artworks, area.label);
      if (!path) throw new Error(`No ${area.label} artwork for this design.`);

      // The render copy, not the print canvas: 0.68 MB against 17 MB, and no visible
      // difference in the output. See lib/render/source.ts.
      if (!files.has(path)) files.set(path, await renderSource(path));

      const quad = toPixelQuad(area.corners as NormQuad, width, height);
      const problem = describeAreaProblem(quad, width, height);
      if (problem) throw new Error(`${area.label}: ${problem}`);

      // The art, shaped to the marked area — not the Printify canvas, which carries empty
      // panel below the graphic that would otherwise eat a quarter of the area.
      placements.push({ quad, design: await fitToArea(files.get(path)!, quad) });
    }

    // Full resolution: this is the file that becomes a listing image.
    const result = await renderMockup({ mockup: photo, placements, options: mockup.render_options });

    const outputPath = `renders/${job.id}.jpg`;
    const { error: uploadError } = await db()
      .storage.from(BUCKET)
      .upload(outputPath, result.jpeg, { contentType: 'image/jpeg', upsert: true });
    if (uploadError) throw new Error(uploadError.message);

    await db()
      .from('renders')
      .update({ status: 'done', output_path: outputPath, finished_at: new Date().toISOString() })
      .eq('id', job.id);

    // A design with at least one finished render has its mockups made.
    await db()
      .from('designs')
      .update({ stage: 'mockups_done' })
      .eq('id', job.design_id)
      .in('stage', ['approved', 'print_ready']);
  } catch (error) {
    await db()
      .from('renders')
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
  const { data } = await db().from('renders').select('status').eq('batch_id', batchId);
  const rows = (data ?? []) as { status: string }[];
  const count = (status: string) => rows.filter((r) => r.status === status).length;
  return {
    total: rows.length,
    queued: count('queued') + count('running'),
    done: count('done'),
    failed: count('failed'),
  };
}
