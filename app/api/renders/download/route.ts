import { BUCKET, db } from '@/lib/supabase';
import { safeName, zipStream, type ZipEntry } from '@/lib/zip';

export const runtime = 'nodejs';

/** Fifteen full-resolution renders is tens of megabytes to fetch and re-emit. */
export const maxDuration = 300;

type Row = {
  id: string;
  output_path: string | null;
  designs: { title: string } | null;
  mockup_templates: { name: string } | null;
};

/**
 * Every finished render in one zip.
 *
 * A GET with the ids in the query, not a POST, so the button can be a plain link and the
 * browser's own download handles it — no blob held in a tab, and a 70 MB file does not
 * have to exist in memory anywhere.
 *
 * Stored, not deflated: these are JPEGs. See lib/zip.ts.
 */
export async function GET(request: Request) {
  const wanted = new URL(request.url).searchParams.get('ids');
  const ids = wanted ? wanted.split(',').filter(Boolean) : null;

  let query = db()
    .from('renders')
    .select('id,output_path,designs(title),mockup_templates(name)')
    .eq('status', 'done')
    .order('created_at', { ascending: true });
  if (ids && ids.length > 0) query = query.in('id', ids);

  const { data, error } = await query;
  if (error) return new Response(`Listing the renders failed: ${error.message}`, { status: 500 });

  const rows = ((data ?? []) as unknown as Row[]).filter((r) => r.output_path);
  if (rows.length === 0) return new Response('No finished renders to download.', { status: 404 });

  // Two renders of the same design on the same mockup would collide; the counter only
  // appears when it has to, so ordinary names stay clean.
  const used = new Map<string, number>();
  async function* entries(): AsyncGenerator<ZipEntry> {
    for (const row of rows) {
      const base = safeName([row.designs?.title ?? 'design', row.mockup_templates?.name ?? 'mockup'], 'jpg');
      const seen = used.get(base) ?? 0;
      used.set(base, seen + 1);
      const name = seen === 0 ? base : base.replace(/\.jpg$/, `-${seen + 1}.jpg`);

      const file = await db().storage.from(BUCKET).download(row.output_path!);
      if (file.error || !file.data) {
        // Say so inside the zip. Skipping in silence hands back twelve files when
        // thirteen were asked for, and nothing on screen says which one went missing.
        yield {
          name: `MISSING-${name}.txt`,
          bytes: new TextEncoder().encode(
            `This render could not be read from storage:\n  ${row.output_path}\n\nRe-run it from the Renders screen.\n`,
          ),
        };
        continue;
      }

      yield { name, bytes: new Uint8Array(await file.data.arrayBuffer()) };
    }
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(zipStream(entries()), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="workflow-renders-${stamp}.zip"`,
      'Cache-Control': 'no-store',
    },
  });
}
