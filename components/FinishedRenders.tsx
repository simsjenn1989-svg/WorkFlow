'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteRenders } from '@/app/renders/actions';
import { asDownload, downloadName } from '@/lib/download';

export type FinishedRender = {
  id: string;
  design_title: string;
  mockup_name: string;
  url: string | null;
};

/**
 * The finished renders, with a way to throw them away.
 *
 * Selection rather than a delete button per tile: a batch produces one render per mockup,
 * so the realistic job is "clear these sixteen", not "clear this one". Tiles stay
 * click-to-download when nothing is selected, and become checkboxes the moment something
 * is — so the common action costs nothing and the destructive one is deliberate.
 */
export function FinishedRenders({ renders }: { renders: FinishedRender[] }) {
  const router = useRouter();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const selecting = chosen.size > 0;

  function toggle(id: string) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setConfirming(false);
  }

  function remove() {
    setError(null);
    start(async () => {
      const result = await deleteRenders([...chosen]);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setChosen(new Set());
      setConfirming(false);
      router.refresh();
    });
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-sm font-semibold">
          Finished <span className="font-normal text-zinc-500">{renders.length}</span>
        </h2>

        {renders.length > 0 ? (
          <div className="ml-auto flex items-center gap-2 text-xs">
            {/*
              A link, not a button with a fetch: the browser downloads it itself, so a
              70 MB zip never has to exist as a blob in the tab. Selected ones when
              something is selected, everything otherwise.
            */}
            <a
              className="btn"
              href={
                selecting
                  ? `/api/renders/download?ids=${[...chosen].join(',')}`
                  : '/api/renders/download'
              }
            >
              {selecting ? `Download ${chosen.size}` : 'Download all'}
            </a>
            {selecting ? (
              <>
                <span className="text-zinc-500">{chosen.size} selected</span>
                <button className="btn" onClick={() => setChosen(new Set())} disabled={pending}>
                  Clear
                </button>
              </>
            ) : null}
            <button
              className="btn"
              disabled={pending}
              onClick={() =>
                setChosen(
                  chosen.size === renders.length ? new Set() : new Set(renders.map((r) => r.id)),
                )
              }
            >
              {chosen.size === renders.length ? 'Select none' : 'Select all'}
            </button>
            {selecting ? (
              // Two taps, because this deletes files and there is no undo.
              <button
                className={`btn ${confirming ? 'text-rose-400 hover:text-rose-300' : ''}`}
                disabled={pending}
                onClick={() => (confirming ? remove() : setConfirming(true))}
              >
                {pending
                  ? 'Deleting…'
                  : confirming
                    ? `Really delete ${chosen.size}`
                    : `Delete ${chosen.size}`}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {error ? <p className="text-xs text-rose-400">{error}</p> : null}

      {renders.length === 0 ? (
        <p className="py-10 text-center text-sm text-zinc-500">
          Nothing rendered yet. Pick designs and mockups above.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {renders.map((render) => {
            const picked = chosen.has(render.id);
            const file = downloadName(
              `${render.design_title}-${render.mockup_name}`,
              render.url ?? '.jpg',
            );
            return (
              <div
                key={render.id}
                className={`group relative overflow-hidden rounded-lg border bg-zinc-900 transition ${
                  picked ? 'border-emerald-500' : 'border-zinc-800 hover:border-zinc-600'
                }`}
              >
                <a
                  href={selecting ? undefined : (asDownload(render.url, file) ?? '#')}
                  onClick={(e) => {
                    if (!selecting) return;
                    e.preventDefault();
                    toggle(render.id);
                  }}
                  className="block cursor-pointer"
                >
                  <div className="relative aspect-[4/3] bg-zinc-950">
                    {render.url ? (
                      /*
                        Contained, not cropped. `object-cover` filled the tile by cutting the
                        sides off a 4:3 photo, which on this screen meant judging a print's
                        placement from a thumbnail that had thrown away the shoulders — a
                        design that sat fine looked clipped and off-centre. The whole frame
                        is the point here.

                        Signed, expiring URLs — next/image would cache them past their lifetime.
                      */
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={render.url}
                        alt={`${render.design_title} on ${render.mockup_name}`}
                        className="h-full w-full object-contain"
                        loading="lazy"
                      />
                    ) : null}
                  </div>
                  <div className="space-y-0.5 p-2.5">
                    <p className="truncate text-sm font-medium text-zinc-100">
                      {render.design_title}
                    </p>
                    <p className="truncate text-[11px] text-zinc-500">
                      {render.mockup_name} · {selecting ? 'click to select' : 'click to download'}
                    </p>
                  </div>
                </a>

                <button
                  className={`absolute left-1.5 top-1.5 z-10 flex h-5 w-5 items-center justify-center
                              rounded border text-[11px] transition ${
                                picked
                                  ? 'border-emerald-400 bg-emerald-500 text-zinc-950'
                                  : 'border-zinc-600 bg-zinc-950/70 text-transparent opacity-0 group-hover:opacity-100'
                              }`}
                  onClick={() => toggle(render.id)}
                  aria-label={picked ? 'Deselect this render' : 'Select this render'}
                >
                  ✓
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
