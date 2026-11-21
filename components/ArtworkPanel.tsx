'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PlacementNudge } from './PlacementNudge';
import { COMMON_LABELS, labelOptions, type Artwork } from '@/lib/artworks';
import { checkFiles, uploadFiles } from '@/lib/upload-client';

/**
 * The artwork a design holds, one per placement.
 *
 * A tee with a big front graphic and different back text is one design, so its back art is
 * added here rather than as a second design. Rendering matches artwork to print area by
 * label, and an area with no matching artwork is skipped.
 */
export function ArtworkPanel({ designId, artworks }: { designId: string; artworks: Artwork[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(COMMON_LABELS[0] as string);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const used = new Set(artworks.map((a) => a.label));
  // Every standard placement, plus any this design already uses under an older name, so
  // replacing that artwork is still possible from here.
  const options = labelOptions(...artworks.map((a) => a.label));
  // Default to the first placement not already taken; front first, so an empty design
  // opens on front rather than on back.
  const free = options.find((l) => !used.has(l));

  async function submit() {
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
              setOpen(true);
            }}
          >
            + Add placement
          </button>
        ) : null}
      </div>

      {artworks.length === 0 ? (
        <p className="text-[11px] text-zinc-600">
          No artwork yet. Generate some, or add a file for a placement.
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
