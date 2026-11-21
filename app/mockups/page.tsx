import Link from 'next/link';
import { isConfigured } from '@/lib/supabase';
import { isMarked, listMockups } from '@/lib/mockups';
import { SetupNotice } from '@/app/setup/SetupNotice';
import { MockupUpload } from './MockupUpload';
import { FitAllAreas } from '@/components/FitAllAreas';

export const dynamic = 'force-dynamic';

export default async function MockupsPage() {
  if (!isConfigured) return <SetupNotice />;
  const templates = await listMockups();
  const unmarked = templates.filter((t) => !isMarked(t)).length;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-5 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold">Mockups</h1>
          <p className="text-xs leading-relaxed text-zinc-500">
            Blank garment photos. Mark the print area once per photo and every design after
            that reuses it.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FitAllAreas ids={templates.filter(isMarked).map((t) => t.id)} />
          <MockupUpload />
        </div>
      </div>

      {unmarked > 0 ? (
        <p className="rounded-md border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
          {unmarked} mockup{unmarked === 1 ? ' has' : 's have'} no print area yet. Open{' '}
          {unmarked === 1 ? 'it' : 'them'} to mark where the design should sit.
        </p>
      ) : null}

      {templates.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-zinc-400">No mockups yet.</p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-zinc-600">
            Upload photos of the blank garment — a flat lay, a hanging shot, someone wearing
            it. Each becomes a reusable template.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {templates.map((template) => (
            <Link
              key={template.id}
              href={`/mockups/${template.id}`}
              className="group overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 transition hover:border-zinc-600"
            >
              <div className="relative aspect-[4/3] bg-zinc-950">
                {template.url ? (
                  /* Signed, expiring URLs — next/image would cache them past their lifetime. */
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={template.url}
                    alt={template.name}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : null}
                {!isMarked(template) ? (
                  <span className="absolute left-1.5 top-1.5 rounded bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-medium text-amber-950">
                    Not marked
                  </span>
                ) : null}
              </div>
              <div className="space-y-1 p-2.5">
                <p className="truncate text-sm font-medium text-zinc-100">{template.name}</p>
                <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-500">
                  <span>
                    {isMarked(template)
                      ? `${template.print_areas.length} area${template.print_areas.length === 1 ? '' : 's'}`
                      : 'Needs marking'}
                  </span>
                  <span className="flex items-center gap-1">
                    {template.print_areas
                      .filter((a) => a.garmentHex)
                      .map((a) => (
                        <span
                          key={a.id}
                          title={`${a.label} ${a.garmentHex}`}
                          className="inline-block h-2.5 w-2.5 rounded-sm border border-zinc-700"
                          style={{ background: a.garmentHex ?? undefined }}
                        />
                      ))}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
