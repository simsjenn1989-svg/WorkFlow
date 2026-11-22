'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Place every mockup's print area over the garment in its photo.
 *
 * Marking fifteen photos by hand is why this exists, and doing it by hand is also why it
 * had to be measured rather than eyeballed: a box set to a fixed fraction of the PHOTO is
 * a sensible print on a close crop and runs off the sleeves on a wide shot. The detector
 * finds the shirt and sizes to that. See lib/render/garment.ts.
 *
 * One request per mockup, because each one has to download and scan its photo. The count
 * is shown as it goes, so a slow run looks like progress rather than a hang.
 */
export function AutoPlaceAll({ ids }: { ids: string[] }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setConfirming(false);
    setError(null);
    const problems: string[] = [];

    for (const [i, id] of ids.entries()) {
      setProgress(`Fitting ${i + 1} of ${ids.length}…`);
      try {
        const response = await fetch('/api/mockups/auto-place', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        });
        const body = (await response.json().catch(() => null)) as
          | { name?: string; error?: string }
          | null;
        if (!response.ok) problems.push(`${body?.name ?? id}: ${body?.error ?? 'failed'}`);
      } catch (e) {
        problems.push((e as Error).message);
      }
    }

    setProgress(null);
    if (problems.length > 0) setError(problems.join('; '));
    router.refresh();
  }

  if (ids.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {progress ? (
        <span className="text-xs text-zinc-400">{progress}</span>
      ) : (
        <button
          className={`btn text-xs ${confirming ? 'text-amber-400 hover:text-amber-300' : ''}`}
          onClick={() => (confirming ? run() : setConfirming(true))}
          title="Find the garment in every photo and put its print area on the chest"
        >
          {confirming ? `Place all ${ids.length}?` : 'Auto-place all'}
        </button>
      )}
      {error ? <span className="text-xs text-rose-400">{error}</span> : null}
    </div>
  );
}
