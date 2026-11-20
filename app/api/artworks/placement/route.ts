import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/supabase';

export const runtime = 'nodejs';

const schema = z.object({
  artworkId: z.string().uuid(),
  // Null clears the override and returns the design to the preset's computed placement.
  placement: z
    .object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      scale: z.number().min(0.05).max(2),
      angle: z.number().min(-180).max(180),
    })
    .nullable(),
});

/**
 * Nudge one design, or stop nudging it.
 *
 * Clearing is a real operation rather than "set it back to what it was": the override is
 * null, so the design follows the preset's rules again, including any later change to the
 * caps or the drop. Storing a copy of the computed numbers would quietly freeze it.
 */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Bad request.' }, { status: 400 });

  const { error } = await db()
    .from('design_artworks')
    .update({ placement: parsed.data.placement })
    .eq('id', parsed.data.artworkId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
