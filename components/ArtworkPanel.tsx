'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PlacementNudge } from './PlacementNudge';
import { COMMON_LABELS, labelOptions, type Artwork } from '@/lib/artworks';
import { checkFiles, uploadFiles } from '@/lib/upload-client';
import { assignArtwork } from '@/app/actions';
import type { Variant } from '@/lib/queries';

/**
 * The artwork a design holds, one per placement.
 *
 * A tee with a big front graphic and different back text is one design, so its back art is
 * added here rather than as a second design. Rendering matches artwork to print area by
 * label, and an area with no matching artwork is skipped.
 */
export function ArtworkPanel({
  designId,
  artworks,
  variants,
}: {
  designId: string;
  artworks: Artwork[];
  variants: Variant[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(COMMON_LABELS[0] as string);
  const [file, setFile] = useState<File | null>(null);
  /*
    Where the image comes from. "have" is first and is the default whenever the design has
    any image of its own, because that is the case the form was missing: the same art on a
    second placement used to mean downloading it and uploading it straight back.
  */
  const [from, setFrom] = useState<'have' | 'file'>('file');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const used = new Set(artworks.map((a) => a.label));

  /*
    Every image this design already holds, as options for another placement. Artwork first,
    because "the one I picked" is what someone means by "the design"; then variants, which
    includes ones never chosen — a rejected variant is a perfectly good back print.
  */
  const mine = [
    ...artworks.map((a) => ({ value: `artwork:${a.id}`, text: `${a.label} artwork`, url: a.url })),
    ...variants.map((v, i) => ({
      value: `variant:${v.id}`,
      text: `variant ${i + 1}${v.chosen ? ' (the keeper)' : ''}`,
      url: v.url,
    })),
  ];
  const picked = mine.find((m) => m.value === source) ?? mine[0];
  // Every standard placement, plus any this design already uses under an older name, so
  // replacing that artwork is still possible from here.
  const options = labelOptions(...artworks.map((a) => a.label));
  // Default to the first placement not already taken; front first, so an empty design
  // opens on front rather than on back.
  const free = options.find((l) => !used.has(l));

  async function submit() {
    if (from === 'have') {
      if (!picked) {
        setError('This design has no image to reuse yet.');
        return;
      }
      setBusy(true);
      setError(null);
      const result = await assignArtwork(designId, label, picked.value);
      setBusy(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
      return;
    }

    if (!file) {
      setError('Pick an image.');
      return;
    }
    const problem = checkFiles([file]);
    if (problem) {
      setError(problem);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const uploaded = await uploadFiles('design', [file]);
      const response = await fetch('/api/designs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: uploaded, designId, label }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Saving failed.');
      }
      setFile(null);
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">
          Artwork <span className="font-normal text-zinc-500">{artworks.length}</span>
        </h2>
        {!open ? (
          <button
            className="text-xs text-zinc-400 hover:text-zinc-200"
            onClick={() => {
              // Open on a placement this design does not have yet, so the common case —
              // adding a second print — needs no choice at all.
              if (free) setLabel(free);
              setFrom(mine.length > 0 ? 'have' : 'file');
              setSource(mine[0]?.value ?? '');
              setOpen(true);
            }}
          >
            + Add placement
          </button>
        ) : null}
      </div>

      {artworks.length === 0 ? (
        /*
          "No artwork yet" plus a file picker read as "upload something", even when the
          design had images sitting right there waiting to be picked. An unchosen variant
          is the overwhelmingly common reason this panel is empty, so it says so.
        */
        <p className="text-[11px] leading-relaxed text-zinc-500">
          {variants.length > 0
            ? `Nothing is on a placement yet. ${variants.length === 1 ? 'The variant' : 'One of the variants'} below is the design — hit Use this one and it becomes the ${variants[0]?.label ?? 'front'} artwork.`
            : 'No artwork yet. Generate some, or add a file for a placement.'}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {artworks.map((artwork) => (
            <div key={artwork.id} className="overflow-hidden rounded-md border border-zinc-800">
              <div className="relative aspect-square bg-[repeating-conic-gradient(#27272a_0%_25%,#18181b_0%_50%)] bg-[length:12px_12px]">
                {artwork.url ? (
                  /* Signed, expiring URLs — next/image would cache them past their lifetime. */
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={artwork.url} alt={artwork.label} className="h-full w-full object-contain" loading="lazy" />
                ) : null}
              </div>
              <p className="truncate px-2 py-1 text-[11px] text-zinc-300">{artwork.label}</p>
              <PlacementNudge
                artworkId={artwork.id}
                label={artwork.label}
                placement={artwork.placement}
              />
            </div>
          ))}
        </div>
      )}

      {open ? (
        <div className="space-y-2 border-t border-zinc-800 pt-3">
          {mine.length > 0 ? (
            <div className="flex rounded border border-zinc-800 p-0.5 text-[11px]">
              {([['have', 'An image this design has'], ['file', 'A file from my computer']] as const).map(
                ([key, text]) => (
                  <button
                    key={key}
                    className={`flex-1 rounded px-2 py-1 ${
                      from === key ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                    onClick={() => setFrom(key)}
                  >
                    {text}
                  </button>
                ),
              )}
            </div>
          ) : null}

          <label className="block space-y-1 text-xs text-zinc-400">
            Placement
            <select
              name="label"
              className="field"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            >
              {options.map((l) => (
                <option key={l} value={l}>
                  {l}
                  {used.has(l) ? ' — replaces the current one' : ''}
                </option>
              ))}
            </select>
          </label>

          {from === 'have' ? (
            <div className="flex items-start gap-2">
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded border border-zinc-800 bg-[repeating-conic-gradient(#27272a_0%_25%,#18181b_0%_50%)] bg-[length:10px_10px]">
                {picked?.url ? (
                  /* Signed, expiring URLs — next/image would cache them past their lifetime. */
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={picked.url} alt="" className="h-full w-full object-contain" />
                ) : null}
              </div>
              <label className="flex-1 space-y-1 text-xs text-zinc-400">
                Image
                <select
                  className="field"
                  value={picked?.value ?? ''}
                  onChange={(e) => setSource(e.target.value)}
                >
                  {mine.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.text}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : (
            <>
              <button className="btn w-full" onClick={() => inputRef.current?.click()}>
                {file ? file.name : 'Choose image'}
              </button>
              <input
                ref={inputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </>
          )}

          {from === 'have' ? (
            <p className="text-[11px] leading-relaxed text-zinc-600">
              The same file on both placements, not a copy. Each one is sized and positioned
              on its own at push time.
            </p>
          ) : null}

          {used.has(label.trim().toLowerCase()) ? (
            <p className="text-[11px] text-amber-400">
              This replaces the existing {label.trim().toLowerCase()} artwork.
            </p>
          ) : null}
          {error ? <p className="text-xs text-rose-400">{error}</p> : null}

          <div className="flex gap-2">
            <button className="btn-primary flex-1" onClick={submit} disabled={busy}>
              {busy ? 'Uploading…' : 'Add'}
            </button>
            <button className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
