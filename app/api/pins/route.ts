import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { BUCKET, db } from '@/lib/supabase';

export const runtime = 'nodejs';

const schema = z.object({
  path: z.string().min(1).max(300),
  renderId: z.string().uuid(),
  templateId: z.string().uuid().nullable().default(null),
  headline: z.string().max(400).default(''),
  subtitle: z.string().max(400).default(''),
  cta: z.string().max(80).default(''),
  footer: z.string().max(200).default(''),
  pinTitle: z.string().max(200).default(''),
  pinDescription: z.string().max(800).default(''),
  link: z.string().max(500).default(''),
  style: z.record(z.string(), z.unknown()).default({}),
  content: z.record(z.string(), z.unknown()).default({}),
});

/**
 * Record a pin whose image the browser already uploaded.
 *
 * The image is drawn on a canvas and sent straight to storage, so only this small JSON
 * reaches the server. The style and framing are stored alongside, which is what lets a pin
 * be reopened and changed rather than rebuilt from memory.
 */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  const input = parsed.data;

  const { data: render } = await db()
    .from('renders')
    .select('id,design_id')
    .eq('id', input.renderId)
    .maybeSingle();
  if (!render) {
    await db().storage.from(BUCKET).remove([input.path]);
    return NextResponse.json({ error: 'That render no longer exists.' }, { status: 404 });
  }

  const { error } = await db().from('pins').insert({
    design_id: (render as { design_id: string }).design_id,
    source_render_id: input.renderId,
    pin_template_id: input.templateId,
    headline: input.headline || null,
    subtitle: input.subtitle || null,
    cta: input.cta || null,
    footer: input.footer || null,
    title: input.pinTitle || null,
    description: input.pinDescription || null,
    link: input.link || null,
    output_path: input.path,
    style: input.style,
    content: input.content,
  });
  if (error) {
    await db().storage.from(BUCKET).remove([input.path]);
    return NextResponse.json({ error: `Saving failed: ${error.message}` }, { status: 500 });
  }

  revalidatePath('/pins');
  return NextResponse.json({ ok: true });
}
