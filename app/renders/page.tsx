import Link from 'next/link';
import { isConfigured } from '@/lib/supabase';
import { boardData } from '@/lib/data';
import { listMockups } from '@/lib/mockups';
import { listRenders } from '@/lib/renders';
import { SetupNotice } from '@/app/setup/SetupNotice';
import { BatchRunner } from './BatchRunner';

export const dynamic = 'force-dynamic';

export default async function RendersPage() {
  if (!isConfigured) return <SetupNotice />;

  const [board, mockups, renders] = await Promise.all([
    boardData(),
    listMockups(),
    listRenders(),
  ]);

  const designs = Object.values(board)
    .flat()
    .filter((d) => d.artwork_labels.length > 0)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  const failed = renders.filter((r) => r.status === 'failed');
  const done = renders.filter((r) => r.status === 'done');

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-5 py-6">
      <div>
        <h1 className="text-base font-semibold">Renders</h1>
        <p className="text-xs leading-relaxed text-zinc-500">
          Run designs across mockups. Each area takes the artwork whose placement matches it,
          and a pair with missing artwork is skipped rather than part-rendered.
        </p>
      </div>

      <BatchRunner designs={designs} mockups={mockups} />

      {failed.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-rose-300">
            Failed <span className="font-normal text-zinc-500">{failed.length}</span>
          </h2>
          <ul className="divide-y divide-zinc-900 rounded-lg border border-zinc-800 text-xs">
            {failed.map((render) => (
              <li key={render.id} className="flex flex-wrap items-baseline gap-2 px-3 py-2">
                <span className="text-zinc-300">
                  {render.design_title} × {render.mockup_name}
                </span>
                <span className="text-rose-400">{render.error}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">
          Finished <span className="font-normal text-zinc-500">{done.length}</span>
        </h2>

        {done.length === 0 ? (
          <p className="py-10 text-center text-sm text-zinc-500">
            Nothing rendered yet. Pick designs and mockups above.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {done.map((render) => (
              <a
                key={render.id}
                href={render.url ?? '#'}
                download={`${render.design_title}-${render.mockup_name}.jpg`}
                className="group overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 transition hover:border-zinc-600"
              >
                <div className="relative aspect-[4/3] bg-zinc-950">
                  {render.url ? (
                    /* Signed, expiring URLs — next/image would cache them past their lifetime. */
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={render.url}
                      alt={`${render.design_title} on ${render.mockup_name}`}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : null}
                </div>
                <div className="space-y-0.5 p-2.5">
                  <p className="truncate text-sm font-medium text-zinc-100">{render.design_title}</p>
                  <p className="truncate text-[11px] text-zinc-500">
                    {render.mockup_name} · click to download
                  </p>
                </div>
              </a>
            ))}
          </div>
        )}
      </section>

      <p className="text-[11px] text-zinc-600">
        Designs with a finished render move to{' '}
        <Link href="/" className="underline hover:text-zinc-400">
          Mockups done
        </Link>{' '}
        on the board.
      </p>
    </div>
  );
}
