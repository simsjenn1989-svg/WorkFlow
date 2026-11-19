import { db, signedUrl } from './supabase';
import type { Quad } from './render/homography';
import type { RenderOptions } from './render/options';

/** A corner as a fraction of the image, so a stored area survives any later resizing. */
export type NormPoint = { x: number; y: number };
export type NormQuad = [NormPoint, NormPoint, NormPoint, NormPoint];

/**
 * One place a design can go on this mockup.
 *
 * A photo showing front and back together has two, each taking its own artwork. The
 * measurements are per area rather than per template because the halves of such a photo are
 * lit differently.
 */
export type PrintArea = {
  id: string;
  label: string;
  corners: NormQuad;
  garmentHex?: string | null;
  baseLuma?: number | null;
};

export type MockupTemplate = {
  id: string;
  product_id: string | null;
  name: string;
  source_path: string;
  print_areas: PrintArea[];
  tags: string[];
  active: boolean;
  render_options: Partial<RenderOptions>;
  created_at: string;
  url: string | null;
};

/** Centred area covering a plausible chest print, used for a newly added one. */
export const DEFAULT_CORNERS: NormQuad = [
  { x: 0.36, y: 0.4 },
  { x: 0.64, y: 0.4 },
  { x: 0.64, y: 0.68 },
  { x: 0.36, y: 0.68 },
];

/** A second area starts offset, so it does not land exactly on top of the first. */
export function defaultCornersFor(index: number): NormQuad {
  const shift = index === 0 ? 0 : index % 2 === 1 ? -0.25 : 0.25;
  return DEFAULT_CORNERS.map((p) => ({
    x: Math.min(0.98, Math.max(0.02, p.x + shift)),
    y: p.y,
  })) as NormQuad;
}

export function isMarked(template: Pick<MockupTemplate, 'print_areas'>): boolean {
  return (template.print_areas ?? []).length > 0;
}

/** Normalised corners to pixel coordinates for the renderer. */
export function toPixelQuad(corners: NormQuad, width: number, height: number): Quad {
  return corners.map((p) => ({ x: p.x * width, y: p.y * height })) as Quad;
}

function normalise(row: Omit<MockupTemplate, 'url'>): Omit<MockupTemplate, 'url'> {
  return { ...row, print_areas: Array.isArray(row.print_areas) ? row.print_areas : [] };
}

export async function listMockups(): Promise<MockupTemplate[]> {
  const { data, error } = await db()
    .from('mockup_templates')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Loading mockups failed: ${error.message}`);

  const rows = (data ?? []) as Omit<MockupTemplate, 'url'>[];
  return Promise.all(
    rows.map(async (row) => ({ ...normalise(row), url: await signedUrl(row.source_path) })),
  );
}

export async function getMockup(id: string): Promise<MockupTemplate | null> {
  const { data } = await db().from('mockup_templates').select('*').eq('id', id).maybeSingle();
  if (!data) return null;
  const row = data as Omit<MockupTemplate, 'url'>;
  return { ...normalise(row), url: await signedUrl(row.source_path) };
}
