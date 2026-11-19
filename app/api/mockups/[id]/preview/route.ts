import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { z } from 'zod';
import { BUCKET, db } from '@/lib/supabase';
import { renderMockup } from '@/lib/render/compose';
import { toPixelQuad, type NormQuad } from '@/lib/mockups';
import { describeAreaProblem } from '@/lib/render/homography';

export const runtime = 'nodejs';

const point = z.object({ x: z.number(), y: z.number() });
const schema = z.object({
  designId: z.string().uuid(),
  corners: z.tuple([point, point, point, point]),
  options: z.record(z.string(), z.number()).default({}),
  maxEdge: z.number().int().min(300).max(4000).default(1100),
});

/**
 * Render a design onto this mockup and return the JPEG.
 *
 * The same renderer as the final export, just at a smaller `maxEdge`. Keeping one
 * implementation is why a preview cannot quietly disagree with what you download.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Those preview settings are not valid.' }, { status: 400 });
  }

  const [{ data: template }, { data: design }] = await Promise.all([
    db().from('mockup_templates').select('source_path').eq('id', id).maybeSingle(),
    db()
      .from('designs')
      .select('raw_image_path,print_ready_path')
      .eq('id', parsed.data.designId)
      .maybeSingle(),
  ]);

  if (!template) return NextResponse.json({ error: 'No such mockup.' }, { status: 404 });

  const artPath =
    (design as { print_ready_path: string | null; raw_image_path: string | null } | null)
      ?.print_ready_path ??
    (design as { raw_image_path: string | null } | null)?.raw_image_path ??
    null;
  if (!artPath) {
    return NextResponse.json(
      { error: 'That design has no image yet — pick a variant first.' },
      { status: 400 },
    );
  }

  const [photoFile, artFile] = await Promise.all([
    db().storage.from(BUCKET).download((template as { source_path: string }).source_path),
    db().storage.from(BUCKET).download(artPath),
  ]);

  if (photoFile.error || !photoFile.data) {
    return NextResponse.json({ error: 'The mockup photo could not be read.' }, { status: 500 });
  }
  if (artFile.error || !artFile.data) {
    return NextResponse.json({ error: 'The design image could not be read.' }, { status: 500 });
  }

  const photo = Buffer.from(await photoFile.data.arrayBuffer());
  const art = Buffer.from(await artFile.data.arrayBuffer());
  const meta = await sharp(photo).rotate().metadata();

  const quad = toPixelQuad(parsed.data.corners as NormQuad, meta.width ?? 0, meta.height ?? 0);
  const problem = describeAreaProblem(quad, meta.width ?? 0, meta.height ?? 0);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  try {
    const result = await renderMockup({
      mockup: photo,
      design: art,
      quad,
      options: parsed.data.options,
      maxEdge: parsed.data.maxEdge,
    });

    return new NextResponse(new Uint8Array(result.jpeg), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'no-store',
        'X-Garment': result.garmentHex,
        'X-Base-Luma': String(result.baseLuma),
      },
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
