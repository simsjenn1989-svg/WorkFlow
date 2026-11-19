import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { z } from 'zod';
import { BUCKET, db } from '@/lib/supabase';
import { renderMockup, type Placement } from '@/lib/render/compose';
import { describeAreaProblem } from '@/lib/render/homography';
import { toPixelQuad, type NormQuad } from '@/lib/mockups';

export const runtime = 'nodejs';

/**
 * Rendering is heavier than an ordinary request, and image generation waits on Atlas.
 * Vercel clamps this to whatever the plan allows, so asking for more is safe.
 */
export const maxDuration = 60;


const point = z.object({ x: z.number(), y: z.number() });
const schema = z.object({
  placements: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(40),
        designId: z.string().uuid(),
        corners: z.tuple([point, point, point, point]),
      }),
    )
    .min(1)
    .max(6),
  options: z.record(z.string(), z.number()).default({}),
  maxEdge: z.number().int().min(300).max(4000).default(1100),
});

/**
 * Render one or more designs onto this mockup and return the JPEG.
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

  const { data: template } = await db()
    .from('mockup_templates')
    .select('source_path')
    .eq('id', id)
    .maybeSingle();
  if (!template) return NextResponse.json({ error: 'No such mockup.' }, { status: 404 });

  const designIds = [...new Set(parsed.data.placements.map((p) => p.designId))];
  const { data: designRows } = await db()
    .from('designs')
    .select('id,raw_image_path,print_ready_path')
    .in('id', designIds);

  const artPaths = new Map<string, string>();
  for (const row of (designRows ?? []) as {
    id: string;
    raw_image_path: string | null;
    print_ready_path: string | null;
  }[]) {
    const path = row.print_ready_path ?? row.raw_image_path;
    if (path) artPaths.set(row.id, path);
  }

  const missing = parsed.data.placements.find((p) => !artPaths.has(p.designId));
  if (missing) {
    return NextResponse.json(
      { error: `The design for "${missing.label}" has no image yet — pick a variant first.` },
      { status: 400 },
    );
  }

  const photoFile = await db()
    .storage.from(BUCKET)
    .download((template as { source_path: string }).source_path);
  if (photoFile.error || !photoFile.data) {
    return NextResponse.json({ error: 'The mockup photo could not be read.' }, { status: 500 });
  }
  const photo = Buffer.from(await photoFile.data.arrayBuffer());
  const meta = await sharp(photo).rotate().metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  // Each distinct design is downloaded once even when used in several areas.
  const art = new Map<string, Buffer>();
  for (const [designId, path] of artPaths) {
    const file = await db().storage.from(BUCKET).download(path);
    if (file.error || !file.data) {
      return NextResponse.json({ error: 'A design image could not be read.' }, { status: 500 });
    }
    art.set(designId, Buffer.from(await file.data.arrayBuffer()));
  }

  const placements: Placement[] = [];
  for (const p of parsed.data.placements) {
    const quad = toPixelQuad(p.corners as NormQuad, width, height);
    const problem = describeAreaProblem(quad, width, height);
    if (problem) return NextResponse.json({ error: `${p.label}: ${problem}` }, { status: 400 });
    placements.push({ quad, design: art.get(p.designId)! });
  }

  try {
    const result = await renderMockup({
      mockup: photo,
      placements,
      options: parsed.data.options,
      maxEdge: parsed.data.maxEdge,
    });

    return new NextResponse(new Uint8Array(result.jpeg), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'no-store',
        'X-Measurements': JSON.stringify(
          result.placements.map((m, i) => ({
            label: parsed.data.placements[i]?.label ?? '',
            garment: m.garmentHex,
            baseLuma: m.baseLuma,
          })),
        ),
      },
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
