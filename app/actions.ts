'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/supabase';
import { filesOwnedByDesign, removeAll } from '@/lib/storage';
import { putArtwork } from '@/lib/artworks';
import { isStage, nextStage, previousStage, type Stage } from '@/lib/stages';

/** Shape returned by every action so the UI can show a message without throwing. */
export type ActionResult = { ok: true } | { ok: false; error: string };

function fail(error: string): ActionResult {
  return { ok: false, error };
}

/** Move a design to an explicit stage. The database trigger records the history. */
export async function setStage(designId: string, stage: string): Promise<ActionResult> {
  if (!isStage(stage)) return fail(`"${stage}" is not a stage.`);
  const { error } = await db().from('designs').update({ stage }).eq('id', designId);
  if (error) return fail(`Moving it failed: ${error.message}`);
  revalidatePath('/');
  revalidatePath(`/designs/${designId}`);
  return { ok: true };
}

export async function advanceDesign(designId: string, from: string): Promise<ActionResult> {
  if (!isStage(from)) return fail('Unknown current stage.');
  const to = nextStage(from);
  if (!to) return fail('This design is already at the end of the pipeline.');
  return setStage(designId, to);
}

export async function regressDesign(designId: string, from: string): Promise<ActionResult> {
  if (!isStage(from)) return fail('Unknown current stage.');
  const to = previousStage(from);
  if (!to) return fail('This design is already at the first stage.');
  return setStage(designId, to);
}

const designUpdateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  collectionId: z.string().uuid().nullable(),
  tags: z.array(z.string().trim().min(1).max(60)).max(40),
  notes: z.string().trim().max(5000).nullable(),
});

export async function updateDesign(designId: string, form: FormData): Promise<ActionResult> {
  const parsed = designUpdateSchema.safeParse({
    title: form.get('title'),
    collectionId: form.get('collectionId') || null,
    tags: String(form.get('tags') ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    notes: (form.get('notes') as string)?.trim() || null,
  });
  if (!parsed.success) return fail('Give it a title of 200 characters or fewer.');

  const { error } = await db()
    .from('designs')
    .update({
      title: parsed.data.title,
      collection_id: parsed.data.collectionId,
      tags: parsed.data.tags,
      notes: parsed.data.notes,
    })
    .eq('id', designId);
  if (error) return fail(`Saving failed: ${error.message}`);

  revalidatePath('/');
  revalidatePath(`/designs/${designId}`);
  return { ok: true };
}

/**
 * Delete a design, everything made from it, and every file either owned.
 *
 * The file list is gathered BEFORE the row goes, because deleting the design cascades its
 * renders, pins and videos away and there is then nothing left to say which files were
 * theirs. That ordering is the whole fix: the earlier version listed one level of the
 * design's own folder and stopped, so `variants/` and `print-ready/` survived and the
 * renders, pins and clips were never considered at all. One deleted design left 46 MB of
 * a 70 MB bucket behind.
 *
 * What is NOT deleted: the draft in Printify. That lives in someone else's system, so the
 * design page warns before the button is pressed rather than reporting it afterwards.
 */
export async function deleteDesign(designId: string): Promise<ActionResult> {
  const paths = await filesOwnedByDesign(designId);

  const { error } = await db().from('designs').delete().eq('id', designId);
  if (error) return fail(`Deleting failed: ${error.message}`);

  await removeAll(paths);

  revalidatePath('/');
  revalidatePath('/renders');
  revalidatePath('/pins');
  revalidatePath('/videos');
  revalidatePath('/printify');
  return { ok: true };
}

const ideaSchema = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(5000).nullable(),
  collectionId: z.string().uuid().nullable(),
  tags: z.array(z.string().trim().min(1).max(60)).max(40),
});

