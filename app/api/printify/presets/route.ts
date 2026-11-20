import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isPrintifyConfigured } from '@/lib/printify/client';
import { deletePreset, savePreset, suggestPreset } from '@/lib/printify/presets';

export const runtime = 'nodejs';
/** Two catalogue calls to Printify, one of which returns several hundred variants. */
export const maxDuration = 60;

/**
 * Suggest a preset from Printify's live catalogue.
 *
 * Read rather than hardcoded: the variant ids, the sizes on offer and the print area sizes
 * all come from Printify, so a blueprint change shows up as different numbers in the editor
 * instead of a product that silently fails to create.
 */
export async function GET(request: Request) {
  if (!isPrintifyConfigured()) {
    return NextResponse.json({ error: 'PRINTIFY_API_TOKEN is not set.' }, { status: 400 });
  }

  const url = new URL(request.url);
  const number = (name: string) => {
    const raw = url.searchParams.get(name);
    return raw ? Number(raw) : undefined;
  };

  try {
    const suggestion = await suggestPreset({
      blueprintId: number('blueprintId'),
      printProviderId: number('printProviderId'),
      colour: url.searchParams.get('colour') ?? undefined,
      shopId: url.searchParams.get('shopId') ?? undefined,
    });
    return NextResponse.json(suggestion);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}

const placement = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  scale: z.number().min(0.05).max(3),
  angle: z.number().min(-180).max(180),
});

const schema = z.object({
  id: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(120),
  shopId: z.string().min(1),
  shopTitle: z.string().nullable().optional(),
  blueprintId: z.number().int().positive(),
  printProviderId: z.number().int().positive(),
  colour: z.string().min(1).max(60),
  variants: z
    .array(
      z.object({
        variantId: z.number().int().positive(),
        size: z.string().min(1).max(20),
        // A price below Printify's own cost is rejected by Printify anyway; this only stops
        // an obvious slip like a price in dollars reaching a field that wants cents.
        priceCents: z.number().int().min(100).max(100000),
      }),
    )
    .min(1),
  placements: z.record(z.string().min(1).max(40), placement),
  printWidthPx: z.number().int().positive().nullable().optional(),
  printHeightPx: z.number().int().positive().nullable().optional(),
  isDefault: z.boolean().optional(),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Bad request.' },
      { status: 400 },
    );
  }

  const { id, ...input } = parsed.data;
  const saved = await savePreset(id ?? null, input);
  if (saved.error) return NextResponse.json({ error: saved.error }, { status: 500 });
  return NextResponse.json({ id: saved.id });
}

export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => null)) as { id?: string } | null;
  if (!body?.id) return NextResponse.json({ error: 'Bad request.' }, { status: 400 });

  const { error } = await deletePreset(body.id);
  if (error) {
    // Deleting a preset that drafts were pushed with is blocked by a foreign key, so say so
    // in words rather than passing on a constraint name.
    return NextResponse.json(
      { error: `That preset cannot be deleted — drafts were pushed with it. ${error}` },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true });
}
