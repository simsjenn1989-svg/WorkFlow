import { db, signedUrl } from '../supabase';
import { DEFAULT_STYLE, type PinContent, type PinStyle } from './style';

export type PinTemplate = {
  id: string;
  name: string;
  style: PinStyle;
  created_at: string;
};

export type Pin = {
  id: string;
  design_id: string;
  pin_template_id: string | null;
  source_render_id: string | null;
  headline: string | null;
  subtitle: string | null;
  cta: string | null;
  footer: string | null;
  /** Pinterest's own search title, kept live rather than drawn into the image. */
  title: string | null;
  description: string | null;
  link: string | null;
  output_path: string | null;
  style: Partial<PinStyle>;
  content: Partial<PinContent>;
  created_at: string;
};

export type PinCard = Pin & { design_title: string; url: string | null };

export async function listPinTemplates(): Promise<PinTemplate[]> {
  const { data, error } = await db()
    .from('pin_templates')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Loading pin templates failed: ${error.message}`);

  // Merge over the defaults, so a template saved before a style field existed still works.
  return ((data ?? []) as PinTemplate[]).map((t) => ({
    ...t,
    style: { ...DEFAULT_STYLE, ...t.style },
  }));
}

export async function listPins(limit = 60): Promise<PinCard[]> {
  const { data, error } = await db()
    .from('pins')
    .select('*, designs(title)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Loading pins failed: ${error.message}`);

  const rows = (data ?? []) as (Pin & { designs: { title: string } | null })[];
  return Promise.all(
    rows.map(async ({ designs, ...pin }) => ({
      ...pin,
      design_title: designs?.title ?? 'Unknown design',
      url: await signedUrl(pin.output_path),
    })),
  );
}
