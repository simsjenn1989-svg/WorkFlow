import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { BUCKET, db } from '@/lib/supabase';
import { chargedCents, downloadOutput, getPrediction, isAtlasConfigured } from '@/lib/atlas';

export const runtime = 'nodejs';

/**
 * Rendering is heavier than an ordinary request, and image generation waits on Atlas.
 * Vercel clamps this to whatever the plan allows, so asking for more is safe.
 */
export const maxDuration = 60;


type JobRow = {
  id: string;
  status: string;
  cost_cents: number;
  created_at: string;
  payload: {
    designId: string;
    predictionId: string;
    model: string;
    count: number;
    label?: string;
    createdDesign?: boolean;
  };
};

/**
 * Polls one generation and, once Atlas is finished, copies the images into storage.
 *
 * Collecting is idempotent: a job already marked done returns its stored variants without
 * touching Atlas, so a client that polls twice, or a page reloaded mid-generation, cannot
 * produce duplicates or double-charge the ledger.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAtlasConfigured()) {
    return NextResponse.json({ error: 'ATLAS_CLOUD_API_KEY is not set.' }, { status: 400 });
  }

  const { id: predictionId } = await context.params;

  const { data: jobs } = await db()
    .from('jobs')
    .select('id,status,cost_cents,created_at,payload')
    .eq('kind', 'atlas.generate')
    .filter('payload->>predictionId', 'eq', predictionId)
    .limit(1);

  const job = (jobs ?? [])[0] as JobRow | undefined;
  if (!job) return NextResponse.json({ error: 'No such generation.' }, { status: 404 });

  const { designId } = job.payload;

  if (job.status === 'done') {
    return NextResponse.json({ status: 'completed', designId, variants: await variantsFor(designId) });
  }
  if (job.status === 'failed') {
    return NextResponse.json({ status: 'failed', designId, error: 'This generation failed.' });
  }

  let prediction;
  try {
    prediction = await getPrediction(predictionId);
  } catch (error) {
    return NextResponse.json({ status: 'processing', designId, note: (error as Error).message });
  }

  if (prediction.status === 'created' || prediction.status === 'processing') {
    return NextResponse.json({ status: prediction.status, designId });
  }

  if (prediction.status === 'failed') {
    await db()
      .from('jobs')
      .update({ status: 'failed', error: prediction.error, finished_at: new Date().toISOString() })
      .eq('id', job.id);
    // A design created for this generation has no art, so it goes back to being an idea
    // rather than a dead card. One that already had art keeps its stage.
    if (job.payload.createdDesign !== false) {
      await db().from('designs').update({ stage: 'idea' }).eq('id', designId);
    }
    return NextResponse.json({
      status: 'failed',
      designId,
      error: prediction.error || 'Atlas Cloud reported a failure.',
    });
  }

  // completed — copy every output into storage.
  for (const [index, url] of prediction.outputs.entries()) {
    try {
      const { bytes, contentType } = await downloadOutput(url);
      const variantId = randomUUID();
      const extension = contentType.includes('webp') ? 'webp' : contentType.includes('jpeg') ? 'jpg' : 'png';
      const path = `designs/${designId}/variants/${variantId}.${extension}`;

      const { error: uploadError } = await db()
        .storage.from(BUCKET)
        .upload(path, bytes, { contentType, upsert: true });
      if (uploadError) throw new Error(uploadError.message);

      await db().from('design_variants').insert({
        id: variantId,
        design_id: designId,
        label: job.payload.label ?? 'front',
        image_path: path,
        model: job.payload.model,
        params: { index },
        cost_cents: Math.round(job.cost_cents / Math.max(1, prediction.outputs.length)),
      });
    } catch (error) {
      // Collecting a finished generation is not the same as the generation failing.
      //
      // This happened for real: Atlas completed two images and charged for them, one
      // download came back 520, and the job was marked failed — losing work that existed
      // and had been paid for. Atlas keeps the outputs, so polling again collects them.
      //
      // The job therefore stays running and the client retries, until GIVE_UP_MS says
      // something is genuinely wrong rather than merely flaky.
      const message = (error as Error).message;
      const age = Date.now() - new Date(job.created_at).getTime();

      if (age < GIVE_UP_MS) {
        await db().from('jobs').update({ error: message }).eq('id', job.id);
        return NextResponse.json({ status: 'processing', designId, note: message });
      }

      await db()
        .from('jobs')
        .update({ status: 'failed', error: message, finished_at: new Date().toISOString() })
        .eq('id', job.id);
      return NextResponse.json({ status: 'failed', designId, error: message });
    }
  }

  // What Atlas actually charged, not what was estimated before it ran.
  //
  // The estimate is the listed base price times the image count, and size and quality tier
  // multiply it by a factor the catalogue does not publish: two 2160x3840 images at quality
  // `high` were quoted at $0.014 and charged $0.16168. Recording the estimate meant the
  // monthly total was eleven times under, which makes the ceiling meaningless. The real
  // figure arrives on the finished prediction, so it is used whenever it is there.
  const actual = chargedCents(prediction) ?? job.cost_cents;

  await db().from('cost_ledger').insert({
    design_id: designId,
    job_id: job.id,
    provider: 'atlascloud',
    model: job.payload.model,
    amount_cents: actual,
  });
  await db()
    .from('jobs')
    .update({
      status: 'done',
      cost_cents: actual,
      error: null,
      finished_at: new Date().toISOString(),
    })
    .eq('id', job.id);

  return NextResponse.json({ status: 'completed', designId, variants: await variantsFor(designId) });
}

async function variantsFor(designId: string) {
  const { data } = await db()
    .from('design_variants')
    .select('id,image_path,chosen,label')
    .eq('design_id', designId)
    .order('created_at', { ascending: true });

  const rows = (data ?? []) as { id: string; image_path: string; chosen: boolean; label: string }[];
  return Promise.all(
    rows.map(async (row) => {
      const { data: signed } = await db()
        .storage.from(BUCKET)
        .createSignedUrl(row.image_path, 3600);
      return { id: row.id, chosen: row.chosen, label: row.label, url: signed?.signedUrl ?? null };
    }),
  );
}

/** Atlas finishes images in seconds; well past that, a stuck collection is a real failure. */
const GIVE_UP_MS = 15 * 60 * 1000;
