'use client';

import { useState, useTransition } from 'react';
import { chooseVariant } from '@/app/generate/actions';
import type { Variant } from '@/lib/queries';
import { asDownload, downloadName } from '@/lib/download';

/**
 * Pick the keeper from a generation. Choosing sets the design's image and moves it to
 * Approved; the others stay on record so the decision can be revisited later.
 */
export function VariantPicker({
  designId,
  title,
  variants,
}: {
  designId: string;
  title: string;
  variants: Variant[];
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);

  if (variants.length === 0) return null;

  const chosen = variants.find((v) => v.chosen);

  return (
    <section className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">
          {variants.length} variant{variants.length === 1 ? '' : 's'}{' '}
          {/*
            Which placement these are for, stated once rather than only in the tiny caption
            under each tile. It was chosen on the Generate screen and is what picking one
            will set, so it belongs where the decision is being made.
          */}
          <span className="ml-1.5 font-normal text-zinc-500">
            for {[...new Set(variants.map((v) => v.label))].join(', ')}
          </span>
        </h2>
        <p className="text-[11px] text-zinc-500">
          {preparing
            ? 'Sizing it to the print area…'
            : chosen
              ? 'Pick a different one to swap it.'
              : 'Pick the keeper.'}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {variants.map((variant, index) => (
          <div
            key={variant.id}
            className={`overflow-hidden rounded-md border transition ${
              variant.chosen ? 'border-emerald-500' : 'border-zinc-800'
            }`}
          >
            <div className="relative aspect-square bg-[repeating-conic-gradient(#27272a_0%_25%,#18181b_0%_50%)] bg-[length:14px_14px]">
              {variant.url ? (
                /* Signed, expiring URLs — next/image would cache them past their lifetime. */
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={variant.url}
                  alt=""
                  className="h-full w-full object-contain"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-[11px] text-zinc-600">
                  Missing
                </div>
              )}
            </div>
            <p className="flex items-baseline justify-between gap-2 bg-zinc-950 px-2 py-0.5 text-[10px] text-zinc-500">
              <span className="truncate">{variant.label}</span>
              {/*
                Downloading an option you have not picked is the common case: it is how a
                design leaves the app for anything the app does not do yet.
              */}
              {variant.url ? (
                <a
                  className="shrink-0 text-zinc-400 hover:text-zinc-100"
                  href={asDownload(variant.url, downloadName(title, variant.url, `-${variant.label}-${index + 1}`))!}
                  title="Download this one"
                >
                  download
                </a>
              ) : null}
            </p>
            <button
              className={`w-full px-2 py-1.5 text-[11px] ${
                variant.chosen
                  ? 'bg-emerald-950 text-emerald-300'
                  : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
              }`}
              disabled={pending || variant.chosen}
              onClick={() => {
                setError(null);
                setBusyId(variant.id);
                start(async () => {
                  const result = await chooseVariant(designId, variant.id);
                  if (!result.ok) {
                    setError(result.error);
                    setBusyId(null);
                    return;
                  }
                  /*
                    Picking the keeper is the moment a design becomes something you put on
                    products, so the print canvas is built here rather than at push time.
                    It is a separate request because it takes about six seconds — too long
                    to hold the action open with no sign of progress.

                    A failure is reported and nothing else: the artwork exists either way,
                    and everything downstream falls back to the raw image as it did before
                    canvases existed.
                  */
                  setPreparing(true);
                  try {
                    const response = await fetch('/api/artworks/normalise', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ designId }),
                    });
                    const body = (await response.json().catch(() => null)) as
                      | { failed?: string[]; error?: string }
                      | null;
                    if (!response.ok) throw new Error(body?.error ?? 'Preparing the print file failed.');
                    if (body?.failed?.length) setError(`Print file: ${body.failed.join('; ')}`);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setPreparing(false);
                    setBusyId(null);
                  }
                });
              }}
            >
              {variant.chosen
                ? '✓ Chosen'
                : busyId === variant.id && pending
                  ? 'Choosing…'
                  : 'Use this one'}
            </button>
          </div>
        ))}
      </div>

      {error ? <p className="text-xs text-rose-400">{error}</p> : null}
    </section>
  );
}
