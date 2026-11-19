'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/supabase';
import { slotsIn } from '@/lib/queries';
import type { ActionResult } from '@/app/actions';

function fail(error: string): ActionResult {
  return { ok: false, error };
}

const promptSchema = z.object({
  name: z.string().trim().min(1).max(120),
  body: z.string().trim().min(3).max(32000),
  targetModel: z.string().trim().max(200).nullable(),
  notes: z.string().trim().max(2000).nullable(),
});

export async function createPrompt(form: FormData): Promise<ActionResult> {
  const parsed = promptSchema.safeParse({
    name: form.get('name'),
    body: form.get('body'),
    targetModel: (form.get('targetModel') as string)?.trim() || null,
    notes: (form.get('notes') as string)?.trim() || null,
  });
  if (!parsed.success) return fail('A prompt needs a name and a body.');

  const { error } = await db().from('prompts').insert({
    name: parsed.data.name,
    body: parsed.data.body,
    // Slots are derived from the body rather than typed separately, so they cannot drift.
    slots: slotsIn(parsed.data.body),
    target_model: parsed.data.targetModel,
    notes: parsed.data.notes,
  });
  if (error) return fail(`Saving the prompt failed: ${error.message}`);

  revalidatePath('/prompts');
  revalidatePath('/generate');
  return { ok: true };
}

export async function updatePrompt(id: string, form: FormData): Promise<ActionResult> {
  const parsed = promptSchema.safeParse({
    name: form.get('name'),
    body: form.get('body'),
    targetModel: (form.get('targetModel') as string)?.trim() || null,
    notes: (form.get('notes') as string)?.trim() || null,
  });
  if (!parsed.success) return fail('A prompt needs a name and a body.');

  const { error } = await db()
    .from('prompts')
    .update({
      name: parsed.data.name,
      body: parsed.data.body,
      slots: slotsIn(parsed.data.body),
      target_model: parsed.data.targetModel,
      notes: parsed.data.notes,
    })
    .eq('id', id);
  if (error) return fail(`Saving the prompt failed: ${error.message}`);

  revalidatePath('/prompts');
  revalidatePath('/generate');
  return { ok: true };
}

export async function deletePrompt(id: string): Promise<ActionResult> {
  const { error } = await db().from('prompts').delete().eq('id', id);
  if (error) return fail(`Deleting failed: ${error.message}`);
  revalidatePath('/prompts');
  return { ok: true };
}

/**
 * Pick the keeper from a generation.
 *
 * This is the whole point of the `generated` stage: several images came back, one of them
 * becomes the design. The rest stay on record so the choice can be revisited.
 */
export async function chooseVariant(designId: string, variantId: string): Promise<ActionResult> {
  const { data: variant, error: readError } = await db()
    .from('design_variants')
    .select('id,image_path,design_id')
    .eq('id', variantId)
    .maybeSingle();
  if (readError || !variant) return fail('That variant no longer exists.');
  if (variant.design_id !== designId) return fail('That variant belongs to another design.');

  await db().from('design_variants').update({ chosen: false }).eq('design_id', designId);
  await db().from('design_variants').update({ chosen: true }).eq('id', variantId);

  const { error } = await db()
    .from('designs')
    .update({ raw_image_path: variant.image_path, stage: 'approved' })
    .eq('id', designId);
  if (error) return fail(`Choosing it failed: ${error.message}`);

  revalidatePath('/');
  revalidatePath(`/designs/${designId}`);
  return { ok: true };
}
