'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/supabase';
import { listRecursive, removeAll } from '@/lib/storage';
import type { ActionResult } from '@/app/actions';

const schema = z.object({ ids: z.array(z.string().uuid()).min(1).max(200) });

/**
 * Throw away clips.
 *
 * There was no way to do this — the same gap the Pins screen had. A clip could be made and
 * then neither deleted nor properly downloaded, so the list only ever grew, and video files
 * are the largest things in the bucket.
 *
 * The files go with the rows, and the whole `videos/<id>` prefix goes rather than just the
 * two recorded paths: a clip's folder also holds the prepared 9:16 frame and whatever else
 * the job wrote, and the row is the only record of where any of it lives. Paths are
 * collected before the rows are deleted for exactly that reason.
 */
export async function deleteVideos(ids: string[]): Promise<ActionResult> {
  const parsed = schema.safeParse({ ids });
  if (!parsed.success) return { ok: false, error: 'Nothing valid to delete.' };

  const { data } = await db()
    .from('videos')
    .select('id,output_path,source_path')
    .in('id', parsed.data.ids);
  const rows = (data ?? []) as { id: string; output_path: string | null; source_path: string | null }[];
  if (rows.length === 0) return { ok: false, error: 'Those clips no longer exist.' };

  const paths: string[] = [];
  for (const row of rows) {
    if (row.output_path) paths.push(row.output_path);
    if (row.source_path) paths.push(row.source_path);
    paths.push(...(await listRecursive(`videos/${row.id}`)));
  }

  const { error } = await db()
    .from('videos')
    .delete()
    .in(
      'id',
      rows.map((r) => r.id),
    );
  if (error) return { ok: false, error: `Deleting failed: ${error.message}` };

  await removeAll(paths);

  revalidatePath('/videos');
  revalidatePath('/');
  return { ok: true };
}
