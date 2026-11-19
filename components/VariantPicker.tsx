'use client';

import { useState, useTransition } from 'react';
import { chooseVariant } from '@/app/generate/actions';
import type { Variant } from '@/lib/queries';

/**
 * Pick the keeper from a generation. Choosing sets the design's image and moves it to
 * Approved; the others stay on record so the decision can be revisited later.
 */
export function VariantPicker({ designId, variants }: { designId: string; variants: Variant[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (variants.length === 0) return null;

  const chosen = variants.find((v) => v.chosen);

  return (
    <section className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">
          {variants.length} variant{variants.length === 1 ? '' : 's'}
        </h2>
        <p className="text-[11px] text-zinc-500">
          {chosen ? 'Pick a different one to swap it.' : 'Pick the keeper.'}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {variants.map((variant) => (
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
                  if (!result.ok) setError(result.error);
                  setBusyId(null);
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
