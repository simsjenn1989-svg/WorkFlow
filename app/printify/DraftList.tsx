'use client';

import { useState } from 'react';
import type { DraftCard } from '@/lib/printify/data';
import type { ListingRow } from '@/lib/listings/data';
import type { CopyModel } from '@/lib/copy/generate';
import type { ListingStyle } from '@/lib/listings/style';
import { PolishPanel } from './PolishPanel';

/**
 * What is waiting in Printify, and the state of its words.
 *
 * Skipped print areas are shown on the row rather than in a log, because a tee that went up
 * front-only when it was meant to be front-and-back is the single most expensive thing to
 * notice late. The listing state sits next to it for the same reason: a draft whose copy is
 * still the raw design title is not ready to publish, and that should be obvious at a glance.
 */
export function DraftList({
  drafts,
  listings,
  models,
  styles,
}: {
  drafts: DraftCard[];
  listings: ListingRow[];
  models: CopyModel[];
  styles: ListingStyle[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (drafts.length === 0) return null;

  const byProduct = new Map(listings.map((l) => [l.printify_product_id, l]));
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
        <ul className="divide-y divide-zinc-900 overflow-hidden rounded-lg border border-zinc-800 text-xs">
          {ready.map((draft) => {
            const listing = byProduct.get(draft.id) ?? null;
            const open = openId === draft.id;
            return (
              <li key={draft.id}>
                <div className="flex flex-wrap items-baseline gap-2 px-3 py-2">
                  <span className="min-w-0 truncate text-zinc-200">
                    {listing?.applied_at ? listing.title : draft.design_title}
                  </span>
                  <span className="text-zinc-600">{draft.preset_name}</span>

                  {draft.skipped.length > 0 ? (
                    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">
                      no {draft.skipped.join(' or ')} print
                    </span>
                  ) : null}

                  {listing?.applied_at ? (
                    <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">
                      listing written
                    </span>
                  ) : listing?.polished_at ? (
                    <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-300">
                      drafted, not applied
                    </span>
                  ) : (
                    <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                      raw title
                    </span>
                  )}

                  <span className="ml-auto flex items-baseline gap-3">
                    <button
                      className="text-zinc-400 hover:text-zinc-100"
                      onClick={() => setOpenId(open ? null : draft.id)}
                      disabled={styles.length === 0 || models.length === 0}
                      title={
                        styles.length === 0
                          ? 'Learn a listing style from your shop first'
                          : models.length === 0
                            ? 'Set ATLAS_CLOUD_API_KEY to write copy'
                            : undefined
                      }
                    >
                      {open ? 'close' : listing?.applied_at ? 'rewrite' : 'write listing'}
                    </button>
                    {draft.url ? (
                      <a
                        href={draft.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-zinc-400 underline-offset-2 hover:text-zinc-100 hover:underline"
                      >
                        open in Printify →
                      </a>
                    ) : null}
                  </span>
                </div>

                {open ? (
                  <PolishPanel
                    productRowId={draft.id}
                    designTitle={draft.design_title}
                    models={models}
                    styles={styles}
                    existing={listing}
                    onClose={() => setOpenId(null)}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
