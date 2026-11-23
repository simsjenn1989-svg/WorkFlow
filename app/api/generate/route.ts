import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, signedUrl } from '@/lib/supabase';
import { assertWithinBudget } from '@/lib/budget';
import {
  countField,
  estimateCents,
  getModel,
  getModelFields,
  isAtlasConfigured,
  referenceField,
  startGeneration,
  transparencyField,
} from '@/lib/atlas';
import { normaliseLabel, PRIMARY_LABEL } from '@/lib/artworks';
import { preparePrompt } from '@/lib/background';

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
  /**
   * A stored image to redraw, as a storage path.
   *
   * A path rather than a URL: the caller should not be able to point this at an arbitrary
   * host, and the signed URL handed to Atlas is minted here with a short life.
   */
  referencePath: z.string().trim().max(400).nullable().default(null),
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

  /*
    How many images this model will actually make.

    `n` used to be sent to everything. Most of the catalogue ignores it — Nano Banana 2.1
    has no count field at all — so asking for two produced one image, quoted for two, and
    left a design that looked like it had approved itself. The schema decides: send the
    model's own count field if it has one, and otherwise admit the run makes a single
    image rather than charging and hoping.
  */
  const fields = await getModelFields(model);
  const howMany = countField(fields);
  const count = howMany ? input.count : 1;

  /*
    Transparency comes from the model, not from the prompt.

    Where the model publishes a `background` option, it is set and the prompt is left
    exactly as written. Where it does not, no background instruction is added at all —
    only transparency phrasing is removed, because a model that cannot make alpha paints
    the editor's checkerboard when asked for it. Whatever background it does draw is cut
    afterwards by lib/cutout.ts.
  */
  const transparency = transparencyField(fields);
  const prompt = preparePrompt(input.prompt, transparency !== null);

  const costCents = estimateCents(model, count);
  try {
    await assertWithinBudget(costCents);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 402 });
  }

  const label = normaliseLabel(input.label);
  const createdDesign = !input.designId;
  let designId = input.designId ?? '';
  /** Set when this generation moved an existing idea into Generated, so failure can undo it. */
  let startedFromIdea = false;

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
      source_params: { ...input.params, prompt, count },
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
      .select('id,stage')
      .eq('id', designId)
      .maybeSingle();
    if (!existing) return NextResponse.json({ error: 'No such design.' }, { status: 404 });

    // An idea is a design with nothing in it yet, so generating onto one is the moment it
    // becomes real: it moves to Generated and starts carrying the provenance a generated
    // design has. Without this the images arrive and the card stays in the first column,
    // which is worse than not being able to point a generation at it at all.
    if ((existing as { stage: string }).stage === 'idea') {
      startedFromIdea = true;
      await db()
        .from('designs')
        .update({
          stage: 'generated',
          source_model: model.model,
          source_params: { ...input.params, prompt, count },
          prompt_id: input.promptId,
        })
        .eq('id', designId);
    }
  }

  let predictionId: string;
  try {
    // A reference turns this into an edit: the same endpoint, with the image alongside the
    // prompt. Atlas's edit models take `images` as an array of URLs, so the stored file is
    // handed over signed rather than uploaded again.
    let reference: Record<string, string[]> = {};
    if (input.referencePath) {
      const url = await signedUrl(input.referencePath, 3600);
      if (!url) {
        return NextResponse.json({ error: 'That reference image could not be read.' }, { status: 400 });
      }
      // The field name differs by model — `images`, `reference_images`,
      // `reference_image_urls` — and sending the wrong one is silently ignored rather than
      // rejected, so the model invents from the prompt alone and it reads as a bad redraw.
      const field = referenceField(await getModelFields(model));
      if (!field) {
        return NextResponse.json(
          { error: `${model.displayName} does not take a reference image.` },
          { status: 400 },
        );
      }
      reference = { [field]: [url] };
    }

    const prediction = await startGeneration(model.model, prompt, {
      ...input.params,
      ...reference,
      ...(howMany ? { [howMany]: count } : {}),
      // Last, so it wins over a stale `background` left in the saved parameters.
      ...(transparency ? { [transparency.name]: transparency.value } : {}),
    });
    predictionId = prediction.id;
  } catch (error) {
    // Nothing was generated, so don't leave an empty card sitting on the board. An existing
    // design is left alone — it has art already.
    if (createdDesign) await db().from('designs').delete().eq('id', designId);
    else if (startedFromIdea) await db().from('designs').update({ stage: 'idea' }).eq('id', designId);
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
      count,
      label,
      createdDesign,
      // Whether a failure should send the design back to Idea. True for a design this
      // generation created, and also for an idea it moved out of Idea — which
      // `createdDesign` alone cannot express, since the design was already there.
      revertToIdea: createdDesign || startedFromIdea,
      prompt,
      params: input.params,
      referencePath: input.referencePath,
      collectionId: input.collectionId,
      tags: input.tags,
    },
  });

  // `count` so the client can say so when the model made fewer than were asked for.
  return NextResponse.json({ designId, predictionId, costCents, count });
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
