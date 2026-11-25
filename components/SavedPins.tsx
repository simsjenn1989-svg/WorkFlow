'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deletePins } from '@/app/pins/actions';
import { asDownload } from '@/lib/download';
import { pinFileName } from '@/lib/pins/csv';
import type { PinCard } from '@/lib/pins/data';
import { thumbUrl } from '@/lib/thumb';

/**
 * The saved pins, with the two things the screen was missing.
 *
 * You could save a pin and then neither download nor delete it. The tile was a link with
 * the HTML `download` attribute, which browsers ignore across origins — storage is a
 * different origin, so clicking opened the image in a tab instead of saving it. And
 * nothing removed a pin at all, so the shelf only ever grew.
 *
 * Selection rather than a button per tile, matching the Renders screen: pins are made in
 * batches and judged together.
 */
export function SavedPins({ pins }: { pins: PinCard[] }) {
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
      const result = await deletePins([...chosen]);
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
    <>
      <div className="flex flex-wrap items-center gap-2 text-xs">
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
            setChosen(chosen.size === pins.length ? new Set() : new Set(pins.map((p) => p.id)))
          }
        >
          {chosen.size === pins.length ? 'Select none' : 'Select all'}
        </button>
        {/*
          A link rather than a fetch, so the browser's own download takes the zip and it
          never exists as a blob in the tab.
        */}
        <a
          className="btn"
          href={selecting ? `/api/pins/download?ids=${[...chosen].join(',')}` : '/api/pins/download'}
        >
          {selecting ? `Download ${chosen.size}` : 'Download all'}
        </a>
        {selecting ? (
          // Two taps: this deletes the images too, and there is no undo.
          <button
            className={`btn ${confirming ? 'text-rose-400 hover:text-rose-300' : ''}`}
            disabled={pending}
            onClick={() => (confirming ? remove() : setConfirming(true))}
          >
            {pending ? 'Deleting…' : confirming ? `Really delete ${chosen.size}` : `Delete ${chosen.size}`}
          </button>
        ) : null}
      </div>

      {error ? <p className="text-xs text-rose-400">{error}</p> : null}

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {pins.map((pin) => {
          const picked = chosen.has(pin.id);
          const file = pinFileName(pin);
          return (
            <div
              key={pin.id}
              className={`group relative overflow-hidden rounded-lg border bg-zinc-900 transition ${
                picked ? 'border-emerald-500' : 'border-zinc-800 hover:border-zinc-600'
              }`}
            >
              <a
                /*
                  `download=` on the storage URL, not the HTML attribute: the attribute is
                  ignored across origins, which is why these opened in a tab instead of
                  saving. Supabase turns the parameter into Content-Disposition: attachment.
                */
                href={selecting ? undefined : (asDownload(pin.url, file) ?? '#')}
                onClick={(e) => {
                  if (!selecting) return;
                  e.preventDefault();
                  toggle(pin.id);
                }}
                className="block cursor-pointer"
              >
                <div className="relative aspect-[2/3] bg-zinc-950">
                  {pin.output_path ? (
                    // A 400px copy; the tile links to the original for download.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumbUrl(pin.output_path, 400)!}
                      alt={pin.title ?? pin.design_title}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : null}
                </div>
                <p className="truncate px-2 py-1.5 text-[11px] text-zinc-400">
                  {pin.title || pin.headline || pin.design_title}
                </p>
              </a>

              <button
                className={`absolute left-1.5 top-1.5 z-10 flex h-5 w-5 items-center justify-center
                            rounded border text-[11px] transition ${
                              picked
                                ? 'border-emerald-400 bg-emerald-500 text-zinc-950'
                                : 'border-zinc-600 bg-zinc-950/70 text-transparent opacity-0 group-hover:opacity-100'
                            }`}
                onClick={() => toggle(pin.id)}
                aria-label={picked ? 'Deselect this pin' : 'Select this pin'}
              >
                ✓
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
