import { db, signedUrl } from './supabase';
import { artworkPath, sortArtworks } from './artworks';
import type { Collection, Design, DesignCard, StageEvent } from './types';
import { ALL_STAGES, type Stage } from './stages';

export type DesignFilter = {
  collectionId?: string;
  tag?: string;
  q?: string;
};

type ArtworkRow = { label: string; image_path: string; print_ready_path: string | null };
type VariantRow = { id: string; image_path: string; chosen: boolean; created_at: string };
type DesignRow = Design & {
  collections: { name: string } | null;
  design_artworks: ArtworkRow[] | null;
  design_variants: VariantRow[] | null;
};

type JobRow = {
  id: string;
  status: DesignCard['job'] extends null ? never : NonNullable<DesignCard['job']>['status'];
  error: string | null;
  payload: {
    designId?: string;
    predictionId?: string;
    model?: string;
    count?: number;
    label?: string;
    prompt?: string;
  } | null;
  created_at: string;
};

/**
 * The newest generation per design.
 *
 * One query for the whole board rather than one per card: `jobs` has no design column, the
 * design id lives in the payload, so this reads recent jobs and indexes them in memory.
 */
async function latestJobs(designIds: string[]): Promise<Map<string, JobRow>> {
  const byDesign = new Map<string, JobRow>();
  if (designIds.length === 0) return byDesign;

  const { data } = await db()
    .from('jobs')
    .select('id,status,error,payload,created_at')
    .order('created_at', { ascending: false })
    .limit(200);

  for (const job of (data ?? []) as JobRow[]) {
    const designId = job.payload?.designId;
    if (!designId || byDesign.has(designId)) continue;
    if (designIds.includes(designId)) byDesign.set(designId, job);
  }
  return byDesign;
}

/**
 * Every design, as cards keyed by stage. One query plus one signed-URL batch, rather than
 * a query per column.
 */
export async function boardData(
  filter: DesignFilter = {},
): Promise<Record<Stage, DesignCard[]>> {
  let query = db()
    .from('designs')
    .select(
      '*, collections(name), design_artworks(label,image_path,print_ready_path), design_variants(id,image_path,chosen,created_at)',
    )
    .order('stage_changed_at', { ascending: true });

  if (filter.collectionId) query = query.eq('collection_id', filter.collectionId);
  if (filter.tag) query = query.contains('tags', [filter.tag]);
  if (filter.q) query = query.ilike('title', `%${filter.q}%`);

  const { data, error } = await query;
  if (error) throw new Error(`Loading the board failed: ${error.message}`);

  const rows = (data ?? []) as DesignRow[];
  const jobs = await latestJobs(rows.map((r) => r.id));
  const cards = await Promise.all(rows.map((row) => toCard(row, jobs.get(row.id) ?? null)));

  const byStage = Object.fromEntries(ALL_STAGES.map((s) => [s, [] as DesignCard[]])) as Record<
    Stage,
    DesignCard[]
  >;
  for (const card of cards) byStage[card.stage]?.push(card);
  return byStage;
}

async function toCard(row: DesignRow, job: JobRow | null = null): Promise<DesignCard> {
  const { collections, design_artworks, design_variants, ...design } = row;
  // Front first, so the thumbnail is the primary artwork rather than whichever row came back first.
  const artworks = sortArtworks(design_artworks ?? []);
  const primary = artworks[0];

  // Falling back to a generated variant is the point: an image that exists but has not been
  // picked should look like a decision waiting, not like nothing happened.
  const unchosen = (design_variants ?? [])
    .filter((v) => !v.chosen)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const thumbnail = primary ? artworkPath(primary) : unchosen[0]?.image_path;

  return {
    ...design,
    collection_name: collections?.name ?? null,
    image_url: thumbnail ? await signedUrl(thumbnail) : null,
    artwork_labels: artworks.map((a) => a.label),
    unchosen_variants: primary ? 0 : unchosen.length,
    job: job
      ? {
          id: job.id,
          status: job.status,
          error: job.error,
          predictionId: job.payload?.predictionId ?? null,
          createdAt: job.created_at,
          // Enough to retry: the Generate screen reopens with these filled in, so the price
          // is quoted and confirmed again rather than money being spent by one click.
          retry: job.payload?.prompt
            ? { prompt: job.payload.prompt, model: job.payload.model ?? '', count: job.payload.count ?? 1, label: job.payload.label ?? 'front' }
            : null,
        }
      : null,
  };
}

export async function getDesign(id: string): Promise<DesignCard | null> {
  const { data, error } = await db()
    .from('designs')
    .select(
      '*, collections(name), design_artworks(label,image_path,print_ready_path), design_variants(id,image_path,chosen,created_at)',
    )
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

/** What a design owns, for warning before a delete takes it all. */
export async function thingsMadeFrom(designId: string): Promise<{
  renders: number;
  pins: number;
  videos: number;
  drafts: number;
  total: number;
}> {
  const count = async (table: string) => {
    const { count: n } = await db()
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('design_id', designId);
    return n ?? 0;
  };
  const [renders, pins, videos, drafts] = await Promise.all([
    count('renders'),
    count('pins'),
    count('videos'),
    count('printify_products'),
  ]);
  return { renders, pins, videos, drafts, total: renders + pins + videos + drafts };
}
