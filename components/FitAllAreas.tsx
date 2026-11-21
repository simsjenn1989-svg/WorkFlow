'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Reshape every mockup's areas to the print area at once.
 *
 * Marking sixteen photos by hand is why this exists: the print canvas changed what an area
 * means — it is now the whole printable panel rather than a box around the artwork — and
 * every mockup marked before that is the wrong shape. Doing them one at a time is the same
 * click sixteen times.
 *
 * One request per mockup, because each one has to download its photo to know its aspect.
 * The count is shown as it goes, so a slow run looks like progress rather than a hang.
 */
export function FitAllAreas({ ids }: { ids: string[] }) {
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
        const response = await fetch('/api/mockups/fit', {
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
          title="Reshape every marked area to the print area's proportions, keeping its centre and width"
        >
          {confirming ? `Reshape all ${ids.length}?` : 'Fit all to print area'}
        </button>
      )}
      {error ? <span className="text-xs text-rose-400">{error}</span> : null}
    </div>
  );
}
