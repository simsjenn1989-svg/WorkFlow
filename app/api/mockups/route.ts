import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { BUCKET, db } from '@/lib/supabase';

export const runtime = 'nodejs';

const schema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        path: z.string().min(1).max(300),
        name: z.string().trim().min(1).max(120),
      }),
    )
    .min(1)
    .max(50),
  tags: z.array(z.string().trim().min(1).max(60)).max(40).default([]),
});

/** Register mockup templates for files already uploaded to storage. */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Bad request.' }, { status: 400 });

  const rows = parsed.data.items.map((item) => ({
    id: item.id,
    name: item.name,
    source_type: 'photo',
    source_path: item.path,
    tags: parsed.data.tags,
  }));

  const { error } = await db().from('mockup_templates').insert(rows);
  if (error) {
    // The objects are already in storage; drop them so a failed insert leaves nothing behind.
    await db()
      .storage.from(BUCKET)
      .remove(parsed.data.items.map((i) => i.path));
    return NextResponse.json({ error: `Saving failed: ${error.message}` }, { status: 500 });
  }

  revalidatePath('/mockups');
  return NextResponse.json({ created: rows.length });
}