/**
 * A design you intend to make, before any image exists.
 *
 * Idea was the one column nothing could reach. Generating starts a design at Generated and
 * uploading starts it at Approved, so the first column on the board sat there looking like
 * an inbox while the only things that ever arrived in it were generations that had failed.
 * An idea written down somewhere other than the board is an idea you stop seeing.
 *
 * The notes field doubles as the draft prompt: the card's "Generate this" link carries it
 * into the Generate form, which is why the two are not kept apart.
 */
export async function createIdea(form: FormData): Promise<ActionResult> {
  const parsed = ideaSchema.safeParse({
    title: form.get('title'),
    notes: (form.get('notes') as string)?.trim() || null,
    collectionId: (form.get('collectionId') as string) || null,
    tags: String(form.get('tags') ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
  });
  if (!parsed.success) return fail('An idea needs a title.');

  const { error } = await db().from('designs').insert({
    title: parsed.data.title,
    notes: parsed.data.notes,
    collection_id: parsed.data.collectionId,
    tags: parsed.data.tags,
    stage: 'idea',
  });
  if (error) return fail(`Saving the idea failed: ${error.message}`);

  revalidatePath('/');
  return { ok: true };
}

const assignSchema = z.object({
  designId: z.string().uuid(),
  label: z.string().trim().min(1).max(40),
  source: z.string().regex(/^(variant|artwork):[0-9a-f-]{36}$/),
});

/**
 * Put an image the design already has onto another placement.
 *
 * The Add-placement form only took a file upload, which meant the same art on the front and
 * the back — or a shrunk copy on the pocket — required downloading the design and uploading
 * it back again. Worse, the form looked like the place you tell the app where the design
 * goes, so it was the first thing to reach for and then asked for a file that already
 * existed inside the app.
 *
 * The image is shared, not copied: both placements point at one stored file. That is right
 * because it IS one image, and because the print-ready version is built per placement at
 * push time from its own rules, so sharing the source costs nothing downstream.
 */
export async function assignArtwork(
  designId: string,
  label: string,
  source: string,
): Promise<ActionResult> {
  const parsed = assignSchema.safeParse({ designId, label, source });
  if (!parsed.success) return fail('That placement or image is not valid.');

  const [kind, id] = parsed.data.source.split(':') as ['variant' | 'artwork', string];
  const table = kind === 'variant' ? 'design_variants' : 'design_artworks';

  // Read the path from the database rather than trusting one sent by the browser, and scope
  // it to this design: without the design_id check, any stored file could be attached to
  // any design by editing the request.
  const { data: row } = await db()
    .from(table)
    .select('image_path')
    .eq('id', id)
    .eq('design_id', parsed.data.designId)
    .maybeSingle();
  if (!row) return fail('That image does not belong to this design.');

  const { error } = await putArtwork({
    designId: parsed.data.designId,
    label: parsed.data.label,
    imagePath: (row as { image_path: string }).image_path,
  });
  if (error) return fail(`Adding the placement failed: ${error}`);

  revalidatePath('/');
  revalidatePath(`/designs/${parsed.data.designId}`);
  return { ok: true };
}

const collectionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  theme: z.string().trim().max(200).nullable(),
  notes: z.string().trim().max(2000).nullable(),
});

export async function createCollection(form: FormData): Promise<ActionResult> {
  const parsed = collectionSchema.safeParse({
    name: form.get('name'),
    theme: (form.get('theme') as string)?.trim() || null,
    notes: (form.get('notes') as string)?.trim() || null,
  });
  if (!parsed.success) return fail('A collection needs a name.');

  const { error } = await db().from('collections').insert(parsed.data);
  if (error) return fail(`Creating it failed: ${error.message}`);
  revalidatePath('/collections');
  revalidatePath('/');
  return { ok: true };
}

/** Designs in the collection are kept and become uncollected. */
export async function deleteCollection(id: string): Promise<ActionResult> {
  const { error } = await db().from('collections').delete().eq('id', id);
  if (error) return fail(`Deleting failed: ${error.message}`);
  revalidatePath('/collections');
  revalidatePath('/');
  return { ok: true };
}
