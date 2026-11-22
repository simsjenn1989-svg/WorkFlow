import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { z } from 'zod';
import { BUCKET, db } from '@/lib/supabase';
import { toPixelQuad, type NormQuad, type PrintArea } from '@/lib/mockups';
import { areaOverGarment, detectGarment } from '@/lib/render/garment';
import { measureArea } from '@/lib/render/measure';

export const runtime = 'nodejs';
export const maxDuration = 60;

const schema = z.object({ id: z.string().uuid() });

/**
 * Place this mockup's print areas over the garment the photo actually contains.
 *
 * One photo per request: each has to be downloaded and scanned, and fifteen in one request
 * is a timeout waiting to happen. The browser loops and reports which one it is on.
 */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'No such mockup.' }, { status: 400 });

  const { data: row } = await db()
    .from('mockup_templates')
    .select('id,name,source_path,print_areas')
    .eq('id', parsed.data.id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: 'No such mockup.' }, { status: 404 });

  const template = row as { id: string; name: string; source_path: string; print_areas: PrintArea[] | null };
  const existing = template.print_areas ?? [];

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
  const imageAspect = width / height;

  // A photo already marked with two areas is a two-up — a back shot beside a front shot —
  // so each half is detected on its own. Anything else is one garment.
  const halves =
    existing.length > 1
      ? [
          { from: 0, width: 0.5 },
          { from: 0.5, width: 0.5 },
        ]
      : [{ from: 0, width: 1 }];

  const areas: PrintArea[] = [];
  for (const [i, span] of halves.entries()) {
    const slice =
      span.width === 1
        ? photo
        : await sharp(photo)
            .rotate()
            .extract({
              left: Math.round(width * span.from),
              top: 0,
              width: Math.round(width * span.width),
              height,
            })
            .png()
            .toBuffer();

    const garment = await detectGarment(slice);
    if (!garment) {
      return NextResponse.json(
        { name: template.name, error: 'No dark garment found in this photo — mark it by hand.' },
        { status: 422 },
      );
    }

    const corners = areaOverGarment(garment, imageAspect, 0.95, span);
    const old = existing[i];
    // The shading baseline belongs to whatever sits under the area, so a moved area is
    // measured again rather than keeping the old reading.
    let measured: { garmentHex: string; baseLuma: number } | null = null;
    try {
      measured = await measureArea(photo, toPixelQuad(corners as NormQuad, width, height));
    } catch {
      // Keep the previous measurement; a render from the editor measures again anyway.
    }

    areas.push({
      id: old?.id ?? crypto.randomUUID(),
      label: old?.label ?? (i === 0 ? 'front' : 'back'),
      corners: corners as NormQuad,
      garmentHex: measured?.garmentHex ?? old?.garmentHex ?? null,
      baseLuma: measured?.baseLuma ?? old?.baseLuma ?? null,
    });
  }

  const { error } = await db()
    .from('mockup_templates')
    .update({ print_areas: areas })
    .eq('id', template.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    name: template.name,
    // Corners come back so the editor can show the result without a reload: its areas
    // live in component state, which a router refresh would not touch.
    areas: areas.map((a) => ({ id: a.id, label: a.label, corners: a.corners })),
  });
}
