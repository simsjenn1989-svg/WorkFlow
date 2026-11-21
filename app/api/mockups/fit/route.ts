import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { z } from 'zod';
import { BUCKET, db } from '@/lib/supabase';
import { snapToPrintAspect, type NormQuad, type PrintArea } from '@/lib/mockups';
import { printAreaSize } from '@/lib/printify/canvas';
import { measureArea } from '@/lib/render/measure';
import { toPixelQuad } from '@/lib/mockups';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Reshape one mockup's areas to the print area's proportions.
 *
 * One mockup per request on purpose. The photo has to be downloaded to know its aspect —
 * the shape of an area is stored in fractions of the image, so the same numbers mean
 * different shapes on a 4:3 and a 3:2 photo — and sixteen photos in one request is a
 * timeout waiting to happen. The browser loops and shows which one it is on.
 */
const schema = z.object({ id: z.string().uuid() });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'No such mockup.' }, { status: 400 });

  const { data: row } = await db()
    .from('mockup_templates')
    .select('id,name,source_path,print_areas')
    .eq('id', parsed.data.id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: 'No such mockup.' }, { status: 404 });

  const template = row as {
    id: string;
    name: string;
    source_path: string;
    print_areas: PrintArea[] | null;
  };
  const areas = template.print_areas ?? [];
  if (areas.length === 0) {
    return NextResponse.json({ name: template.name, changed: 0, note: 'no areas marked' });
  }

  const file = await db().storage.from(BUCKET).download(template.source_path);
  if (file.error || !file.data) {
    return NextResponse.json({ error: 'The mockup photo could not be read.' }, { status: 502 });
  }
  const photo = Buffer.from(await file.data.arrayBuffer());
  const meta = await sharp(photo).rotate().metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) {
    return NextResponse.json({ error: 'That photo has no readable size.' }, { status: 502 });
  }

  const area = await printAreaSize();
  const aspect = width / height;

  // The measurements are of what sits UNDER the area, so a reshaped area needs measuring
  // again — otherwise the shading baseline belongs to the old rectangle.
  const next: PrintArea[] = [];
  for (const a of areas) {
    const corners = snapToPrintAspect(a.corners as NormQuad, aspect, area.width / area.height);
    let measured: { garmentHex: string; baseLuma: number } | null = null;
    try {
      measured = await measureArea(photo, toPixelQuad(corners, width, height));
    } catch {
      // Keep the old measurement rather than failing the whole mockup; it is close, and a
      // re-render from the editor measures again anyway.
    }
    next.push({
      ...a,
      corners,
      garmentHex: measured?.garmentHex ?? a.garmentHex,
      baseLuma: measured?.baseLuma ?? a.baseLuma,
    });
  }

  const { error } = await db()
    .from('mockup_templates')
    .update({ print_areas: next })
    .eq('id', template.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ name: template.name, changed: next.length });
}
