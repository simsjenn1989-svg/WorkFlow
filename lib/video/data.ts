import { db, signedUrl } from '@/lib/supabase';
import type { FrameMode } from './frame';

export type VideoRow = {
  id: string;
  design_id: string;
  source_render_id: string | null;
  shot_template_id: string | null;
  model: string | null;
  prompt: string | null;
  params: Record<string, unknown> | null;
  source_path: string | null;
  frame_mode: FrameMode | null;
  output_path: string | null;
  duration_s: number | null;
  cost_cents: number;
  prediction_id: string | null;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  error: string | null;
  created_at: string;
  finished_at: string | null;
};

export type VideoCard = VideoRow & {
  design_title: string;
  url: string | null;
  posterUrl: string | null;
};

type Row = VideoRow & { designs: { title: string } | null };

export async function listVideos(limit = 60): Promise<VideoCard[]> {
  const { data, error } = await db()
    .from('videos')
    .select('*, designs(title)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Loading videos failed: ${error.message}`);

  return Promise.all(
    ((data ?? []) as Row[]).map(async ({ designs, ...row }) => ({
      ...row,
      design_title: designs?.title ?? 'Unknown design',
      url: await signedUrl(row.output_path),
      // The frame that was sent doubles as the poster, so a clip still shows something
      // while it is generating.
      posterUrl: await signedUrl(row.source_path),
    })),
  );
}

export type ShotTemplate = {
  id: string;
  name: string;
  prompt: string;
  model: string;
  duration_s: number;
  aspect_ratio: string;
  params: Record<string, unknown>;
  frame_mode: FrameMode;
  is_default: boolean;
  created_at: string;
};

export async function listShots(): Promise<ShotTemplate[]> {
  const { data, error } = await db()
    .from('shot_templates')
    .select('*')
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Loading shots failed: ${error.message}`);
  return (data ?? []) as ShotTemplate[];
}

export async function saveShot(
  id: string | null,
  input: Omit<ShotTemplate, 'id' | 'created_at'>,
): Promise<{ id: string | null; error: string | null }> {
  if (input.is_default) {
    const clear = db().from('shot_templates').update({ is_default: false }).eq('is_default', true);
    await (id ? clear.neq('id', id) : clear);
  }
  if (id) {
    const { error } = await db().from('shot_templates').update(input).eq('id', id);
    return { id: error ? null : id, error: error?.message ?? null };
  }
  const { data, error } = await db().from('shot_templates').insert(input).select('id').single();
  return { id: (data as { id: string } | null)?.id ?? null, error: error?.message ?? null };
}

export async function deleteShot(id: string): Promise<{ error: string | null }> {
  const { error } = await db().from('shot_templates').delete().eq('id', id);
  return { error: error?.message ?? null };
}
