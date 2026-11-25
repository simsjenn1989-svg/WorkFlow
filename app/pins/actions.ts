'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/supabase';
import { removeAll } from '@/lib/storage';
import type { ActionResult } from '@/app/actions';

const schema = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) });

/**
 * Throw away saved pins.
 *
 * There was no way to do this: pins could be saved and never removed, so a screen meant for
 * picking the good ones filled up with the rest. The images go with the rows, because the
 * row is the only record of where the file lives — deleting rows first strands every PNG,
 * which is how two thirds of this bucket was orphaned once before.
 */
export async function deletePins(ids: string[]): Promise<ActionResult> {
  const parsed = schema.safeParse({ ids });
  if (!parsed.success) return { ok: false, error: 'Nothing valid to delete.' };

  const { data } = await db().from('pins').select('id,output_path').in('id', parsed.data.ids);
  const rows = (data ?? []) as { id: string; output_path: string | null }[];
  if (rows.length === 0) return { ok: false, error: 'Those pins no longer exist.' };

  const { error } = await db()
    .from('pins')
    .delete()
    .in('id', rows.map((r) => r.id));
  if (error) return { ok: false, error: `Deleting failed: ${error.message}` };

  await removeAll(rows.map((r) => r.output_path).filter((p): p is string => Boolean(p)));

  revalidatePath('/pins');
  revalidatePath('/');
  return { ok: true };
}
