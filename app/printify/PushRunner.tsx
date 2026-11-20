'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DesignCard } from '@/lib/types';
import { enabledAreas, type Preset } from '@/lib/printify/presets';

type Skip = { designId: string; reason: string };
type Progress = { total: number; queued: number; done: number; failed: number };

/**
 * Choose designs, choose a preset, make drafts.
 *
 * A design missing artwork for one of the preset's areas is still pushed — the areas it has
 * are printed and the rest are listed afterwards. Only a design with artwork for none of them
 * is blocked, and that is said before anything runs rather than discovered halfway.
 */
export function PushRunner({
  designs,
  presets,
  drafted,
  atlasAvailable,
}: {
  designs: DesignCard[];
  presets: Preset[];
  drafted: string[];
  atlasAvailable: boolean;
}) {
  const router = useRouter();
  const [presetId, setPresetId] = useState(presets.find((p) => p.is_default)?.id ?? presets[0]!.id);
  const [chosen, setChosen] = useState<string[]>([]);
  const [useAtlas, setUseAtlas] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const preset = presets.find((p) => p.id === presetId) ?? presets[0]!;
  // Only the areas the preset actually prints. A disabled back is not a missing back,
  // and warning that a design 'will go without back' when the back is switched off is noise.
  const areas = useMemo(() => enabledAreas(preset), [preset]);
  const already = useMemo(() => new Set(drafted), [drafted]);

  /** Say up front which designs go whole, which go part, and which cannot go at all. */
  const plan = useMemo(() => {
    const whole: string[] = [];
    const partial: { id: string; missing: string[] }[] = [];
    const blocked: Skip[] = [];

    for (const id of chosen) {
      const labels = new Set(designs.find((d) => d.id === id)?.artwork_labels ?? []);
      const missing = areas.filter((a) => !labels.has(a));
      if (missing.length === areas.length) {
        blocked.push({ designId: id, reason: `no ${areas.join(' or ')} artwork` });
      } else if (missing.length > 0) {
        partial.push({ id, missing });
      } else {
        whole.push(id);
      }
    }
    return { whole, partial, blocked, pushable: whole.length + partial.length };
  }, [chosen, designs, areas]);

  async function run() {
    setRunning(true);
    setError(null);
    setProgress(null);

    try {
      const planned = await fetch('/api/printify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ designIds: chosen, presetId }),
      });
      const body = (await planned.json()) as {
        batchId?: string;
        queued?: number;
        error?: string;
      };
      if (!planned.ok || !body.batchId) {
        setError(body.error ?? 'Could not start the push.');
        return;
      }
      if (!body.queued) {
        setError('Nothing could be pushed — every design was missing artwork.');
        return;
      }

      setProgress({ total: body.queued, queued: body.queued, done: 0, failed: 0 });

      // One design per request: uploading two multi-megabyte PNGs and creating a product is
      // already most of a minute, so a batch has to be walked rather than done in one call.
      for (let guard = 0; guard < body.queued + 5; guard++) {
        const step = await fetch('/api/printify/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batchId: body.batchId, useAtlas }),
        });
        if (!step.ok) {
          const stepBody = (await step.json().catch(() => null)) as { error?: string } | null;
          setError(stepBody?.error ?? 'A push failed to start.');
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

  return (
    <section className="space-y-4">
      <div className="grid gap-4 md:grid-cols-[1fr_18rem]">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60">
          <header className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
            <h2 className="text-sm font-semibold">
              Designs <span className="font-normal text-zinc-500">{chosen.length}</span>
            </h2>
            {designs.length > 0 ? (
              <button
                className="text-xs text-zinc-400 hover:text-zinc-200"
                onClick={() =>
                  setChosen(chosen.length === designs.length ? [] : designs.map((d) => d.id))
                }
              >
                {chosen.length === designs.length ? 'Clear' : 'Select all'}
              </button>
            ) : null}
          </header>

          {designs.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-zinc-600">
              No designs with artwork yet.
            </p>
          ) : (
            <ul className="max-h-72 overflow-y-auto p-2">
              {designs.map((design) => {
                const labels = new Set(design.artwork_labels);
                const missing = areas.filter((a) => !labels.has(a));
                return (
                  <li key={design.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-zinc-800/60">
                      <input
                        type="checkbox"
                        checked={chosen.includes(design.id)}
                        onChange={() =>
                          setChosen((c) =>
                            c.includes(design.id)
                              ? c.filter((x) => x !== design.id)
                              : [...c, design.id],
                          )
                        }
                      />
                      <span className="min-w-0 flex-1 truncate text-zinc-200">{design.title}</span>
                      {already.has(design.id) ? (
                        <span className="shrink-0 text-[10px] text-emerald-400/80">drafted</span>
                      ) : null}
                      <span
                        className={`shrink-0 text-[11px] ${
                          missing.length === areas.length
                            ? 'text-rose-400'
                            : missing.length > 0
                              ? 'text-amber-500/90'
                              : 'text-zinc-500'
                        }`}
                      >
                        {design.artwork_labels.join(', ') || 'no artwork'}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
          <label className="block space-y-1 text-xs text-zinc-400">
            Preset
            <select
              aria-label="Preset"
              className="field"
              value={presetId}
              onChange={(e) => setPresetId(e.target.value)}
            >
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <p className="text-[11px] leading-relaxed text-zinc-500">
            {preset.shop_title ?? preset.shop_id} · {preset.variants.length} size
            {preset.variants.length === 1 ? '' : 's'} · {areas.join(' + ') || 'no areas'}
          </p>

          <label className="flex items-start gap-2 text-[11px] leading-relaxed text-zinc-400">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={useAtlas}
              disabled={!atlasAvailable}
              onChange={(e) => setUseAtlas(e.target.checked)}
            />
            <span>
              Use the Atlas upscaler <span className="text-zinc-600">$0.01 per placement</span>
              <br />
              <span className="text-zinc-600">
                {atlasAvailable
                  ? 'Crisper edges than the free resize. Worth it for fine lettering, not much else.'
                  : 'Needs ATLAS_CLOUD_API_KEY.'}
              </span>
            </span>
          </label>

          <button
            className="btn-primary w-full"
            onClick={run}
            disabled={running || plan.pushable === 0}
          >
            {running
              ? 'Pushing…'
              : `Make ${plan.pushable} draft${plan.pushable === 1 ? '' : 's'}`}
          </button>

          {progress ? (
            <div className="space-y-1">
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{
                    width: `${((progress.done + progress.failed) / Math.max(1, progress.total)) * 100}%`,
                  }}
                />
              </div>
              <p className="text-[11px] text-zinc-500">
                {progress.done} drafted
                {progress.failed > 0 ? (
                  <span className="text-rose-400"> · {progress.failed} failed</span>
                ) : null}
                {progress.queued > 0 ? ` · ${progress.queued} to go` : ' · finished'}
              </p>
            </div>
          ) : null}

          {plan.partial.length > 0 && !progress ? (
            <p className="text-[11px] leading-relaxed text-amber-500/90">
              {plan.partial.length} design{plan.partial.length === 1 ? '' : 's'} will go without{' '}
              {[...new Set(plan.partial.flatMap((p) => p.missing))].join(' or ')} — those areas
              are left empty, not filled with the other art.
            </p>
          ) : null}

          {plan.blocked.length > 0 && !progress ? (
            <p className="text-[11px] leading-relaxed text-rose-400">
              {plan.blocked.length} design{plan.blocked.length === 1 ? '' : 's'} cannot go: no
              artwork for any of {areas.join(', ')}.
            </p>
          ) : null}

          {error ? <p className="text-xs text-rose-400">{error}</p> : null}

          <p className="border-t border-zinc-800 pt-2 text-[11px] leading-relaxed text-zinc-600">
            Drafts are never published. Review each one in Printify and publish it yourself.
          </p>
        </div>
      </div>
    </section>
  );
}
