import { isConfigured } from '@/lib/supabase';
import { boardData, listCollections, listTags } from '@/lib/data';
import { STAGES, STAGE_META, TERMINAL_STAGES, type Stage } from '@/lib/stages';
import { DesignTile } from '@/components/DesignTile';
import { FilterBar } from '@/components/FilterBar';
import { UploadPanel } from '@/components/UploadPanel';
import type { DesignCard } from '@/lib/types';
import { SetupNotice } from '@/app/setup/SetupNotice';

/**
 * Always rendered per request. The board reflects live database state, so a build-time
 * snapshot would be both stale and impossible to produce without network access.
 */
export const dynamic = 'force-dynamic';

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ collection?: string; tag?: string; q?: string }>;
}) {
  if (!isConfigured) return <SetupNotice />;

  const params = await searchParams;
  const filter = {
    collectionId: params.collection || undefined,
    tag: params.tag || undefined,
    q: params.q || undefined,
  };

  const [board, collections, tags] = await Promise.all([
    boardData(filter),
    listCollections(),
    listTags(),
  ]);

  const total = Object.values(board).reduce((n, cards) => n + cards.length, 0);
  const showTerminal = TERMINAL_STAGES.some((s) => board[s].length > 0);
  const columns: Stage[] = [...STAGES, ...(showTerminal ? TERMINAL_STAGES : [])];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-end justify-between gap-4 px-5 py-4">
        <FilterBar collections={collections} tags={tags} active={filter} />
        <UploadPanel collections={collections} />
      </div>

      {total === 0 ? (
        <EmptyBoard filtered={Boolean(filter.collectionId || filter.tag || filter.q)} />
      ) : (
        <div className="board-scroll min-h-0 flex-1 overflow-x-auto px-5 pb-5">
          <div className="flex h-full gap-3">
            {columns.map((stage) => (
              <Column key={stage} stage={stage} cards={board[stage]} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Column({ stage, cards }: { stage: Stage; cards: DesignCard[] }) {
  const meta = STAGE_META[stage];
  return (
    <section className="flex w-64 shrink-0 flex-col rounded-lg bg-zinc-900/40">
      <header className="space-y-1 border-b border-zinc-800/80 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${meta.accent}`} aria-hidden />
          <h2 className="text-sm font-semibold text-zinc-200">{meta.label}</h2>
          <span className="ml-auto text-xs text-zinc-500">{cards.length}</span>
        </div>
        <p className="text-[11px] leading-snug text-zinc-500">
          {meta.hint}
          {meta.paid ? <span className="ml-1 text-amber-500/80">· costs credits</span> : null}
        </p>
      </header>
      <div className="board-scroll flex-1 space-y-2 overflow-y-auto p-2">
        {cards.length === 0 ? (
          <p className="px-1 py-3 text-center text-[11px] text-zinc-700">Nothing here</p>
        ) : (
          cards.map((design) => <DesignTile key={design.id} design={design} />)
        )}
      </div>
    </section>
  );
}

function EmptyBoard({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-1 items-center justify-center px-5 pb-16">
      <div className="max-w-sm space-y-2 text-center">
        <p className="text-sm font-medium text-zinc-300">
          {filtered ? 'Nothing matches those filters.' : 'No designs yet.'}
        </p>
        <p className="text-xs leading-relaxed text-zinc-500">
          {filtered
            ? 'Clear the filters to see the whole board.'
            : 'Add designs to get started. They land in Approved, and you move them rightward as each step is done.'}
        </p>
      </div>
    </div>
  );
}
