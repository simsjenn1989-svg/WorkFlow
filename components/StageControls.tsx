'use client';

import { useState, useTransition } from 'react';
import { advanceDesign, regressDesign, setStage } from '@/app/actions';
import { ALL_STAGES, STAGE_META, nextStage, previousStage, type Stage } from '@/lib/stages';

/**
 * Moving a design through the pipeline. Buttons rather than drag-and-drop: a stage change is
 * a deliberate act, and buttons work on a phone and keyboard without any of the drag edge
 * cases.
 */
export function StageControls({ designId, stage }: { designId: string; stage: Stage }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const forward = nextStage(stage);
  const back = previousStage(stage);

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    start(async () => {
      const result = await fn();
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="btn"
          disabled={pending || !back}
          onClick={() => run(() => regressDesign(designId, stage))}
          title={back ? `Back to ${STAGE_META[back].label}` : 'Already at the first stage'}
        >
          ← Back
        </button>
        <button
          className="btn-primary"
          disabled={pending || !forward}
          onClick={() => run(() => advanceDesign(designId, stage))}
          title={forward ? `Move to ${STAGE_META[forward].label}` : 'End of the pipeline'}
        >
          {forward ? `Move to ${STAGE_META[forward].label}` : 'At the end'} →
        </button>

        <label className="ml-auto flex items-center gap-2 text-xs text-zinc-400">
          Jump to
          <select
            className="field w-auto py-1 text-xs"
            value={stage}
            disabled={pending}
            onChange={(e) => run(() => setStage(designId, e.target.value))}
          >
            {ALL_STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_META[s].label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error ? <p className="text-xs text-rose-400">{error}</p> : null}
    </div>
  );
}
