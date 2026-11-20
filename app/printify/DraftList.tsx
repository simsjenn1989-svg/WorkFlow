import type { DraftCard } from '@/lib/printify/data';

/**
 * What is waiting in Printify.
 *
 * Skipped print areas are shown on the row rather than in a log, because a tee that went up
 * front-only when it was meant to be front-and-back is the single most expensive thing to
 * notice late.
 */
export function DraftList({ drafts }: { drafts: DraftCard[] }) {
  if (drafts.length === 0) return null;

  const failed = drafts.filter((d) => d.status === 'failed');
  const ready = drafts.filter((d) => d.status === 'draft');

  return (
    <div className="space-y-5">
      {failed.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-rose-300">
            Failed <span className="font-normal text-zinc-500">{failed.length}</span>
          </h2>
          <ul className="divide-y divide-zinc-900 rounded-lg border border-zinc-800 text-xs">
            {failed.map((draft) => (
              <li key={draft.id} className="flex flex-wrap items-baseline gap-2 px-3 py-2">
                <span className="text-zinc-300">{draft.design_title}</span>
                <span className="text-rose-400">{draft.error}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">
          Drafts in Printify <span className="font-normal text-zinc-500">{ready.length}</span>
        </h2>
        <ul className="divide-y divide-zinc-900 rounded-lg border border-zinc-800 text-xs">
          {ready.map((draft) => (
            <li key={draft.id} className="flex flex-wrap items-baseline gap-2 px-3 py-2">
              <span className="min-w-0 truncate text-zinc-200">{draft.design_title}</span>
              <span className="text-zinc-600">{draft.preset_name}</span>
              {draft.skipped.length > 0 ? (
                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">
                  no {draft.skipped.join(' or ')} print
                </span>
              ) : null}
              {draft.url ? (
                <a
                  href={draft.url}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto text-zinc-400 underline-offset-2 hover:text-zinc-100 hover:underline"
                >
                  open in Printify →
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
