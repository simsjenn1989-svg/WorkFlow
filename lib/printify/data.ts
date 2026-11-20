import { db } from '@/lib/supabase';
import { productUrl } from './client';

export type DraftRow = {
  id: string;
  design_id: string;
  preset_id: string;
  status: 'queued' | 'running' | 'draft' | 'failed';
  printify_product_id: string | null;
  shop_id: string | null;
  title: string | null;
  skipped: string[];
  error: string | null;
  created_at: string;
  finished_at: string | null;
};

export type DraftCard = DraftRow & {
  design_title: string;
  preset_name: string;
  /** A link straight to the draft in Printify, when there is one to link to. */
  url: string | null;
};

type Row = DraftRow & {
  designs: { title: string } | null;
  printify_presets: { name: string } | null;
};

export async function listDrafts(limit = 100): Promise<DraftCard[]> {
  const { data, error } = await db()
    .from('printify_products')
    .select('*, designs(title), printify_presets(name)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Loading Printify drafts failed: ${error.message}`);

  return ((data ?? []) as Row[]).map(({ designs, printify_presets, ...row }) => ({
    ...row,
    design_title: designs?.title ?? 'Unknown design',
    preset_name: printify_presets?.name ?? 'Unknown preset',
    url:
      row.shop_id && row.printify_product_id
        ? productUrl(row.shop_id, row.printify_product_id)
        : null,
  }));
}

/** Which designs already have a draft, so the picker can say so instead of looking identical. */
export async function draftedDesignIds(): Promise<Set<string>> {
  const { data } = await db()
    .from('printify_products')
    .select('design_id')
    .eq('status', 'draft');
  return new Set(((data ?? []) as { design_id: string }[]).map((r) => r.design_id));
}
