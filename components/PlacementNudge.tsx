'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PlacementOverride } from '@/lib/artworks';

/**
 * Move one design on the garment, without changing the preset.
 *
 * Position is normally worked out from the trimmed art so every design's top edge lands at
 * the same height — that is right nearly always. This is the exception, and it is stored as
 * an override rather than as a copy of the computed numbers, so clearing it genuinely
 * returns the design to the rules rather than freezing it at today's version of them.
 */
export function PlacementNudge({
  artworkId,
  label,
  placement,
}: {
  artworkId: string;
  label: string;
  placement: PlacementOverride | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The preset's own numbers are not known here, so an override starts from the middle of
  // the sensible range rather than pretending to know what the computed value was.
  const [draft, setDraft] = useState<PlacementOverride>(
    placement ?? { x: 0.5, y: 0.38, scale: 0.8, angle: 0 },
  );

  async function save(next: PlacementOverride | null) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/artworks/placement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artworkId, placement: next }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? 'Saving failed.');
        return;
      }
      router.refresh();
      if (next === null) setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        className="w-full px-2 pb-1.5 text-left text-[10px] text-zinc-500 hover:text-zinc-300"
        onClick={() => setOpen(true)}
      >
        {placement ? '● nudged — adjust' : 'nudge position'}
      </button>
    );
  }

  return (
    <div className="space-y-1.5 border-t border-zinc-800 p-2 text-[10px]">
      <p className="text-zinc-500">
        Overrides the computed position for {label} only.
      </p>
      {(
        [
          ['x', 'across', 0, 1],
          ['y', 'down', 0, 1],
          ['scale', 'size', 0.1, 1.5],
        ] as const
      ).map(([field, name, min, max]) => (
        <label key={field} className="flex items-center gap-1.5 text-zinc-500">
          <span className="w-10">{name}</span>
          <input
            type="range"
            aria-label={`${label} ${name}`}
            min={min}
            max={max}
            step={0.01}
            value={draft[field]}
            onChange={(e) => setDraft({ ...draft, [field]: Number(e.target.value) })}
            className="flex-1"
          />
          <span className="w-8 tabular-nums text-zinc-400">{draft[field].toFixed(2)}</span>
        </label>
      ))}

      <div className="flex items-center gap-2 pt-0.5">
        <button
          className="rounded bg-zinc-200 px-2 py-0.5 font-medium text-zinc-900 hover:bg-white"
          onClick={() => save(draft)}
          disabled={busy}
        >
          Save
        </button>
        {placement ? (
          <button
            className="text-zinc-500 hover:text-zinc-200"
            onClick={() => save(null)}
            disabled={busy}
            title="Follow the preset's rules again"
          >
            Clear
          </button>
        ) : null}
        <button className="ml-auto text-zinc-600 hover:text-zinc-300" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>

      {error ? <p className="text-rose-400">{error}</p> : null}
    </div>
  );
}
