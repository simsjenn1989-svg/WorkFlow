import Link from 'next/link';
import { isConfigured } from '@/lib/supabase';
import { boardData } from '@/lib/data';
import { listMockups } from '@/lib/mockups';
import { listRenders } from '@/lib/renders';
import { SetupNotice } from '@/app/setup/SetupNotice';
import { BatchRunner } from './BatchRunner';
import { FinishedRenders } from '@/components/FinishedRenders';

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

      <FinishedRenders renders={done} />

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
