import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/supabase';
import { normaliseDesign } from '@/lib/printify/canvas';

export const runtime = 'nodejs';

/**
 * Trimming, enlarging and compositing a 4494 x 5097 canvas takes about six seconds and
 * allocates a 20 MB buffer. Too slow to hold a server action open for, which is why
 * choosing a keeper does this through a route the browser can show progress for.
 */
export const maxDuration = 60;

const schema = z.object({ designId: z.string().uuid() });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'No such design.' }, { status: 400 });

  const { data: design } = await db()
    .from('designs')
    .select('id')
    .eq('id', parsed.data.designId)
    .maybeSingle();
  if (!design) return NextResponse.json({ error: 'No such design.' }, { status: 404 });

  const results = await normaliseDesign(parsed.data.designId);
  const failed = results.filter((r) => r.error);

  return NextResponse.json({
    normalised: results.length - failed.length,
    failed: failed.map((f) => `${f.label}: ${f.error}`),
    placements: results
      .filter((r) => r.result)
      .map((r) => ({
        label: r.label,
        size: `${r.result!.widthIn.toFixed(1)}in x ${r.result!.heightIn.toFixed(1)}in`,
        canvas: `${r.result!.width}x${r.result!.height}`,
      })),
  });
}
