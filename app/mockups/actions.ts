'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import sharp from 'sharp';
import { BUCKET, db } from '@/lib/supabase';
import { measureArea } from '@/lib/render/measure';
import { describeAreaProblem } from '@/lib/render/homography';
import { toPixelQuad, type NormQuad, type PrintArea } from '@/lib/mockups';
import type { ActionResult } from '@/app/actions';

function fail(error: string): ActionResult {
  return { ok: false, error };
}

const point = z.object({ x: z.number().min(-0.5).max(1.5), y: z.number().min(-0.5).max(1.5) });

const areaSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().trim().min(1).max(40),
  corners: z.tuple([point, point, point, point]),
});

const saveSchema = z.object({
  areas: z.array(areaSchema).min(1).max(6),
  options: z.record(z.string(), z.number()).default({}),
  name: z.string().trim().min(1).max(120).optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(40).optional(),
});

/**
 * Save every marked print area and measure what sits under each one.
 *
 * Measuring per area rather than per template is what lets a single photo hold a front and
 * a back shot: the two halves are lit differently, so each keeps its own baseline.
 */
export async function saveAreas(id: string, payload: unknown): Promise<ActionResult> {
  const parsed = saveSchema.safeParse(payload);
  if (!parsed.success) return fail('Those print-area settings are not valid.');

  const labels = parsed.data.areas.map((a) => a.label.toLowerCase());
  if (new Set(labels).size !== labels.length) {
    return fail('Two areas have the same name. Give each one a distinct label.');
  }

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
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  const areas: PrintArea[] = [];
  for (const area of parsed.data.areas) {
    const quad = toPixelQuad(area.corners as NormQuad, width, height);

    const problem = describeAreaProblem(quad, width, height);
    if (problem) return fail(`${area.label}: ${problem}`);

    try {
      const measured = await measureArea(photo, quad);
      areas.push({
        id: area.id,
        label: area.label,
        corners: area.corners as NormQuad,
        garmentHex: measured.garmentHex,
        baseLuma: measured.baseLuma,
      });
    } catch (error) {
      return fail(`${area.label}: ${(error as Error).message}`);
    }
  }

  const update: Record<string, unknown> = {
    print_areas: areas,
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
