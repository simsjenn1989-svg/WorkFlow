import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isPrintifyConfigured } from '@/lib/printify/client';
import { deleteStyle, deriveStyle, sampleShop, saveStyle } from '@/lib/listings/style';

export const runtime = 'nodejs';
/** One Printify call returning up to 20 full product records. */
export const maxDuration = 60;

/**
 * Work out the house style by reading the shop's own listings.
 *
 * Returns the evidence alongside the style — how many listings agreed on the title suffix,
 * which blocks were found in how many — because a style derived from a sample is a claim,
 * and a claim should show its working rather than appear as settled fact.
 */
export async function GET(request: Request) {
  if (!isPrintifyConfigured()) {
    return NextResponse.json({ error: 'PRINTIFY_API_TOKEN is not set.' }, { status: 400 });
  }

  const url = new URL(request.url);
  const shopId = url.searchParams.get('shopId');
  if (!shopId) return NextResponse.json({ error: 'Pick a shop first.' }, { status: 400 });

  try {
    const samples = await sampleShop(shopId, 20);
    if (samples.length === 0) {
      return NextResponse.json(
        { error: 'That shop has no listings to learn from yet.' },
        { status: 404 },
      );
    }
    const derived = deriveStyle(samples, {
      name: url.searchParams.get('name') || `Shop ${shopId}`,
      shopId,
    });
    return NextResponse.json(derived);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}

const line = z.object({
  text: z.string().min(1).max(400),
  requires: z.literal('both-sides').optional(),
});

const schema = z.object({
  id: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(120),
  shop_id: z.string().min(1).nullable(),
  title_suffix: z.string().max(140),
  title_chunks: z.number().int().min(1).max(8),
  tail_tags: z.array(z.string().min(1).max(60)).max(20),
  tag_count: z.number().int().min(1).max(30),
  tag_char_limit: z.number().int().min(5).max(100),
  title_char_limit: z.number().int().min(20).max(500),
  blocks: z
    .array(z.object({ heading: z.string().max(140), bulleted: z.boolean(), lines: z.array(line) }))
    .max(12),
  voice_note: z.string().max(2000).nullable(),
  learn_from_shop: z.boolean(),
  is_default: z.boolean(),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Bad request.' },
      { status: 400 },
    );
  }

  const { id, ...style } = parsed.data;
  const saved = await saveStyle(id ?? null, style);
  if (saved.error) return NextResponse.json({ error: saved.error }, { status: 500 });
  return NextResponse.json({ id: saved.id });
}

export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => null)) as { id?: string } | null;
  if (!body?.id) return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  const { error } = await deleteStyle(body.id);
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ ok: true });
}
