import { BUCKET, db } from './supabase';

/**
 * Deleting the files a thing owned, not just the row that pointed at them.
 *
 * Supabase storage has no folders — a path is a name with slashes in it — and `list` returns
 * only one level, with a prefix appearing as an entry whose `id` is null. Passing a prefix to
 * `remove` deletes nothing. So anything that "deletes a folder" has to walk it.
 *
 * This existed as a one-line `list` before, which is why two thirds of the bucket ended up
 * orphaned: a design's own folder was half cleared (its `variants/` and `print-ready/`
 * subfolders survived), and the renders, pins and clips that belonged to it were never
 * considered at all — the database cascade removed their rows and left every file.
 */

/** Every file under a prefix, however deep. */
export async function listRecursive(prefix: string): Promise<string[]> {
  const found: string[] = [];
  const { data, error } = await db().storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (error || !data) return found;

  for (const entry of data) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    // A prefix, not a file: storage reports those with a null id.
    if (entry.id === null) found.push(...(await listRecursive(path)));
    else found.push(path);
  }
  return found;
}

/** Remove files, in batches, ignoring any that have already gone. */
export async function removeAll(paths: string[]): Promise<number> {
  const unique = [...new Set(paths.filter(Boolean))];
  let removed = 0;
  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100);
    const { error } = await db().storage.from(BUCKET).remove(batch);
    if (!error) removed += batch.length;
  }
  return removed;
}

/**
 * Every file that belongs to one design, including everything made from it.
 *
 * Collected before the row is deleted, because the database cascade takes the renders, pins
 * and videos with it and there is then nothing left to say which files were theirs.
 */
export async function filesOwnedByDesign(designId: string): Promise<string[]> {
  const paths: string[] = await listRecursive(`designs/${designId}`);

  const { data: renders } = await db()
    .from('renders')
    .select('id,output_path')
    .eq('design_id', designId);
  for (const row of (renders ?? []) as { output_path: string | null }[]) {
    if (row.output_path) paths.push(row.output_path);
  }

  const { data: pins } = await db().from('pins').select('output_path').eq('design_id', designId);
  for (const row of (pins ?? []) as { output_path: string | null }[]) {
    if (row.output_path) paths.push(row.output_path);
  }

  const { data: videos } = await db().from('videos').select('id').eq('design_id', designId);
  for (const row of (videos ?? []) as { id: string }[]) {
    paths.push(...(await listRecursive(`videos/${row.id}`)));
  }

  return [...new Set(paths)];
}

export type Orphan = { path: string; bytes: number };

/**
 * Files in the bucket that no row points at.
 *
 * A sweep rather than a guess: every path column in every table is collected and anything
 * not in that set is unreferenced. Returned rather than deleted, because "nothing refers to
 * this" is a strong claim and deleting on it should be a decision, not a side effect.
 */
export async function findOrphans(): Promise<Orphan[]> {
  const referenced = new Set<string>();
  /**
   * Every path column in the database, checked against `information_schema` rather than
   * remembered. A column missing from this list is a file deleted while something still
   * points at it, which is the one way this function can do real damage —
   * `printify_uploads.source_path` was missing from the first version.
   *
   *   select table_name, column_name from information_schema.columns
   *   where table_schema = 'public' and column_name like '%path%';
   */
  const columns: [string, string[]][] = [
    ['design_artworks', ['image_path', 'print_ready_path']],
    ['design_variants', ['image_path']],
    ['fonts', ['file_path']],
    ['mockup_templates', ['source_path']],
    ['pins', ['output_path']],
    ['printify_uploads', ['source_path']],
    ['renders', ['output_path']],
    ['videos', ['output_path', 'source_path']],
  ];

  // Reference images are inputs, recorded on the job rather than in a path column, so the
  // column sweep cannot see them. Without this a reference would be deleted as an orphan
  // while a retry still needed it.
  const { data: jobs } = await db().from('jobs').select('payload');
  for (const row of (jobs ?? []) as { payload: { referencePath?: string } | null }[]) {
    if (row.payload?.referencePath) referenced.add(row.payload.referencePath);
  }

  for (const [table, cols] of columns) {
    const { data, error } = await db().from(table).select(cols.join(','));
    if (error) continue;
    for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
      for (const value of Object.values(row)) {
        if (typeof value === 'string' && value) referenced.add(value);
      }
    }
  }

  const orphans: Orphan[] = [];
  const walk = async (prefix: string): Promise<void> => {
    const { data } = await db().storage.from(BUCKET).list(prefix, { limit: 1000 });
    for (const entry of data ?? []) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) await walk(path);
      else if (!referenced.has(path)) {
        orphans.push({ path, bytes: (entry.metadata?.size as number | undefined) ?? 0 });
      }
    }
  };
  await walk('');
  return orphans;
}
