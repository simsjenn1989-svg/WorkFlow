import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { BUCKET, db } from '@/lib/supabase';
import { chargedCents, downloadOutput, getPrediction, isAtlasConfigured } from '@/lib/atlas';
import { judgeFailure } from '@/lib/collect';
import { adoptVariant } from '@/lib/adopt';
import { normaliseDesign } from '@/lib/printify/canvas';
import { cutBackground, needsCutout } from '@/lib/cutout';

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
    revertToIdea?: boolean;
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
  // Older jobs predate `revertToIdea` and only recorded whether the design was created
  // here, which meant the same thing at the time.
  const revertToIdea = job.payload.revertToIdea ?? job.payload.createdDesign !== false;

  if (job.status === 'done') {
    return NextResponse.json({ status: 'completed', designId, variants: await variantsFor(designId) });
  }
  if (job.status === 'failed') {
    return NextResponse.json({ status: 'failed', designId, error: 'This generation failed.' });
  }

  // How long a generation may sit unfinished before it counts as lost.
  //
  // Images come back in seconds and the slowest measured was two minutes. Ten minutes of
  // "processing" means Atlas is not coming back, and leaving the card saying "generating"
  // for half a day is worse than saying so.
  const TIMEOUT_MS = 10 * 60 * 1000;
  const stale = Date.now() - new Date(job.created_at).getTime() > TIMEOUT_MS;

  let prediction;
  try {
    prediction = await getPrediction(predictionId);
  } catch (error) {
    const { permanent, message } = judgeFailure(error, job.created_at);
    if (!permanent) {
      return NextResponse.json({ status: 'processing', designId, note: message });
    }
    await failJob(job.id, designId, message, revertToIdea);
    return NextResponse.json({ status: 'failed', designId, error: message });
  }

  if (prediction.status === 'created' || prediction.status === 'processing') {
    if (!stale) return NextResponse.json({ status: prediction.status, designId });

    const message = `Atlas was still working after ${Math.round(TIMEOUT_MS / 60000)} minutes. Nothing was charged — try again.`;
    await failJob(job.id, designId, message, revertToIdea);
    return NextResponse.json({ status: 'failed', designId, error: message });
  }

  if (prediction.status === 'failed') {
    await db()
      .from('jobs')
      .update({ status: 'failed', error: prediction.error, finished_at: new Date().toISOString() })
      .eq('id', job.id);
    // A design created for this generation has no art, so it goes back to being an idea
    // rather than a dead card. One that already had art keeps its stage.
    if (revertToIdea) {
      await db().from('designs').update({ stage: 'idea' }).eq('id', designId);
    }
    return NextResponse.json({
      status: 'failed',
      designId,
      error: prediction.error || 'Atlas Cloud reported a failure.',
    });
  }

  // completed — copy every output into storage.
  //
  // Already-stored outputs are skipped, which matters now that a thrown collection is
  // retried rather than failed. Without this, a run that stored image one and threw on image
  // two stored image one AGAIN on the next attempt: two identical variants from one
  // generation, and the first attempt's file orphaned in the bucket. Measured — the recovered
  // raccoon generation produced two images and three variant rows, two of them the same
  // sha256.
  //
  // The output's position is recorded in `params.index` when it is stored, which is what
  // makes "have I already got this one?" answerable.
  const { data: stored } = await db()
    .from('design_variants')
    .select('params')
    .eq('design_id', designId);
  const have = new Set(
    ((stored ?? []) as { params: { index?: number } | null }[])
      .map((row) => row.params?.index)
      .filter((index): index is number => typeof index === 'number'),
  );

  for (const [index, url] of prediction.outputs.entries()) {
    if (have.has(index)) continue;
    try {
      const downloaded = await downloadOutput(url);
      const variantId = randomUUID();

      // Cut the background when the model could not leave one out.
      //
      // Only 8 of Atlas's 84 image-to-image models can output transparency, and the best of
      // them for this work is not among them — it draws the art on the solid magenta screen
      // the prompt asks for. Cutting here rather than at print time means the variant stored
      // is the same shape whichever model made it, so the board, the mockup renderer and the
      // print-ready step all behave identically.
      let bytes: Buffer | Uint8Array = downloaded.bytes;
      let contentType = downloaded.contentType;
      if (await needsCutout(Buffer.from(downloaded.bytes))) {
        try {
          const cut = await cutBackground(Buffer.from(downloaded.bytes));
          // A cutout that removes nearly everything has keyed the subject by mistake; the
          // original is better than a blank. Over 97% gone is not a plausible margin.
          if (cut.removed < 0.97) {
            bytes = cut.png;
            contentType = 'image/png';
          }
        } catch {
          // A failed cutout is not a failed generation; the image is still usable by hand.
        }
      }

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
      // Collecting a finished generation is not the same as the generation failing: Atlas
      // keeps the outputs, so polling again collects them. judgeFailure decides whether
      // this ends the work or just this attempt.
      const { permanent, message } = judgeFailure(error, job.created_at);

      if (!permanent) {
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
  //
  // "Whenever it is there" needed work. Atlas marks a prediction `completed` a moment before
  // it posts `price`, so collecting promptly read no price and fell back to the estimate —
  // measured on nano-banana-pro, recorded at its listed $0.14 against an actual $0.24. The
  // price is waited for briefly rather than guessed at.
  const actual = (await chargedCentsWhenPosted(predictionId, prediction)) ?? job.cost_cents;

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

  /*
    One image is not a choice.

    The `generated` stage exists so that several images can be compared and one kept. Ask
    for one and there is nothing to compare: the design still landed in Generated with
    "Artwork 0" and "no placements", and the placement chosen on the Generate screen looked
    like it had been discarded — when all that was missing was a click on the only option
    there was.

    So a generation that ASKED for one image adopts itself, onto the placement it was
    generated for. Asking for two or more always waits, even if only one comes back:
    wanting to choose and having nothing to choose from is a problem to notice, not to
    paper over by approving what arrived.

    This also matches what the Generate screen already promises when pointed at an existing
    design: "the result becomes this design's front artwork, replacing any it already has".
  */
  let adopted: string | null = null;
  // Asked for one, and got one. Asking for two and receiving one is not a decision made —
  // it is a decision missing, and adopting it silently is how a design ended up approved
  // seconds after it was generated.
  if (job.payload.count === 1 && prediction.outputs.length === 1) {
    const { data: only } = await db()
      .from('design_variants')
      .select('id')
      .eq('design_id', designId)
      .eq('label', job.payload.label ?? 'front')
      .limit(2);

    const rows = (only ?? []) as { id: string }[];
    // Only when this placement has exactly one variant. A second generation onto a design
    // that already has options for the same spot is back to being a choice.
    if (rows.length === 1 && rows[0]) {
      const result = await adoptVariant(designId, rows[0].id);
      if (!('error' in result)) {
        adopted = result.label;
        // Size it to the print area now, the same as picking by hand does. A failure here
        // leaves the artwork in place without a canvas, which the renderer and the push
        // both cope with.
        try {
          await normaliseDesign(designId);
        } catch {
          // Reported by the design page, where the artwork simply has no canvas yet.
        }
      }
    }
  }

  return NextResponse.json({
    status: 'completed',
    designId,
    adopted,
    variants: await variantsFor(designId),
  });
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

/**
 * Mark a generation lost.
 *
 * Nothing is written to the ledger here, which is the whole reason a retry cannot double
 * charge: cost is recorded when images are collected, so a job that never produced any has
 * never counted against the month.
 *
 * A design this generation created, or an idea it moved out of Idea, goes back to being an
 * idea rather than sitting in Generated as a card that will never fill. One that already
 * had art keeps its stage.
 */
async function failJob(
  jobId: string,
  designId: string,
  error: string,
  revertToIdea: boolean,
): Promise<void> {
  await db()
    .from('jobs')
    .update({ status: 'failed', error, finished_at: new Date().toISOString() })
    .eq('id', jobId);
  if (revertToIdea) {
    await db().from('designs').update({ stage: 'idea' }).eq('id', designId).eq('stage', 'generated');
  }
}

/**
 * The charged price, giving Atlas a moment to post it.
 *
 * A prediction turns `completed` before `charge_status` becomes `charged` and `price` is
 * filled in. Three quick re-reads cover the gap; past that the estimate is the honest
 * answer, and under-recording by a known amount beats blocking a collection.
 */
async function chargedCentsWhenPosted(
  predictionId: string,
  first: Awaited<ReturnType<typeof getPrediction>>,
): Promise<number | null> {
  const immediate = chargedCents(first);
  if (immediate !== null && immediate > 0) return immediate;

  for (let attempt = 0; attempt < 3; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    try {
      const again = chargedCents(await getPrediction(predictionId));
      if (again !== null && again > 0) return again;
    } catch {
      // The images are already collected; a price lookup failing must not fail the job.
      break;
    }
  }
  return null;
}
