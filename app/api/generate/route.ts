import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '@/lib/supabase';
import { assertWithinBudget } from '@/lib/budget';
import { estimateCents, getModel, isAtlasConfigured, startGeneration } from '@/lib/atlas';
import { normaliseLabel, PRIMARY_LABEL } from '@/lib/artworks';

export const runtime = 'nodejs';

/**
 * Rendering is heavier than an ordinary request, and image generation waits on Atlas.
 * Vercel clamps this to whatever the plan allows, so asking for more is safe.
 */
export const maxDuration = 60;


const schema = z.object({
  prompt: z.string().trim().min(3).max(32000),
  model: z.string().trim().min(1),
  count: z.number().int().min(1).max(10),
  params: z.record(z.string(), z.unknown()).default({}),
  collectionId: z.string().uuid().nullable().default(null),
  promptId: z.string().uuid().nullable().default(null),
  tags: z.array(z.string().trim().min(1).max(60)).max(40).default([]),
  /** Which placement this art is for. */
  label: z.string().trim().max(40).default(PRIMARY_LABEL),
  /** Generate onto an existing design — how a back print joins a design that has a front. */
  designId: z.string().uuid().nullable().default(null),
});

/**
 * Starts a generation and returns immediately.
 *
 * Generation takes roughly 20 seconds, which is longer than a serverless function should
 * be held open, so this only kicks it off. The client then polls the companion route,
 * which is also what makes a closed laptop harmless: the prediction is recorded in `jobs`
 * and can be collected later.
 */
export async function POST(request: Request) {
  if (!isAtlasConfigured()) {
    return NextResponse.json({ error: 'ATLAS_CLOUD_API_KEY is not set.' }, { status: 400 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Those generation settings are not valid.' }, { status: 400 });
  }
  const input = parsed.data;

  const model = await getModel(input.model);
  if (!model) {
    return NextResponse.json({ error: `Unknown model "${input.model}".` }, { status: 400 });
  }

  const costCents = estimateCents(model, input.count);
  try {
    await assertWithinBudget(costCents);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 402 });
  }

  const label = normaliseLabel(input.label);
  const createdDesign = !input.designId;
  let designId = input.designId ?? '';

  if (createdDesign) {
    designId = randomUUID();
    const { error: designError } = await db().from('designs').insert({
      id: designId,
      title: titleFrom(input.prompt),
      stage: 'generated',
      collection_id: input.collectionId,
      prompt_id: input.promptId,
      tags: input.tags,
      source_model: model.model,
      source_params: { ...input.params, prompt: input.prompt, n: input.count },
    });
    if (designError) {
      return NextResponse.json(
        { error: `Saving the design failed: ${designError.message}` },
        { status: 500 },
      );
    }
  } else {
    const { data: existing } = await db()
      .from('designs')
      .select('id')
      .eq('id', designId)
      .maybeSingle();
    if (!existing) return NextResponse.json({ error: 'No such design.' }, { status: 404 });
  }

  let predictionId: string;
  try {
    const prediction = await startGeneration(model.model, input.prompt, {
      ...input.params,
      n: input.count,
    });
    predictionId = prediction.id;
  } catch (error) {
    // Nothing was generated, so don't leave an empty card sitting on the board. An existing
    // design is left alone — it has art already.
    if (createdDesign) await db().from('designs').delete().eq('id', designId);
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }

  await db().from('jobs').insert({
    kind: 'atlas.generate',
    status: 'running',
    cost_cents: costCents,
    // The prompt and params are kept so a failed generation can be retried exactly, rather
    // than retyped from memory. They are the inputs, not the output, so they cost nothing
    // to store and are the only record of what was asked for.
    payload: {
      designId,
      predictionId,
      model: model.model,
      count: input.count,
      label,
      createdDesign,
      prompt: input.prompt,
      params: input.params,
      collectionId: input.collectionId,
      tags: input.tags,
    },
  });

  return NextResponse.json({ designId, predictionId, costCents });
}

/** A readable title from the prompt's opening words, without cutting one in half. */
function titleFrom(prompt: string): string {
  const words = prompt.replace(/\s+/g, ' ').trim().split(' ');
  let title = '';
  for (const word of words) {
    const next = (title + ' ' + word).trim();
    if (next.length > 60) break;
    title = next;
  }
  return title || 'Untitled';
}
