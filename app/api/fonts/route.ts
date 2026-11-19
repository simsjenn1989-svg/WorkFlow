import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { BUCKET, db } from '@/lib/supabase';
import { familyNameFor } from '@/lib/pins/fonts';

export const runtime = 'nodejs';

const schema = z.object({
  id: z.string().uuid(),
  path: z.string().min(1).max(300),
  fileName: z.string().trim().min(1).max(200),
});

/** Register a font file the browser has already uploaded. */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Bad request.' }, { status: 400 });

  const { id, path, fileName } = parsed.data;

  const { error } = await db().from('fonts').insert({
    id,
    name: fileName,
    family: familyNameFor(fileName, id),
    file_path: path,
  });
  if (error) {
    await db().storage.from(BUCKET).remove([path]);
    return NextResponse.json({ error: `Saving the font failed: ${error.message}` }, { status: 500 });
  }

  revalidatePath('/pins');
  return NextResponse.json({ ok: true });
}

const deleteSchema = z.object({ id: z.string().uuid() });

export async function DELETE(request: Request) {
  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Bad request.' }, { status: 400 });

  const { data: font } = await db()
    .from('fonts')
    .select('file_path')
    .eq('id', parsed.data.id)
    .maybeSingle();

  const { error } = await db().from('fonts').delete().eq('id', parsed.data.id);
  if (error) return NextResponse.json({ error: `Deleting failed: ${error.message}` }, { status: 500 });

  if (font) await db().storage.from(BUCKET).remove([(font as { file_path: string }).file_path]);

  revalidatePath('/pins');
  return NextResponse.json({ ok: true });
}
