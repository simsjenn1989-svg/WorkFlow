'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { BUCKET, db } from '@/lib/supabase';
import { measureArea } from '@/lib/render/measure';
import { toPixelQuad, type NormQuad } from '@/lib/mockups';
import { describeAreaProblem } from '@/lib/render/homography';
import type { ActionResult } from '@/app/actions';
import sharp from 'sharp';

function fail(error: string): ActionResult {
  return { ok: false, error };
}

const point = z.object({ x: z.number().min(-0.5).max(1.5), y: z.number().min(-0.5).max(1.5) });
const areaSchema = z.object({
  corners: z.tuple([point, point, point, point]),
  options: z.record(z.string(), z.number()).default({}),
  name: z.string().trim().min(1).max(120).optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(40).optional(),
});

/**
 * Save the marked print area and measure what is underneath it.
 *
 * Measuring here rather than at render time means the template carries its own garment
 * colour and baseline, and the editor can warn immediately if the area has been marked
 * somewhere with no drape in it.
 */
export async function saveArea(id: string, payload: unknown): Promise<ActionResult> {
  const parsed = areaSchema.safeParse(payload);
  if (!parsed.success) return fail('Those print-area settings are not valid.');

  const { data: row } = await db()
    .from('mockup_templates')
    .select('source_path')
    .eq('id', id)
    .maybeSingle();
  if (!row) return fail('That mockup no longer exists.');

  const { data: file, error: dlErr } = await db()
    .storage.from(BUCKET)
    .download((row as { source_path: string }).source_path);
  if (dlErr || !file) return fail('The mockup photo could not be read.');

  const photo = Buffer.from(await file.arrayBuffer());
  const meta = await sharp(photo).rotate().metadata();

  const quad = toPixelQuad(parsed.data.corners as NormQuad, meta.width ?? 0, meta.height ?? 0);

  const problem = describeAreaProblem(quad, meta.width ?? 0, meta.height ?? 0);
  if (problem) return fail(problem);

  let measured;
  try {
    measured = await measureArea(photo, quad);
  } catch (error) {
    return fail((error as Error).message);
  }

  const update: Record<string, unknown> = {
    print_area: { corners: parsed.data.corners },
    garment_color: measured.garmentHex,
    base_luma: measured.baseLuma,
    render_options: parsed.data.options,
  };
  if (parsed.data.name) update.name = parsed.data.name;
  if (parsed.data.tags) update.tags = parsed.data.tags;

  const { error } = await db().from('mockup_templates').update(update).eq('id', id);
  if (error) return fail(`Saving failed: ${error.message}`);

  revalidatePath('/mockups');
  revalidatePath(`/mockups/${id}`);
  return { ok: true };
}

export async function deleteMockup(id: string): Promise<ActionResult> {
  const { data: list } = await db().storage.from(BUCKET).list(`mockups/${id}`);
  if (list?.length) {
    await db()
      .storage.from(BUCKET)
      .remove(list.map((o) => `mockups/${id}/${o.name}`));
  }
  const { error } = await db().from('mockup_templates').delete().eq('id', id);
  if (error) return fail(`Deleting failed: ${error.message}`);
  revalidatePath('/mockups');
  return { ok: true };
}
