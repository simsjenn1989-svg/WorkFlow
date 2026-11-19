'use server';

import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { BUCKET, db } from '@/lib/supabase';
import { isStage, nextStage, previousStage, type Stage } from '@/lib/stages';

/** Shape returned by every action so the UI can show a message without throwing. */
export type ActionResult = { ok: true } | { ok: false; error: string };

function fail(error: string): ActionResult {
  return { ok: false, error };
}

const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'] as const;
const MAX_BYTES = 40 * 1024 * 1024;

const uploadSchema = z.object({
  title: z.string().trim().max(200).optional(),
  collectionId: z.string().uuid().optional(),
  tags: z.string().trim().max(500).optional(),
});

/**
 * Create designs from uploaded image files.
 *
 * Phase 1 is a manual organiser, so this is how designs get in. Phase 2 adds the same
 * thing driven by Atlas Cloud. A design created this way starts at `approved`, because the
 * art already exists — there was no prompt to generate from.
 */
export async function uploadDesigns(form: FormData): Promise<ActionResult> {
  const parsed = uploadSchema.safeParse({
    title: form.get('title') ?? undefined,
    collectionId: form.get('collectionId') || undefined,
    tags: form.get('tags') ?? undefined,
  });
  if (!parsed.success) return fail('Those details are not valid.');

  const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return fail('Pick at least one image.');

  const tags = (parsed.data.tags ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  for (const file of files) {
    if (!(ACCEPTED as readonly string[]).includes(file.type)) {
      return fail(`${file.name} is a ${file.type || 'unknown'} file. Use PNG, JPG or WebP.`);
    }
    if (file.size > MAX_BYTES) return fail(`${file.name} is larger than 40 MB.`);
  }

  const single = files.length === 1;

  for (const [i, file] of files.entries()) {
    const id = randomUUID();
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png';
    const path = `designs/${id}/raw.${ext}`;

    const { error: upErr } = await db()
      .storage.from(BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) return fail(`Uploading ${file.name} failed: ${upErr.message}`);

    const base = parsed.data.title?.trim() || stripExt(file.name);
    const title = single ? base : `${base} ${i + 1}`;

    const { error: insErr } = await db().from('designs').insert({
      id,
      title,
      stage: 'approved' satisfies Stage,
      collection_id: parsed.data.collectionId ?? null,
      tags,
      raw_image_path: path,
    });
    if (insErr) {
      // Don't leave an orphaned object behind if the row fails.
      await db().storage.from(BUCKET).remove([path]);
      return fail(`Saving ${file.name} failed: ${insErr.message}`);
    }
  }

  revalidatePath('/');
  return { ok: true };
}

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || 'Untitled';
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

/** Deletes the row and every stored object under its folder. */
export async function deleteDesign(designId: string): Promise<ActionResult> {
  const { data: list } = await db().storage.from(BUCKET).list(`designs/${designId}`);
  if (list?.length) {
    await db()
      .storage.from(BUCKET)
      .remove(list.map((o) => `designs/${designId}/${o.name}`));
  }
  const { error } = await db().from('designs').delete().eq('id', designId);
  if (error) return fail(`Deleting failed: ${error.message}`);
  revalidatePath('/');
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
