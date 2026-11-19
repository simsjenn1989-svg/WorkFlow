'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DesignCard } from '@/lib/types';
import type { MockupTemplate } from '@/lib/mockups';

type Skipped = { designId: string; mockupId: string; reason: string };
type Progress = { total: number; queued: number; done: number; failed: number };

/**
 * Pick designs and mockups, then run every workable pair.
 *
 * Mockups are chosen rather than assumed, because single-sided and double-sided products are
 * run as separate passes — a front-only design has no business meeting a front-and-back
 * mockup, and picking the set is how you say so.
 */
export function BatchRunner({
  designs,
  mockups,
}: {
  designs: DesignCard[];
  mockups: MockupTemplate[];
}) {
  const router = useRouter();
  const [chosenDesigns, setChosenDesigns] = useState<string[]>([]);
  const [chosenMockups, setChosenMockups] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [skipped, setSkipped] = useState<Skipped[]>([]);
  const [error, setError] = useState<string | null>(null);

  const designById = useMemo(() => new Map(designs.map((d) => [d.id, d])), [designs]);
  const mockupById = useMemo(() => new Map(mockups.map((m) => [m.id, m])), [mockups]);

  /** Work out up front which pairs cannot run, so the count is honest before anything starts. */
  const plan = useMemo(() => {
    let workable = 0;
    const blocked: Skipped[] = [];
    for (const designId of chosenDesigns) {
      const labels = new Set(designById.get(designId)?.artwork_labels ?? []);
      for (const mockupId of chosenMockups) {
        const mockup = mockupById.get(mockupId);
        if (!mockup) continue;
        const missing = mockup.print_areas.filter((a) => !labels.has(a.label)).map((a) => a.label);
        if (mockup.print_areas.length === 0) {
          blocked.push({ designId, mockupId, reason: 'no print area marked' });
        } else if (missing.length > 0) {
          blocked.push({ designId, mockupId, reason: `no ${missing.join(' or ')} artwork` });
        } else {
          workable++;
        }
      }
    }
    return { workable, blocked };
  }, [chosenDesigns, chosenMockups, designById, mockupById]);

  function toggle(list: string[], id: string, set: (next: string[]) => void) {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  async function run() {
    setRunning(true);
    setError(null);
    setSkipped([]);
    setProgress(null);

    try {
      const planned = await fetch('/api/renders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ designIds: chosenDesigns, mockupIds: chosenMockups }),
      });
      const body = (await planned.json()) as {
        batchId?: string;
        queued?: number;
        skipped?: Skipped[];
        error?: string;
      };
      if (!planned.ok || !body.batchId) {
        setError(body.error ?? 'Could not start the batch.');
        return;
      }

      setSkipped(body.skipped ?? []);
      if (!body.queued) {
        setError('Nothing could be rendered — every pair was skipped.');
        return;
      }

      setProgress({ total: body.queued, queued: body.queued, done: 0, failed: 0 });

      // One render per request: each call stays short, and a batch can be resumed rather
      // than restarted if something goes wrong halfway.
      for (let guard = 0; guard < body.queued + 5; guard++) {
        const step = await fetch('/api/renders/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batchId: body.batchId }),
        });
        if (!step.ok) {
          const stepBody = (await step.json().catch(() => null)) as { error?: string } | null;
          setError(stepBody?.error ?? 'A render failed to start.');
          break;
        }
        const next = (await step.json()) as Progress;
        setProgress(next);
        if (next.queued === 0) break;
      }

      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const ready = chosenDesigns.length > 0 && chosenMockups.length > 0 && plan.workable > 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Picker
          title="Designs"
          empty="No designs with artwork yet."
          items={designs.map((d) => ({
            id: d.id,
            label: d.title,
            hint: d.artwork_labels.join(', ') || 'no artwork',
          }))}
          chosen={chosenDesigns}
          onToggle={(id) => toggle(chosenDesigns, id, setChosenDesigns)}
          onAll={() => setChosenDesigns(chosenDesigns.length === designs.length ? [] : designs.map((d) => d.id))}
        />
        <Picker
          title="Mockups"
          empty="No mockups yet."
          items={mockups.map((m) => ({
            id: m.id,
            label: m.name,
            hint: m.print_areas.length
              ? m.print_areas.map((a) => a.label).join(' + ')
              : 'not marked',
          }))}
          chosen={chosenMockups}
          onToggle={(id) => toggle(chosenMockups, id, setChosenMockups)}
          onAll={() => setChosenMockups(chosenMockups.length === mockups.length ? [] : mockups.map((m) => m.id))}
        />
      </div>

      <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary" onClick={run} disabled={!ready || running}>
            {running
              ? 'Rendering…'
              : `Render ${plan.workable} image${plan.workable === 1 ? '' : 's'}`}
          </button>
          <p className="text-xs text-zinc-500">
            {chosenDesigns.length} design{chosenDesigns.length === 1 ? '' : 's'} ×{' '}
            {chosenMockups.length} mockup{chosenMockups.length === 1 ? '' : 's'}
            {plan.blocked.length > 0 ? (
              <span className="text-amber-500/90"> · {plan.blocked.length} will be skipped</span>
            ) : null}
          </p>
        </div>

        {progress ? (
          <div className="space-y-1">
            <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{ width: `${((progress.done + progress.failed) / Math.max(1, progress.total)) * 100}%` }}
              />
            </div>
            <p className="text-xs text-zinc-500">
              {progress.done} done
              {progress.failed > 0 ? <span className="text-rose-400"> · {progress.failed} failed</span> : null}
              {progress.queued > 0 ? ` · ${progress.queued} to go` : ' · finished'}
            </p>
          </div>
        ) : null}

        {plan.blocked.length > 0 && !progress ? (
          <ul className="space-y-0.5 text-[11px] text-zinc-500">
            {plan.blocked.slice(0, 6).map((s, i) => (
              <li key={i}>
                {designById.get(s.designId)?.title} × {mockupById.get(s.mockupId)?.name} —{' '}
                <span className="text-amber-500/90">{s.reason}</span>
              </li>
            ))}
            {plan.blocked.length > 6 ? <li>…and {plan.blocked.length - 6} more</li> : null}
          </ul>
        ) : null}

        {skipped.length > 0 && progress ? (
          <p className="text-[11px] text-amber-500/90">
            {skipped.length} pair{skipped.length === 1 ? '' : 's'} skipped.
          </p>
        ) : null}

        {error ? <p className="text-xs text-rose-400">{error}</p> : null}
      </div>
    </div>
  );
}

function Picker({
  title,
  empty,
  items,
  chosen,
  onToggle,
  onAll,
}: {
  title: string;
  empty: string;
  items: { id: string; label: string; hint: string }[];
  chosen: string[];
  onToggle: (id: string) => void;
  onAll: () => void;
}) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/60">
      <header className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <h2 className="text-sm font-semibold">
          {title} <span className="font-normal text-zinc-500">{chosen.length}</span>
        </h2>
        {items.length > 0 ? (
          <button className="text-xs text-zinc-400 hover:text-zinc-200" onClick={onAll}>
            {chosen.length === items.length ? 'Clear' : 'Select all'}
          </button>
        ) : null}
      </header>

      {items.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-zinc-600">{empty}</p>
      ) : (
        <ul className="max-h-64 overflow-y-auto p-2">
          {items.map((item) => (
            <li key={item.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-zinc-800/60">
                <input
                  type="checkbox"
                  checked={chosen.includes(item.id)}
                  onChange={() => onToggle(item.id)}
                />
                <span className="min-w-0 flex-1 truncate text-zinc-200">{item.label}</span>
                <span className="shrink-0 text-[11px] text-zinc-500">{item.hint}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
