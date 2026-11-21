'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/supabase';
import { removeAll } from '@/lib/storage';
import type { ActionResult } from '@/app/actions';

const schema = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) });

/**
 * Throw away renders.
 *
 * There was no way to do this at all: a batch run across sixteen mockups produced sixteen
 * images and the only options were keep them or delete the design. Re-marking the print
 * areas makes every earlier render wrong at once, which is exactly when a bulk delete is
 * needed.
 *
 * The files go too. A render is a 1-2 MB JPEG and the rows are the only record of where
 * they live, so deleting the rows first would strand every one of them — the same mistake
 * that once left two thirds of the bucket orphaned.
 *
 * Stages are left alone. A design sitting in Mockups done whose renders are gone is a
 * design you are about to re-render, not one that has moved backwards, and quietly
 * rewinding the board under someone is worse than a stale column.
 */
export async function deleteRenders(ids: string[]): Promise<ActionResult> {
  const parsed = schema.safeParse({ ids });
  if (!parsed.success) return { ok: false, error: 'Nothing valid to delete.' };

  const { data } = await db()
    .from('renders')
    .select('id,output_path')
    .in('id', parsed.data.ids);

  const rows = (data ?? []) as { id: string; output_path: string | null }[];
  if (rows.length === 0) return { ok: false, error: 'Those renders no longer exist.' };

  const { error } = await db()
    .from('renders')
    .delete()
    .in(
      'id',
      rows.map((r) => r.id),
    );
  if (error) return { ok: false, error: `Deleting failed: ${error.message}` };

  await removeAll(rows.map((r) => r.output_path).filter((p): p is string => Boolean(p)));

  revalidatePath('/renders');
  revalidatePath('/pins');
  revalidatePath('/videos');
  return { ok: true };
}

/** Every finished or failed render, for the "delete all" the page offers. */
export async function allRenderIds(): Promise<string[]> {
  const { data } = await db().from('renders').select('id');
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}
