import { db, signedUrl } from './supabase';

export type Prompt = {
  id: string;
  name: string;
  body: string;
  slots: string[];
  target_model: string | null;
  notes: string | null;
  created_at: string;
};

export type Variant = {
  id: string;
  design_id: string;
  label: string;
  image_path: string;
  model: string | null;
  chosen: boolean;
  cost_cents: number;
  created_at: string;
  url: string | null;
};

export async function listPrompts(): Promise<Prompt[]> {
  const { data, error } = await db()
    .from('prompts')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Loading prompts failed: ${error.message}`);
  return (data ?? []) as Prompt[];
}

export async function getPrompt(id: string): Promise<Prompt | null> {
  const { data } = await db().from('prompts').select('*').eq('id', id).maybeSingle();
  return (data as Prompt) ?? null;
}

export async function listVariants(designId: string): Promise<Variant[]> {
  const { data, error } = await db()
    .from('design_variants')
    .select('*')
    .eq('design_id', designId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Loading variants failed: ${error.message}`);

  const rows = (data ?? []) as Omit<Variant, 'url'>[];
  return Promise.all(
    rows.map(async (row) => ({ ...row, url: await signedUrl(row.image_path) })),
  );
}

/** Find the slots a prompt body declares, e.g. {{subject}}. */
export function slotsIn(body: string): string[] {
  const found = new Set<string>();
  for (const match of body.matchAll(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g)) {
    if (match[1]) found.add(match[1]);
  }
  return [...found];
}

/** Replace {{slots}} with the given values; anything unfilled is left alone. */
export function fillSlots(body: string, values: Record<string, string>): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, (whole, name: string) => {
    const value = values[name]?.trim();
    return value ? value : whole;
  });
}
