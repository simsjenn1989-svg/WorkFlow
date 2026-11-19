import { db, signedUrl } from './supabase';

export type RenderRow = {
  id: string;
  design_id: string;
  mockup_template_id: string;
  batch_id: string | null;
  output_path: string | null;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  error: string | null;
  created_at: string;
  finished_at: string | null;
};

export type RenderCard = RenderRow & {
  design_title: string;
  mockup_name: string;
  url: string | null;
};

type Row = RenderRow & {
  designs: { title: string } | null;
  mockup_templates: { name: string } | null;
};

/** Finished and failed renders, newest first. */
export async function listRenders(limit = 60): Promise<RenderCard[]> {
  const { data, error } = await db()
    .from('renders')
    .select('*, designs(title), mockup_templates(name)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Loading renders failed: ${error.message}`);

  const rows = (data ?? []) as Row[];
  return Promise.all(
    rows.map(async ({ designs, mockup_templates, ...row }) => ({
      ...row,
      design_title: designs?.title ?? 'Unknown design',
      mockup_name: mockup_templates?.name ?? 'Unknown mockup',
      url: await signedUrl(row.output_path),
    })),
  );
}
