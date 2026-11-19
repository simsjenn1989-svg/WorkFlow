import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/supabase';

export const runtime = 'nodejs';

const schema = z.object({ text: z.string().trim().min(2).max(300) });

/**
 * Star a headline.
 *
 * The starred list is fed back as style examples on the next generation, so the copy learns
 * the seller's voice. In the original this lived in `localStorage`, where one cache clear
 * lost it; here it survives, and it is the same list whichever model is writing.
 */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Nothing to star.' }, { status: 400 });

  const { error } = await db()
    .from('style_examples')
    .insert({ kind: 'headline', text: parsed.data.text });
  if (error) return NextResponse.json({ error: `Saving failed: ${error.message}` }, { status: 500 });

  return NextResponse.json({ ok: true });
}

export async function GET() {
  const { data } = await db()
    .from('style_examples')
    .select('id,text')
    .eq('kind', 'headline')
    .order('created_at', { ascending: false })
    .limit(30);
  return NextResponse.json({ examples: data ?? [] });
}

const deleteSchema = z.object({ id: z.string().uuid() });

export async function DELETE(request: Request) {
  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Bad request.' }, { status: 400 });

  const { error } = await db().from('style_examples').delete().eq('id', parsed.data.id);
  if (error) return NextResponse.json({ error: `Deleting failed: ${error.message}` }, { status: 500 });
  return NextResponse.json({ ok: true });
}
