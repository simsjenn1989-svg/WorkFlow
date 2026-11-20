'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ListingStyle, StyleInput } from '@/lib/listings/style';

type Derived = {
  style: StyleInput;
  evidence: {
    sampled: number;
    titleSuffixSeenIn: number;
    tagCountMode: number;
    longestTag: number;
    blocksFound: { heading: string; seenIn: number; conditionalLines: number }[];
  };
};

/**
 * The house style, read from the shop rather than typed in.
 *
 * The evidence is shown next to every part of it. A style derived from a sample of listings
 * is a claim about how the shop writes, and a claim you can check beats one you have to
 * take on faith — "in 15 of 19" is the difference between trusting this and guessing.
 */
export function StylePanel({
  styles,
  shops,
}: {
  styles: ListingStyle[];
  shops: { id: string; title: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(styles.length === 0);
  const [shopId, setShopId] = useState(shops[0]?.id ?? '');
  const [draft, setDraft] = useState<Derived | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function learn(from?: ListingStyle) {
    const shop = from?.shop_id ?? shopId;
    if (!shop) return;
    setBusy(true);
    setError(null);
    try {
      const name = shops.find((s) => s.id === shop)?.title ?? `Shop ${shop}`;
      const response = await fetch(
        `/api/listings/styles?shopId=${encodeURIComponent(shop)}&name=${encodeURIComponent(name)}`,
      );
      const body = (await response.json()) as Derived & { error?: string };
      if (!response.ok) {
        setError(body.error ?? 'Could not read that shop.');
        return;
      }
      // Re-learning keeps what you decided: the name, the voice note, the default flag.
      setDraft({
        ...body,
        style: from
          ? { ...body.style, name: from.name, voice_note: from.voice_note, is_default: from.is_default }
          : { ...body.style, is_default: styles.length === 0 },
      });
      setEditing(from?.id ?? null);
      setOpen(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/listings/styles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editing, ...draft.style }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? 'Saving failed.');
        return;
      }
      setDraft(null);
      setEditing(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await fetch('/api/listings/styles', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    router.refresh();
  }

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/60">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-3 py-2">
        <h2 className="text-sm font-semibold">
          Listing style <span className="font-normal text-zinc-500">{styles.length}</span>
        </h2>
        <div className="flex items-center gap-3">
          <button className="text-xs text-zinc-400 hover:text-zinc-200" onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide' : 'Show'}
          </button>
          <select
            aria-label="Shop to learn from"
            className="field w-auto py-1 text-xs"
            value={shopId}
            onChange={(e) => setShopId(e.target.value)}
          >
            {shops.map((shop) => (
              <option key={shop.id} value={shop.id}>
                {shop.title}
              </option>
            ))}
          </select>
          <button className="btn text-xs" onClick={() => learn()} disabled={busy || !shopId}>
            {busy && !draft ? 'Reading…' : 'Learn from this shop'}
          </button>
        </div>
      </header>

      {open ? (
        <div className="space-y-3 p-3">
          {styles.length > 0 ? (
            <ul className="divide-y divide-zinc-900 rounded border border-zinc-800 text-xs">
              {styles.map((style) => (
                <li key={style.id} className="flex flex-wrap items-baseline gap-2 px-3 py-2">
                  <span className="font-medium text-zinc-200">{style.name}</span>
                  {style.is_default ? (
                    <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">
                      default
                    </span>
                  ) : null}
                  <span className="text-zinc-500">
                    {style.tag_count} tags · {style.blocks.length} fixed block
                    {style.blocks.length === 1 ? '' : 's'}
                    {style.title_suffix ? ` · ends "${style.title_suffix}"` : ''}
                  </span>
                  <span className="ml-auto flex gap-3">
                    <button
                      className="text-zinc-400 hover:text-zinc-200"
                      onClick={() => learn(style)}
                      disabled={busy}
                    >
                      re-learn
                    </button>
                    <button className="text-zinc-600 hover:text-rose-400" onClick={() => remove(style.id)}>
                      delete
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {draft ? (
            <div className="space-y-3 rounded border border-zinc-700 bg-zinc-950/60 p-3 text-xs">
              <p className="text-zinc-400">
                Read {draft.evidence.sampled} listing{draft.evidence.sampled === 1 ? '' : 's'} from this
                shop.
              </p>

              <label className="block space-y-1 text-zinc-400">
                Name
                <input
                  className="field"
                  value={draft.style.name}
                  onChange={(e) =>
                    setDraft({ ...draft, style: { ...draft.style, name: e.target.value } })
                  }
                />
              </label>

              <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[9rem_minmax(0,1fr)]">
                <dt className="text-zinc-500">Title ends with</dt>
                <dd className="text-zinc-200">
                  {draft.style.title_suffix ? (
                    <>
                      &ldquo;{draft.style.title_suffix}&rdquo;{' '}
                      <span className="text-zinc-600">
                        in {draft.evidence.titleSuffixSeenIn} of {draft.evidence.sampled}
                      </span>
                    </>
                  ) : (
                    <span className="text-amber-500/90">no shared ending found</span>
                  )}
                </dd>

                <dt className="text-zinc-500">Written phrases</dt>
                <dd className="text-zinc-200">{draft.style.title_chunks} before the ending</dd>

                <dt className="text-zinc-500">Tags</dt>
                <dd className="text-zinc-200">
                  {draft.style.tag_count} total, max {draft.style.tag_char_limit} characters each
                  {draft.evidence.longestTag > draft.style.tag_char_limit ? (
                    <span className="text-amber-500/90">
                      {' '}
                      · longest in your shop is {draft.evidence.longestTag}, over Etsy&rsquo;s limit
                    </span>
                  ) : null}
                </dd>

                <dt className="text-zinc-500">Always included</dt>
                <dd className="text-zinc-200">{draft.style.tail_tags.join(', ') || '—'}</dd>
              </dl>

              <div className="space-y-2">
                <p className="text-zinc-500">
                  Fixed blocks, copied from your listings so no model has to reproduce a spec
                </p>
                {draft.style.blocks.map((block) => {
                  const found = draft.evidence.blocksFound.find((f) => f.heading === block.heading);
                  return (
                    <div key={block.heading} className="rounded border border-zinc-800 p-2">
                      <p className="font-medium text-zinc-300">
                        {block.heading}{' '}
                        <span className="font-normal text-zinc-600">
                          in {found?.seenIn ?? 0} of {draft.evidence.sampled}
                        </span>
                      </p>
                      <ul className="mt-1 space-y-0.5 text-zinc-500">
                        {block.lines.map((bLine) => (
                          <li key={bLine.text}>
                            {bLine.requires ? (
                              <span className="mr-1 rounded bg-sky-500/15 px-1 text-[10px] text-sky-300">
                                two-sided only
                              </span>
                            ) : null}
                            {bLine.text}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>

              <label className="block space-y-1 text-zinc-400">
                Standing instruction <span className="text-zinc-600">optional</span>
                <textarea
                  className="field h-16 resize-y"
                  placeholder="e.g. never mention Halloween, always say oversized"
                  value={draft.style.voice_note ?? ''}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      style: { ...draft.style, voice_note: e.target.value || null },
                    })
                  }
                />
              </label>

              <label className="flex items-center gap-2 text-zinc-400">
                <input
                  type="checkbox"
                  checked={draft.style.is_default}
                  onChange={(e) =>
                    setDraft({ ...draft, style: { ...draft.style, is_default: e.target.checked } })
                  }
                />
                Use this style by default
              </label>

              <div className="flex items-center gap-3">
                <button className="btn-primary" onClick={save} disabled={busy}>
                  {busy ? 'Saving…' : editing ? 'Save changes' : 'Save style'}
                </button>
                <button
                  className="text-zinc-500 hover:text-zinc-300"
                  onClick={() => {
                    setDraft(null);
                    setEditing(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {error ? <p className="text-xs text-rose-400">{error}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
