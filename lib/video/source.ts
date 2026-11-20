import { BUCKET, db } from '@/lib/supabase';
import type { NormQuad } from '@/lib/mockups';

/** A render, with the photo bytes and where the design sits in it. */
export type VideoSource = {
  renderId: string;
  designId: string;
  designTitle: string;
  image: Buffer;
  /**
   * The print area's corners, so the crop can be centred on the graphic rather than on the
   * middle of the photo. On a lifestyle shot where the model stands off-centre that is the
   * difference between a video of the shirt and a video of a Christmas tree.
   */
  focus: NormQuad | null;
};

export async function loadSource(renderId: string): Promise<VideoSource> {
  const { data } = await db()
    .from('renders')
    .select('id,design_id,output_path,mockup_template_id,status,designs(title)')
    .eq('id', renderId)
    .maybeSingle();

  const render = data as
    | {
        id: string;
        design_id: string;
        output_path: string | null;
        mockup_template_id: string;
        status: string;
        designs: { title: string } | null;
      }
    | null;

  if (!render?.output_path || render.status !== 'done') {
    throw new Error('That render is not finished.');
  }

  const file = await db().storage.from(BUCKET).download(render.output_path);
  if (file.error || !file.data) throw new Error('That render could not be read.');

  const { data: mockupRow } = await db()
    .from('mockup_templates')
    .select('print_areas')
    .eq('id', render.mockup_template_id)
    .maybeSingle();

  const areas = (mockupRow as { print_areas?: { label: string; corners: NormQuad }[] } | null)
    ?.print_areas;

  // The front area when there is one, else whatever the first area is. A two-sided mockup
  // shows both shirts side by side, and framing on the front is the useful default.
  const area = areas?.find((a) => a.label === 'front') ?? areas?.[0] ?? null;

  return {
    renderId: render.id,
    designId: render.design_id,
    designTitle: render.designs?.title ?? 'Untitled',
    image: Buffer.from(await file.data.arrayBuffer()),
    focus: area?.corners ?? null,
  };
}
