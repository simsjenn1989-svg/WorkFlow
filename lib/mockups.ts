import { db, signedUrl } from './supabase';
import type { Quad } from './render/homography';
import type { RenderOptions } from './render/options';

/** A corner as a fraction of the image, so a stored area survives any later resizing. */
export type NormPoint = { x: number; y: number };
export type NormQuad = [NormPoint, NormPoint, NormPoint, NormPoint];

export type MockupTemplate = {
  id: string;
  product_id: string | null;
  name: string;
  source_path: string;
  print_area: { corners?: NormQuad };
  garment_color: string | null;
  base_luma: number | null;
  tags: string[];
  active: boolean;
  render_options: Partial<RenderOptions>;
  created_at: string;
  url: string | null;
};

/** Centred area covering a plausible chest print, used until the corners are marked. */
export const DEFAULT_AREA: NormQuad = [
  { x: 0.36, y: 0.4 },
  { x: 0.64, y: 0.4 },
  { x: 0.64, y: 0.68 },
  { x: 0.36, y: 0.68 },
];

export function hasArea(template: Pick<MockupTemplate, 'print_area'>): boolean {
  return Array.isArray(template.print_area?.corners) && template.print_area.corners.length === 4;
}

export function cornersOf(template: Pick<MockupTemplate, 'print_area'>): NormQuad {
  return hasArea(template) ? (template.print_area.corners as NormQuad) : DEFAULT_AREA;
}

/** Normalised corners to pixel coordinates for the renderer. */
export function toPixelQuad(corners: NormQuad, width: number, height: number): Quad {
  return corners.map((p) => ({ x: p.x * width, y: p.y * height })) as Quad;
}

export async function listMockups(): Promise<MockupTemplate[]> {
  const { data, error } = await db()
    .from('mockup_templates')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Loading mockups failed: ${error.message}`);

  const rows = (data ?? []) as Omit<MockupTemplate, 'url'>[];
  return Promise.all(rows.map(async (row) => ({ ...row, url: await signedUrl(row.source_path) })));
}

export async function getMockup(id: string): Promise<MockupTemplate | null> {
  const { data } = await db().from('mockup_templates').select('*').eq('id', id).maybeSingle();
  if (!data) return null;
  const row = data as Omit<MockupTemplate, 'url'>;
  return { ...row, url: await signedUrl(row.source_path) };
}
