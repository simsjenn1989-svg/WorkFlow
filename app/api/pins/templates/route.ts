import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/supabase';

export const runtime = 'nodejs';

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  style: z.record(z.string(), z.unknown()),
});

/** Save the current look as a reusable template. */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Give the template a name.' }, { status: 400 });

  const { error } = await db()
    .from('pin_templates')
    .insert({ name: parsed.data.name, style: parsed.data.style });
  if (error) return NextResponse.json({ error: `Saving failed: ${error.message}` }, { status: 500 });

  revalidatePath('/pins');
  return NextResponse.json({ ok: true });
}

const deleteSchema = z.object({ id: z.string().uuid() });

export async function DELETE(request: Request) {
  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Bad request.' }, { status: 400 });

  const { error } = await db().from('pin_templates').delete().eq('id', parsed.data.id);
  if (error) return NextResponse.json({ error: `Deleting failed: ${error.message}` }, { status: 500 });

  revalidatePath('/pins');
  return NextResponse.json({ ok: true });
}
