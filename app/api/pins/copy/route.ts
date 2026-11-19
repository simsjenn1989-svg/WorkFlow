import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/supabase';
import { CopyError, generateCopy } from '@/lib/copy/generate';
import { DESTINATIONS, type Destination } from '@/lib/copy/prompt';

export const runtime = 'nodejs';

/** A language model reply, not image work; still longer than the default allows. */
export const maxDuration = 60;

const schema = z.object({
  model: z.string().trim().min(1).max(120),
  renderId: z.string().uuid().nullable().default(null),
  destination: z.string().trim().default('etsy-listing'),
  tone: z.string().trim().max(80).default('friendly and warm'),
  /** Anything the seller wants to add on top of what the design already says. */
  note: z.string().trim().max(2000).default(''),
  instructions: z.string().trim().max(4000).default(''),
});

/**
 * Write the overlay text for a pin.
 *
 * The product description is assembled from what the app already knows — the design's
 * title, its prompt, its tags and the mockup it was rendered on — rather than asking a
 * model to identify a product from a downscaled photograph, which is what the original
 * tool had to do.
 */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  const input = parsed.data;

  const destination = (
    input.destination in DESTINATIONS ? input.destination : 'etsy-listing'
  ) as Destination;

  const facts: string[] = [];
  if (input.renderId) {
    const { data } = await db()
      .from('renders')
      .select('designs(title,tags,source_params)')
      .eq('id', input.renderId)
      .maybeSingle();

    const row = data as {
      designs: { title: string; tags: string[]; source_params: unknown } | null;
    } | null;

    if (row?.designs) {
      facts.push(`Design: ${row.designs.title}`);
      if (row.designs.tags?.length) facts.push(`Tags: ${row.designs.tags.join(', ')}`);
      const params = row.designs.source_params as { prompt?: string } | null;
      if (params?.prompt) facts.push(`The artwork was made from this prompt: ${params.prompt}`);
    }
    // The mockup's own tags are deliberately not included. They describe the photograph —
    // its scene, its props, the season it was shot in — not the product. Passing them made
    // the copy advertise a "Christmas tee" because the shirt happened to be photographed
    // beside a tree.
  }
  if (input.note) facts.push(input.note);

  // The product this app sells, so copy never has to guess the garment.
  facts.unshift('A Comfort Colors 1717 oversized heavyweight tee in black.');

  const { data: starred } = await db()
    .from('style_examples')
    .select('text')
    .eq('kind', 'headline')
    .order('created_at', { ascending: true })
    .limit(15);

  try {
    const result = await generateCopy(input.model, {
      destination,
      tone: input.tone,
      product: facts.join('\n'),
      instructions: input.instructions,
      examples: ((starred ?? []) as { text: string }[]).map((s) => s.text),
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof CopyError ? error.message : (error as Error).message;
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
