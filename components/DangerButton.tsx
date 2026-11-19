'use client';

import { useState, useTransition } from 'react';

/**
 * Two-step destructive action. The first click arms it, the second does it — no modal, but
 * also no deleting a design because of a stray click.
 */
export function DangerButton({
  action,
  label,
  confirmLabel,
  onDone,
}: {
  action: () => Promise<{ ok: true } | { ok: false; error: string }>;
  label: string;
  confirmLabel: string;
  onDone?: string;
}) {
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!armed) {
    return (
      <button className="btn text-rose-400 hover:text-rose-300" onClick={() => setArmed(true)}>
        {label}
      </button>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        className="btn border-rose-900 bg-rose-950 text-rose-200 hover:bg-rose-900"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await action();
            if (!result.ok) {
              setError(result.error);
              setArmed(false);
            } else if (onDone) {
              window.location.href = onDone;
            }
          })
        }
      >
        {pending ? 'Deleting…' : confirmLabel}
      </button>
      <button className="btn" disabled={pending} onClick={() => setArmed(false)}>
        Cancel
      </button>
      {error ? <span className="text-xs text-rose-400">{error}</span> : null}
    </span>
  );
}
