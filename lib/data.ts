import { db, signedUrl } from './supabase';
import type { Collection, Design, DesignCard, StageEvent } from './types';
import { ALL_STAGES, type Stage } from './stages';

export type DesignFilter = {
  collectionId?: string;
  tag?: string;
  q?: string;
};

type DesignRow = Design & { collections: { name: string } | null };

/**
 * Every design, as cards keyed by stage. One query plus one signed-URL batch, rather than
 * a query per column.
 */
export async function boardData(
  filter: DesignFilter = {},
): Promise<Record<Stage, DesignCard[]>> {
  let query = db()
    .from('designs')
    .select('*, collections(name)')
    .order('stage_changed_at', { ascending: true });

  if (filter.collectionId) query = query.eq('collection_id', filter.collectionId);
  if (filter.tag) query = query.contains('tags', [filter.tag]);
  if (filter.q) query = query.ilike('title', `%${filter.q}%`);

  const { data, error } = await query;
  if (error) throw new Error(`Loading the board failed: ${error.message}`);

  const rows = (data ?? []) as DesignRow[];
  const cards = await Promise.all(rows.map(toCard));

  const byStage = Object.fromEntries(ALL_STAGES.map((s) => [s, [] as DesignCard[]])) as Record<
    Stage,
    DesignCard[]
  >;
  for (const card of cards) byStage[card.stage]?.push(card);
  return byStage;
}

async function toCard(row: DesignRow): Promise<DesignCard> {
  const { collections, ...design } = row;
  return {
    ...design,
    collection_name: collections?.name ?? null,
    image_url: await signedUrl(design.print_ready_path ?? design.raw_image_path),
  };
}

export async function getDesign(id: string): Promise<DesignCard | null> {
  const { data, error } = await db()
    .from('designs')
    .select('*, collections(name)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Loading the design failed: ${error.message}`);
  if (!data) return null;
  return toCard(data as DesignRow);
}

export async function getStageHistory(designId: string): Promise<StageEvent[]> {
  const { data, error } = await db()
    .from('stage_events')
    .select('*')
    .eq('design_id', designId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Loading the history failed: ${error.message}`);
  return (data ?? []) as StageEvent[];
}

export async function listCollections(): Promise<Collection[]> {
  const { data, error } = await db()
    .from('collections')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Loading collections failed: ${error.message}`);
  return (data ?? []) as Collection[];
}

export async function collectionCounts(): Promise<Record<string, number>> {
  const { data, error } = await db().from('designs').select('collection_id');
  if (error) return {};
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as { collection_id: string | null }[]) {
    if (row.collection_id) counts[row.collection_id] = (counts[row.collection_id] ?? 0) + 1;
  }
  return counts;
}

/** Every tag in use, with how many designs carry it. Powers the filter bar. */
export async function listTags(): Promise<{ tag: string; count: number }[]> {
  const { data, error } = await db().from('designs').select('tags');
  if (error) return [];
  const counts = new Map<string, number>();
  for (const row of (data ?? []) as { tags: string[] }[]) {
    for (const tag of row.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
