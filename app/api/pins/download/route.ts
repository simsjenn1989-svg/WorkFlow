import { BUCKET, db } from '@/lib/supabase';
import { pinFileName } from '@/lib/pins/csv';
import { zipStream, type ZipEntry } from '@/lib/zip';

export const runtime = 'nodejs';
export const maxDuration = 300;

type Row = {
  id: string;
  output_path: string | null;
  title: string | null;
  headline: string | null;
  designs: { title: string } | null;
};

/**
 * Every saved pin in one zip.
 *
 * Names come from `pinFileName`, the same function the CSV export uses for its first
 * column — the whole point of that file is to be read beside these images, so a name that
 * did not match would make the pairing useless.
 *
 * A GET with the ids in the query, not a POST, so the button is a plain link and the
 * browser's own download handles it.
 */
export async function GET(request: Request) {
  const wanted = new URL(request.url).searchParams.get('ids');
  const ids = wanted ? wanted.split(',').filter(Boolean) : null;

  let query = db()
    .from('pins')
    .select('id,output_path,title,headline,designs(title)')
    .order('created_at', { ascending: false });
  if (ids && ids.length > 0) query = query.in('id', ids);

  const { data, error } = await query;
  if (error) return new Response(`Listing the pins failed: ${error.message}`, { status: 500 });

  const rows = ((data ?? []) as unknown as Row[]).filter((r) => r.output_path);
  if (rows.length === 0) return new Response('No pins to download.', { status: 404 });

  const used = new Map<string, number>();
  async function* entries(): AsyncGenerator<ZipEntry> {
    for (const row of rows) {
      const base = pinFileName({
        title: row.title,
        headline: row.headline,
        design_title: row.designs?.title ?? 'pin',
        output_path: row.output_path,
      });
      const seen = used.get(base) ?? 0;
      used.set(base, seen + 1);
      const name = seen === 0 ? base : base.replace(/(\.\w+)$/, `-${seen + 1}$1`);

      const file = await db().storage.from(BUCKET).download(row.output_path!);
      if (file.error || !file.data) {
        // Named in the zip rather than skipped in silence; see the renders download route.
        yield {
          name: `MISSING-${name}.txt`,
          bytes: new TextEncoder().encode(
            `This pin could not be read from storage:\n  ${row.output_path}\n`,
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
      'Content-Disposition': `attachment; filename="workflow-pins-${stamp}.zip"`,
      'Cache-Control': 'no-store',
    },
  });
}
