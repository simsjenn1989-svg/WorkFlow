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
        name: z.string().trim().min(1).max(200),
      }),
    )
    .min(1)
    .max(50),
  title: z.string().trim().max(200).nullable().default(null),
  collectionId: z.string().uuid().nullable().default(null),
  tags: z.array(z.string().trim().min(1).max(60)).max(40).default([]),
});

/**
 * Register designs for files already uploaded to storage.
 *
 * These start at `approved`: the art exists, there was no prompt to generate it from, so
 * there is nothing to pick between.
 */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Bad request.' }, { status: 400 });

  const { items, title, collectionId, tags } = parsed.data;

  const rows = items.map((item, index) => ({
    id: item.id,
    // A shared title across several files gets numbered; file names are already distinct.
    title: title ? (items.length > 1 ? `${title} ${index + 1}` : title) : item.name,
    stage: 'approved',
    collection_id: collectionId,
    tags,
    raw_image_path: item.path,
  }));

  const { error } = await db().from('designs').insert(rows);
  if (error) {
    await db()
      .storage.from(BUCKET)
      .remove(items.map((i) => i.path));
    return NextResponse.json({ error: `Saving failed: ${error.message}` }, { status: 500 });
  }

  revalidatePath('/');
  return NextResponse.json({ created: rows.length });
}
