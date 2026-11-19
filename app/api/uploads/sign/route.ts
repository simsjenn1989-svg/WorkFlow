import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { BUCKET, db } from '@/lib/supabase';

export const runtime = 'nodejs';

const schema = z.object({
  kind: z.enum(['design', 'mockup', 'pin']),
  ext: z.string().trim().regex(/^[a-z0-9]{1,5}$/i),
});

/**
 * Hand the browser a one-shot URL to upload a file straight into storage.
 *
 * File bytes never pass through the server. Server Actions cap a request body at 1 MB and
 * Vercel caps a function request at about 4.5 MB, so routing photographs through either
 * fails as soon as the files are real ones. This also keeps the service-role key server-side:
 * the signed URL authorises exactly one object and nothing else.
 */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Bad upload request.' }, { status: 400 });

  const id = randomUUID();
  const ext = parsed.data.ext.toLowerCase();
  const path =
    parsed.data.kind === 'design'
      ? `designs/${id}/raw.${ext}`
      : parsed.data.kind === 'mockup'
        ? `mockups/${id}/source.${ext}`
        : `pins/${id}.${ext}`;

  const { data, error } = await db().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    return NextResponse.json(
      { error: `Could not start the upload: ${error?.message ?? 'unknown error'}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ id, path, signedUrl: data.signedUrl, token: data.token });
}
