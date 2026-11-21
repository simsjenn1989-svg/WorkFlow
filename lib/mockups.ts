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

/**
 * A centred rectangle with the print area's own proportions.
 *
 * Corners are fractions of the IMAGE, so a square on screen is not a square in these
 * numbers — the photo's aspect has to be divided back out or the area comes out stretched.
 * That was the bug behind "why is there such a big margin": the default area was 0.28 by
 * 0.28, which on a 4:3 photo is a 4:3 rectangle, and a portrait canvas warped into it had
 * to shrink to fit, leaving empty space down both sides.
 *
 * `widthFraction` is how much of the photo's width the print covers. 0.3 is about right for
 * a chest print on a model shot and is only a starting point — the corners are dragged onto
 * the real garment afterwards.
 */
export function printAreaCorners(
  imageAspect: number,
  areaAspect: number,
  centre: NormPoint = { x: 0.5, y: 0.47 },
  widthFraction = 0.3,
): NormQuad {
  const halfWidth = widthFraction / 2;
  // height / width = (1 / areaAspect) in real lengths; converting to image fractions
  // multiplies by the image's own aspect.
  const halfHeight = (halfWidth / areaAspect) * imageAspect;
  return [
    { x: centre.x - halfWidth, y: centre.y - halfHeight },
    { x: centre.x + halfWidth, y: centre.y - halfHeight },
    { x: centre.x + halfWidth, y: centre.y + halfHeight },
    { x: centre.x - halfWidth, y: centre.y + halfHeight },
  ];
}

/**
 * Reshape an area to the print area's proportions, keeping where it is and how wide it is.
 *
 * Only sensible on a rectangle: once corners have been pulled into a perspective shape the
 * "aspect" of the quad is not one number, and forcing it would throw away the fit to the
 * garment. So this is a button rather than a constraint — mark the shape, snap it, then
 * fine-tune.
 */
export function snapToPrintAspect(
  corners: NormQuad,
  imageAspect: number,
  areaAspect: number,
): NormQuad {
  const centre = {
    x: (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4,
    y: (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4,
  };
  const width = (Math.abs(corners[1].x - corners[0].x) + Math.abs(corners[2].x - corners[3].x)) / 2;
  return printAreaCorners(imageAspect, areaAspect, centre, width);
}

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
