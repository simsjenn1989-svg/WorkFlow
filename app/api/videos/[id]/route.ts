import { NextResponse } from 'next/server';
import { BUCKET, db, signedUrl } from '@/lib/supabase';
import { getPrediction } from '@/lib/atlas';
import { judgeFailure, step } from '@/lib/collect';

export const runtime = 'nodejs';
/** Downloading a finished clip from Atlas and copying it into storage. */
export const maxDuration = 120;

/**
 * Collect one clip, if it is ready.
 *
 * The ledger is written here rather than when the job starts, so a generation that fails
 * does not count against the month. Atlas is not charged for a failed prediction and neither
 * is the budget.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const { data } = await db().from('videos').select('*').eq('id', id).maybeSingle();
  const video = data as
    | {
        id: string;
        design_id: string;
        model: string | null;
        prediction_id: string | null;
        status: string;
        output_path: string | null;
        cost_cents: number;
        created_at: string;
      }
    | null;

  if (!video) return NextResponse.json({ error: 'No such video.' }, { status: 404 });

  if (video.status === 'done' || video.status === 'failed') {
    return NextResponse.json({
      status: video.status,
      url: await signedUrl(video.output_path),
    });
  }
  if (!video.prediction_id) {
    return NextResponse.json({ status: video.status });
  }

  try {
    const prediction = await step('asking Atlas whether it is done', () =>
      getPrediction(video.prediction_id!),
    );

    if (prediction.status === 'failed') {
      await db()
        .from('videos')
        .update({
          status: 'failed',
          error: prediction.error || 'Atlas did not say why.',
          finished_at: new Date().toISOString(),
        })
        .eq('id', video.id);
      return NextResponse.json({ status: 'failed', error: prediction.error });
    }

    if (prediction.status !== 'completed') {
      return NextResponse.json({ status: 'running' });
    }

    const output = prediction.outputs?.[0];
    if (!output) throw new Error('Atlas finished but returned no video.');

    // Named steps, because the first version of this reported a bare "fetch failed" and
    // there are three different fetches in here. Knowing which one broke is the whole
    // difference between a one-line fix and guessing.
    const response = await step('downloading the clip from Atlas', () =>
      fetch(output, { cache: 'no-store' }),
    );
    if (!response.ok) throw new Error(`Fetching the clip returned ${response.status}.`);
    const bytes = new Uint8Array(await response.arrayBuffer());

    // Atlas serves finished media from its own host and does not promise to keep it, so the
    // clip is copied into storage the same way generated images are.
    const path = `videos/${video.id}/clip.mp4`;
    const upload = await step('storing the clip', () =>
      db().storage.from(BUCKET).upload(path, bytes, { contentType: 'video/mp4', upsert: true }),
    );
    if (upload.error) throw new Error(upload.error.message);

    await db()
      .from('videos')
      // `error` is cleared deliberately. A clip that needed a second poll carries the note
      // from the first one, and a finished video listed with an error beside it reads as
      // broken when it is not.
      .update({
        status: 'done',
        output_path: path,
        error: null,
        finished_at: new Date().toISOString(),
      })
      .eq('id', video.id);

    await db().from('cost_ledger').insert({
      design_id: video.design_id,
      provider: 'atlascloud',
      model: video.model,
      amount_cents: video.cost_cents,
    });

    return NextResponse.json({ status: 'done', url: await signedUrl(path) });
  } catch (error) {
    // A poll that throws is usually the network, not the clip: Atlas may well have the
    // video already. judgeFailure decides whether this ends the work or just this attempt.
    const { permanent, message } = judgeFailure(error, video.created_at);

    if (!permanent) {
      await db().from('videos').update({ error: message }).eq('id', video.id);
      return NextResponse.json({ status: 'running', warning: message });
    }

    await db()
      .from('videos')
      .update({ status: 'failed', error: message, finished_at: new Date().toISOString() })
      .eq('id', video.id);
    return NextResponse.json({ status: 'failed', error: message });
  }
}
