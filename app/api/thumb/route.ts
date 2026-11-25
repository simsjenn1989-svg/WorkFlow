import sharp from 'sharp';
import { BUCKET, db } from '@/lib/supabase';
import { thumbPath, THUMB_WIDTHS, type ThumbWidth } from '@/lib/thumb';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Only the app's own image folders. Keeps the route from being a general file reader. */
const ALLOWED = ['designs/', 'renders/', 'mockups/', 'references/', 'pins/', 'fonts/'];

/**
 * A thumbnail, made on first use.
 *
 * Lazy rather than backfilled on purpose. Backfilling 380 files means downloading all
 * 1.5 GB of them at once, which makes the egress problem worse before it makes it better.
 * This way each image is downloaded once, only if it is actually looked at, and never
 * again.
 *
 * The bytes are served by this route rather than redirecting to storage so the response
 * can be marked immutable: a thumbnail for a given path and width never changes, because
 * a changed image gets a new path.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const path = params.get('path');
  const width = Number(params.get('w') ?? 400) as ThumbWidth;

  if (!path || !ALLOWED.some((prefix) => path.startsWith(prefix)) || path.includes('..')) {
    return new Response('Not an image path.', { status: 400 });
  }
  if (!THUMB_WIDTHS.includes(width)) {
    return new Response(`Width must be one of ${THUMB_WIDTHS.join(', ')}.`, { status: 400 });
  }

  const small = thumbPath(path, width);
  const cached = await db().storage.from(BUCKET).download(small);
  if (!cached.error && cached.data) return serve(await cached.data.arrayBuffer());

  const original = await db().storage.from(BUCKET).download(path);
  if (original.error || !original.data) return new Response('No such image.', { status: 404 });

  let bytes: Buffer;
  try {
    bytes = await sharp(Buffer.from(await original.data.arrayBuffer()))
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    return new Response('That image could not be read.', { status: 502 });
  }

  // Stored for next time. A failure here is not worth failing the request over — the
  // thumbnail is already made and the next view simply makes it again.
  await db()
    .storage.from(BUCKET)
    .upload(small, bytes, { contentType: 'image/webp', upsert: true })
    .catch(() => undefined);

  return serve(bytes);
}

function serve(bytes: ArrayBuffer | Buffer): Response {
  return new Response(bytes as BodyInit, {
    headers: {
      'Content-Type': 'image/webp',
      // A thumbnail for a path and width never changes: a changed image is a new path.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
