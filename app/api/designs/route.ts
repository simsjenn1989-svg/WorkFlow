import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { BUCKET, db } from '@/lib/supabase';
import { normaliseLabel, PRIMARY_LABEL } from '@/lib/artworks';

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
  /** Which placement the uploaded art is for. */
  label: z.string().trim().max(40).default(PRIMARY_LABEL),
  /** Attach to an existing design instead of creating new ones — e.g. adding back art. */
  designId: z.string().uuid().nullable().default(null),
});

/**
 * Register uploaded artwork.
 *
 * With `designId` the files become artwork on an existing design, which is how a back print
 * is added to a design that already has a front. Otherwise each file becomes its own design,
 * starting at `approved`: the art exists and there was no prompt to generate it from, so
 * there is nothing to pick between.
 */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Bad request.' }, { status: 400 });

  const { items, title, collectionId, tags, designId } = parsed.data;
  const label = normaliseLabel(parsed.data.label);

  const cleanUp = async () => {
    await db()
      .storage.from(BUCKET)
      .remove(items.map((i) => i.path));
  };

  if (designId) {
    if (items.length !== 1) {
      await cleanUp();
      return NextResponse.json(
        { error: 'Adding artwork to a design takes one file at a time.' },
        { status: 400 },
      );
    }
    const { error } = await db()
      .from('design_artworks')
      .upsert(
        { design_id: designId, label, image_path: items[0]!.path },
        { onConflict: 'design_id,label' },
      );
    if (error) {
      await cleanUp();
      return NextResponse.json({ error: `Saving failed: ${error.message}` }, { status: 500 });
    }

    revalidatePath('/');
    revalidatePath(`/designs/${designId}`);
    return NextResponse.json({ created: 1 });
  }

  const designs = items.map((item, index) => ({
    id: item.id,
    // A shared title across several files gets numbered; file names are already distinct.
    title: title ? (items.length > 1 ? `${title} ${index + 1}` : title) : item.name,
    stage: 'approved',
    collection_id: collectionId,
    tags,
  }));

  const { error: designError } = await db().from('designs').insert(designs);
  if (designError) {
    await cleanUp();
    return NextResponse.json({ error: `Saving failed: ${designError.message}` }, { status: 500 });
  }

  const { error: artError } = await db()
    .from('design_artworks')
    .insert(items.map((item) => ({ design_id: item.id, label, image_path: item.path })));
  if (artError) {
    // Without artwork the designs are empty cards, so take them back out.
    await db()
      .from('designs')
      .delete()
      .in('id', items.map((i) => i.id));
    await cleanUp();
    return NextResponse.json({ error: `Saving failed: ${artError.message}` }, { status: 500 });
  }

  revalidatePath('/');
  return NextResponse.json({ created: designs.length });
}
