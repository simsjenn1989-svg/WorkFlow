'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CopyModel } from '@/lib/copy/generate';
import type { ListingStyle } from '@/lib/listings/style';

type Composed = {
  title: string;
  description: string;
  tags: string[];
  adjustments: string[];
  printedAreas: string[];
  examplesUsed: number;
};

/**
 * Write the listing for one draft, then put it on the product.
 *
 * Everything stays editable between those two steps. The copy is a starting point that is
 * usually right rather than an answer to accept, and the character counts are live because
 * Etsy rejects at publish time, which is the worst moment to find out.
 */
export function PolishPanel({
  productRowId,
  designTitle,
  models,
  styles,
  existing,
  onClose,
}: {
  productRowId: string;
  designTitle: string;
  models: CopyModel[];
  styles: ListingStyle[];
  existing: { title: string | null; description: string | null; tags: string[] } | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [model, setModel] = useState(models[0]?.id ?? '');
  const [styleId, setStyleId] = useState(styles.find((s) => s.is_default)?.id ?? styles[0]?.id ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'writing' | 'applying' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  const [title, setTitle] = useState(existing?.title ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [tags, setTags] = useState<string[]>(existing?.tags ?? []);
  const [result, setResult] = useState<Composed | null>(null);

  const style = styles.find((s) => s.id === styleId) ?? styles[0];
  const titleLimit = style?.title_char_limit ?? 140;
  const tagLimit = style?.tag_char_limit ?? 20;
  const tagCount = style?.tag_count ?? 13;

  async function write() {
    setBusy('writing');
    setError(null);
    setApplied(false);
    try {
      const response = await fetch('/api/listings/polish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productRowId, model, styleId, note }),
      });
      const body = (await response.json()) as Composed & { error?: string };
      if (!response.ok) {
        setError(body.error ?? 'Writing failed.');
        return;
      }
      setResult(body);
      setTitle(body.title);
      setDescription(body.description);
      setTags(body.tags);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    setBusy('applying');
    setError(null);
    try {
      const response = await fetch('/api/listings/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productRowId, title, description, tags }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? 'Printify would not take it.');
        return;
      }
      setApplied(true);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const overLongTags = tags.filter((t) => t.length > tagLimit);

  return (
    <div className="space-y-3 border-t border-zinc-800 bg-zinc-950/60 p-3 text-xs">
      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1 text-zinc-400">
          Model
          <select
            aria-label="Listing model"
            className="field w-auto py-1"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        {styles.length > 1 ? (
          <label className="space-y-1 text-zinc-400">
            Style
            <select
              aria-label="Listing style"
              className="field w-auto py-1"
              value={styleId}
              onChange={(e) => setStyleId(e.target.value)}
            >
              {styles.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="min-w-40 flex-1 space-y-1 text-zinc-400">
          Anything to add
          <input
            name="listing-note"
            className="field py-1"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. lean into the gift angle"
          />
        </label>

        <button className="btn-primary" onClick={write} disabled={busy !== null || !model}>
          {busy === 'writing' ? 'Writing…' : result ? 'Write again' : 'Write the listing'}
        </button>
        <button className="text-zinc-500 hover:text-zinc-300" onClick={onClose}>
          Close
        </button>
      </div>

      {result ? (
        <p className="text-[11px] text-zinc-600">
          Printed on {result.printedAreas.join(' and ')}
          {result.examplesUsed > 0
            ? ` · matched against ${result.examplesUsed} of your listings`
            : ' · no voice examples used'}
        </p>
      ) : null}

      {result?.adjustments.length ? (
        <ul className="space-y-0.5 text-[11px] text-amber-500/90">
          {result.adjustments.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      ) : null}

      {title || description || tags.length > 0 ? (
        <div className="space-y-2.5">
          <label className="block space-y-1 text-zinc-400">
            <span className="flex items-baseline justify-between">
              Title
              <span className={title.length > titleLimit ? 'text-rose-400' : 'text-zinc-600'}>
                {title.length}/{titleLimit}
              </span>
            </span>
            <textarea
              aria-label="Listing title"
              className="field h-12 resize-y"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>

          <div className="space-y-1">
            <span className="flex items-baseline justify-between text-zinc-400">
              Tags
              <span
                className={
                  tags.length > tagCount || overLongTags.length > 0 ? 'text-rose-400' : 'text-zinc-600'
                }
              >
                {tags.length}/{tagCount}
                {overLongTags.length > 0 ? ` · ${overLongTags.length} over ${tagLimit} characters` : ''}
              </span>
            </span>
            <ul className="flex flex-wrap gap-1.5">
              {tags.map((tag, i) => (
                <li
                  key={`${tag}-${i}`}
                  className={`flex items-center gap-1 rounded border px-1.5 py-0.5 ${
                    tag.length > tagLimit
                      ? 'border-rose-500/50 text-rose-300'
                      : 'border-zinc-800 text-zinc-300'
                  }`}
                >
                  {tag}
                  <button
                    aria-label={`Remove tag ${tag}`}
                    className="text-zinc-600 hover:text-rose-400"
                    onClick={() => setTags(tags.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <label className="block space-y-1 text-zinc-400">
            <span className="flex items-baseline justify-between">
              Description
              <span className="text-zinc-600">{description.length} characters</span>
            </span>
            <textarea
              aria-label="Listing description"
              className="field h-56 resize-y font-mono text-[11px] leading-relaxed"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <button
              className="btn-primary"
              onClick={apply}
              disabled={busy !== null || !title || tags.length === 0}
            >
              {busy === 'applying' ? 'Sending…' : 'Put it on the draft'}
            </button>
            {applied ? (
              <span className="text-emerald-400">
                Written onto the draft. Still unpublished — publish it in Printify yourself.
              </span>
            ) : (
              <span className="text-zinc-600">
                Updates the draft&rsquo;s title, tags and description. Nothing else, and it does not
                publish.
              </span>
            )}
          </div>
        </div>
      ) : (
        <p className="text-zinc-600">
          Writes the listing for <span className="text-zinc-400">{designTitle}</span> in your shop&rsquo;s
          voice, then you edit it before it goes on the draft.
        </p>
      )}

      {error ? <p className="text-rose-400">{error}</p> : null}
    </div>
  );
}
