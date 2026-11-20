import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { BUCKET, db, signedUrl } from '@/lib/supabase';
import { assertWithinBudget } from '@/lib/budget';
import { estimateVideoCents, getModel, isAtlasConfigured, startVideoGeneration } from '@/lib/atlas';
import { loadSource } from '@/lib/video/source';
import { prepareFrame } from '@/lib/video/frame';

export const runtime = 'nodejs';
/** Cropping a 2000px render, storing it, then one call to Atlas to start the job. */
export const maxDuration = 60;

const schema = z.object({
  renderId: z.string().uuid(),
  model: z.string().trim().min(1),
  prompt: z.string().trim().max(4000).default(''),
  durationSeconds: z.number().int().min(1).max(60).default(5),
  frameMode: z.enum(['crop', 'pad', 'original']).default('crop'),
  offsetX: z.number().min(-1).max(1).default(0),
  offsetY: z.number().min(-1).max(1).default(0),
  params: z.record(z.string(), z.unknown()).default({}),
  shotId: z.string().uuid().nullable().default(null),
  /**
   * The estimate shown when the button was pressed.
   *
   * Sent back so the server can refuse if the price moved between the quote and the confirm.
   * Paying a different number from the one you agreed to is the thing this prevents.
   */
  quotedCents: z.number().int().min(0),
});

/**
 * Start one clip.
 *
 * Returns as soon as Atlas has the job. Video takes 30 seconds to 3 minutes, far longer than
 * a request should be held open, so the row carries the prediction id and the client polls
 * the companion route. Closing the laptop is harmless: the prediction is recorded and can be
 * collected later.
 */
export async function POST(request: Request) {
  if (!isAtlasConfigured()) {
    return NextResponse.json({ error: 'ATLAS_CLOUD_API_KEY is not set.' }, { status: 400 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Those video settings are not valid.' }, { status: 400 });
  }
  const input = parsed.data;

  const model = await getModel(input.model);
  if (!model) {
    return NextResponse.json({ error: `Unknown model "${input.model}".` }, { status: 400 });
  }

  const costCents = estimateVideoCents(model, input.durationSeconds);
  if (costCents !== input.quotedCents) {
    return NextResponse.json(
      {
        error: `The price moved: this now costs ${costCents} cents, not the ${input.quotedCents} you were quoted. Check the figure and try again.`,
      },
      { status: 409 },
    );
  }

  try {
    await assertWithinBudget(costCents);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 402 });
  }

  try {
    const source = await loadSource(input.renderId);

    // Full height for the real thing, not the preview's 720.
    const frame = await prepareFrame(source.image, {
      mode: input.frameMode,
      focus: source.focus,
      offsetX: input.offsetX,
      offsetY: input.offsetY,
      height: 1920,
    });

    const videoId = randomUUID();
    const framePath = `videos/${videoId}/frame.jpg`;
    const upload = await db()
      .storage.from(BUCKET)
      .upload(framePath, frame.jpeg, { contentType: 'image/jpeg', upsert: true });
    if (upload.error) throw new Error(`Storing the frame failed: ${upload.error.message}`);

    // Atlas fetches the frame itself from a signed URL, the same way Printify fetches print
    // art: no reason to push megabytes through a serverless function twice.
    const frameUrl = await signedUrl(framePath, 3600);
    if (!frameUrl) throw new Error('The frame could not be handed to Atlas.');

    const prediction = await startVideoGeneration(input.model, {
      ...input.params,
      image: frameUrl,
      ...(input.prompt ? { prompt: input.prompt } : {}),
      duration: input.durationSeconds,
    });

    const { error } = await db().from('videos').insert({
      id: videoId,
      design_id: source.designId,
      source_render_id: source.renderId,
      shot_template_id: input.shotId,
      model: input.model,
      prompt: input.prompt || null,
      params: input.params,
      source_path: framePath,
      frame_mode: frame.mode,
      duration_s: input.durationSeconds,
      cost_cents: costCents,
      prediction_id: prediction.id,
      status: 'running',
    });
    if (error) throw new Error(error.message);

    return NextResponse.json({ id: videoId, status: 'running', costCents });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
