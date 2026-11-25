'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RenderCard } from '@/lib/renders';
import { DEFAULT_VIDEO_MODEL } from '@/lib/atlas';
import type { AtlasModel, AtlasField } from '@/lib/atlas';
import type { BudgetState } from '@/lib/budget';
import type { ShotTemplate } from '@/lib/video/data';
import type { FrameMode } from '@/lib/video/frame';
import { thumbUrl } from '@/lib/thumb';

const FRAMINGS: { mode: FrameMode; label: string; hint: string }[] = [
  { mode: 'crop', label: 'Crop', hint: 'Vertical slice centred on the design' },
  { mode: 'pad', label: 'Fill', hint: 'Whole photo, blurred behind' },
  { mode: 'original', label: 'As is', hint: 'Keeps the landscape shape' },
];

/** Fields the app supplies itself, so the form must not offer them twice. */
const APP_CONTROLLED = new Set(['image', 'last_image', 'duration', 'prompt', 'model']);

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Turn one render into a vertical clip.
 *
 * Built around the two things that decide whether a clip is worth its cost: what is in the
 * frame, and what the frame costs. The framing is previewed at full size before anything
 * runs, because most image-to-video models take their aspect ratio from the frame they are
 * given — hand one a landscape photo and the clip comes back landscape.
 */
export function VideoStudio({
  renders,
  models,
  shots,
  budget,
}: {
  renders: RenderCard[];
  models: AtlasModel[];
  shots: ShotTemplate[];
  budget: BudgetState;
}) {
  const router = useRouter();

  const [renderId, setRenderId] = useState(renders[0]?.id ?? '');
  const [mode, setMode] = useState<FrameMode>('crop');
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);

  // The tested default when it is on offer, else whatever the catalogue leads with.
  const [modelId, setModelId] = useState(
    models.find((m) => m.model === DEFAULT_VIDEO_MODEL)?.model ?? models[0]?.model ?? '',
  );
  const [duration, setDuration] = useState(5);
  const [prompt, setPrompt] = useState('');
  const [fields, setFields] = useState<AtlasField[]>([]);
  const [promptRequired, setPromptRequired] = useState(false);
  const [ratioField, setRatioField] = useState<AtlasField | null>(null);
  const [durations, setDurations] = useState<number[]>([]);
  const [params, setParams] = useState<Record<string, unknown>>({});

  const [status, setStatus] = useState<'idle' | 'starting' | 'running' | 'done' | 'failed'>('idle');
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const model = useMemo(() => models.find((m) => m.model === modelId), [models, modelId]);
  const render = useMemo(() => renders.find((r) => r.id === renderId), [renders, renderId]);

  // The same arithmetic the server redoes before charging anything, so what is shown here
  // and what is paid cannot drift apart without the request being refused.
  // Rounded up for the same reason it is on the server: three models cost less than a cent a
  // clip, and rounding those to zero would offer them as free and never move the ceiling.
  const listedUsd = model ? model.basePriceUsd * (model.priceUnit === 'second' ? duration : 1) : 0;
  const costCents = Math.ceil(listedUsd * 100);
  const unpriced = Boolean(model && model.basePriceUsd === 0);
  const overBudget = costCents > budget.remainingCents;

  const frameUrl =
    renderId &&
    `/api/videos/frame?renderId=${renderId}&mode=${mode}&offsetX=${offsetX}&offsetY=${offsetY}&height=720`;

  // The chosen model's own fields, minus the ones this screen controls itself.
  useEffect(() => {
    if (!modelId) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/models/fields?model=${encodeURIComponent(modelId)}`);
        const body = (await response.json()) as { fields?: AtlasField[]; required?: string[] };
        if (cancelled) return;
        const all = body.fields ?? [];
        const offered = all.filter((f) => !APP_CONTROLLED.has(f.name));
        setFields(offered);

        // Length is not a free number. Most models publish the exact values they take —
        // Veo 3.1 accepts only 4, 6 or 8, and sending 5 is rejected outright with
        // "Request parameters are invalid". Offer what the model actually allows.
        const allowed = (all.find((f) => f.name === 'duration')?.enum ?? [])
          .map(Number)
          .filter((n) => Number.isFinite(n) && n > 0)
          .sort((a, b) => a - b);
        setDurations(allowed);
        if (allowed.length > 0) {
          setDuration((current) =>
            allowed.includes(current)
              ? current
              : allowed.reduce((best, n) =>
                  Math.abs(n - current) < Math.abs(best - current) ? n : best,
                ),
          );
        }
        setPromptRequired((body.required ?? []).includes('prompt'));
        setRatioField(offered.find((f) => f.name === 'aspect_ratio' || f.name === 'ratio') ?? null);
        setParams(
          Object.fromEntries(
            offered.filter((f) => f.default !== undefined).map((f) => [f.name, f.default]),
          ),
        );
      } catch {
        if (!cancelled) {
          setFields([]);
          setPromptRequired(false);
          setRatioField(null);
          setDurations([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [modelId]);

  function applyShot(shot: ShotTemplate) {
    setPrompt(shot.prompt);
    setDuration(shot.duration_s);
    setMode(shot.frame_mode);
    if (models.some((m) => m.model === shot.model)) setModelId(shot.model);
    setParams(shot.params ?? {});
  }

  async function generate() {
    setStatus('starting');
    setError(null);
    setClipUrl(null);
    try {
      const started = await fetch('/api/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          renderId,
          model: modelId,
          prompt,
          durationSeconds: duration,
          frameMode: mode,
          offsetX,
          offsetY,
          params,
          quotedCents: costCents,
        }),
      });
      const body = (await started.json()) as { id?: string; error?: string };
      if (!started.ok || !body.id) {
        setError(body.error ?? 'Could not start the clip.');
        setStatus('failed');
        return;
      }

      setStatus('running');

      // Atlas quotes 30 seconds to 3 minutes for video, so this polls patiently rather than
      // holding a request open.
      for (let attempt = 0; attempt < 90; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 4000));
        const poll = await fetch(`/api/videos/${body.id}`);
        const state = (await poll.json()) as { status: string; url?: string; error?: string };
        if (state.status === 'done') {
          setClipUrl(state.url ?? null);
          setStatus('done');
          router.refresh();
          return;
        }
        if (state.status === 'failed') {
          setError(state.error ?? 'The clip failed.');
          setStatus('failed');
          router.refresh();
          return;
        }
      }
      setError('It is taking much longer than expected. It will appear below if it finishes.');
      setStatus('idle');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setStatus('failed');
    }
  }

  const busy = status === 'starting' || status === 'running';
  // Measured across 40 of the image-to-video models: 23 insist on a prompt and 17 do not.
  // Catching it here beats submitting and relaying Atlas's rejection.
  const missingPrompt = promptRequired && prompt.trim().length === 0;
  const modelRatios = ratioField?.enum ?? [];
  // Only worth suggesting when the model actually offers a vertical option. A model whose
  // only choice is `adaptive` cannot be asked for 9:16, and telling you to pick one would be
  // advice for a control that is not there.
  const canGoVertical = modelRatios.includes('9:16');
  const chosenRatio = params[ratioField?.name ?? ''] ?? ratioField?.default;
  const vertical = chosenRatio === '9:16';

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
      <div className="space-y-4">
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/60">
          <header className="border-b border-zinc-800 px-3 py-2">
            <h2 className="text-sm font-semibold">Render</h2>
          </header>
          <div className="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto p-2 sm:grid-cols-5">
            {renders.map((r) => (
              <button
                key={r.id}
                onClick={() => setRenderId(r.id)}
                className={`overflow-hidden rounded border ${
                  r.id === renderId ? 'border-zinc-300' : 'border-zinc-800 hover:border-zinc-600'
                }`}
                title={`${r.design_title} × ${r.mockup_name}`}
              >
                {/* Signed, expiring URLs — next/image would cache them past their lifetime. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={thumbUrl(r.output_path, 400)!}
                  alt={r.design_title}
                  className="aspect-[4/3] w-full object-cover"
                />
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">Framing</h2>
            <div className="flex gap-1">
              {FRAMINGS.map((f) => (
                <button
                  key={f.mode}
                  className={`rounded px-2 py-1 text-[11px] ${
                    mode === f.mode
                      ? 'bg-zinc-200 text-zinc-900'
                      : 'border border-zinc-800 text-zinc-400 hover:border-zinc-600'
                  }`}
                  onClick={() => setMode(f.mode)}
                  title={f.hint}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-zinc-600">
              {FRAMINGS.find((f) => f.mode === mode)?.hint}
            </p>
          </div>

          <div className="flex gap-4">
            <div className="w-44 shrink-0 overflow-hidden rounded border border-zinc-800 bg-zinc-950">
              {frameUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  key={frameUrl}
                  src={frameUrl}
                  alt="The frame that will be sent"
                  className="w-full"
                />
              ) : null}
            </div>

            <div className="flex-1 space-y-2 text-[11px] text-zinc-500">
              <p>
                This exact frame is what gets sent. Most models take their shape from it, so a
                landscape frame returns a landscape clip.
              </p>
              {/*
                Worth saying rather than preventing. Handing over the whole landscape scene
                and letting the model crop to a vertical aspect ratio is a real technique and
                can frame better than cropping here first, because the model sees everything
                instead of a slice chosen around the print area. What you give up is the
                preview: only the model knows where it will cut.
              */}
              {canGoVertical && mode !== 'crop' ? (
                <p className={vertical ? 'text-sky-400/90' : undefined}>
                  {model?.displayName} can crop to its own shape:{' '}
                  {vertical
                    ? `aspect_ratio is ${String(chosenRatio)}, so it will cut this down to vertical itself — you just will not see where until it is made.`
                    : `set aspect_ratio to 9:16 in its settings and it will cut this down to vertical itself.`}
                </p>
              ) : null}
              {ratioField && !canGoVertical && mode !== 'crop' ? (
                <p className="text-amber-500/90">
                  This model only offers <code>adaptive</code>, which copies the frame&rsquo;s shape.
                  Crop here or the clip comes back landscape.
                </p>
              ) : null}
              {mode === 'crop' ? (
                <>
                  <label className="flex items-center gap-2">
                    <span className="w-12">across</span>
                    <input
                      type="range"
                      aria-label="Crop across"
                      min={-1}
                      max={1}
                      step={0.02}
                      value={offsetX}
                      onChange={(e) => setOffsetX(Number(e.target.value))}
                      className="flex-1"
                    />
                  </label>
                  <label className="flex items-center gap-2">
                    <span className="w-12">down</span>
                    <input
                      type="range"
                      aria-label="Crop down"
                      min={-1}
                      max={1}
                      step={0.02}
                      value={offsetY}
                      onChange={(e) => setOffsetY(Number(e.target.value))}
                      className="flex-1"
                    />
                  </label>
                  <button
                    className="text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
                    onClick={() => {
                      setOffsetX(0);
                      setOffsetY(0);
                    }}
                  >
                    centre on the design
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </section>

        <section className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
          <h2 className="text-sm font-semibold">
            Motion{' '}
            <span
              className={`font-normal ${promptRequired && !prompt.trim() ? 'text-amber-400' : 'text-zinc-600'}`}
            >
              {promptRequired ? 'required by this model' : 'optional for this model'}
            </span>
          </h2>
          <textarea
            aria-label="Motion prompt"
            className="field h-20 resize-y text-xs"
            placeholder="What moves: e.g. she turns slightly toward the camera, soft natural light, handheld"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          {shots.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="text-zinc-600">Saved shots</span>
              {shots.map((shot) => (
                <button
                  key={shot.id}
                  className="rounded border border-zinc-800 px-1.5 py-0.5 text-zinc-300 hover:border-zinc-600"
                  onClick={() => applyShot(shot)}
                >
                  {shot.name}
                </button>
              ))}
            </div>
          ) : null}
        </section>
      </div>

      <aside className="space-y-3 self-start rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-xs">
        <label className="block space-y-1 text-zinc-400">
          Model <span className="text-zinc-600">{models.length} available, cheapest first</span>
          <select
            aria-label="Video model"
            className="field"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
          >
            {models.map((m) => (
              <option key={m.model} value={m.model}>
                {m.displayName} — {m.basePriceUsd > 0 ? `$${m.basePriceUsd.toFixed(3)}` : 'price not listed'}
                {m.priceUnit === 'second' ? '/s' : ''}
                {m.model === DEFAULT_VIDEO_MODEL ? ' · tested' : ''}
              </option>
            ))}
          </select>
        </label>

        {modelId === DEFAULT_VIDEO_MODEL ? (
          <p className="text-[11px] leading-relaxed text-zinc-500">
            Picked by running nine models over the same frame: it kept the print square and
            sharp, kept hands off the graphic, and gives 5 seconds rather than 4.
          </p>
        ) : null}

        {model?.profile ? (
          <p className="text-[11px] leading-relaxed text-zinc-600">{model.profile}</p>
        ) : null}

        <label className="block space-y-1 text-zinc-400">
          Seconds
          {durations.length > 0 ? (
            <select
              aria-label="Seconds"
              className="field"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            >
              {durations.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="number"
              aria-label="Seconds"
              className="field"
              min={1}
              max={60}
              value={duration}
              onChange={(e) => setDuration(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
            />
          )}
        </label>

        {fields.length > 0 ? (
          <details className="rounded border border-zinc-800 p-2">
            <summary className="cursor-pointer text-zinc-400">
              {model?.displayName} settings <span className="text-zinc-600">{fields.length}</span>
            </summary>
            <div className="mt-2 space-y-2">
              {fields.map((field) => (
                <label key={field.name} className="block space-y-0.5 text-zinc-500" title={field.description}>
                  {field.name}
                  {field.enum ? (
                    <select
                      aria-label={field.name}
                      className="field py-1"
                      value={String(params[field.name] ?? field.default ?? '')}
                      onChange={(e) => setParams({ ...params, [field.name]: e.target.value })}
                    >
                      {field.enum.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : field.type === 'boolean' ? (
                    <input
                      type="checkbox"
                      aria-label={field.name}
                      className="ml-2"
                      checked={Boolean(params[field.name] ?? field.default)}
                      onChange={(e) => setParams({ ...params, [field.name]: e.target.checked })}
                    />
                  ) : (
                    <input
                      aria-label={field.name}
                      className="field py-1"
                      value={String(params[field.name] ?? '')}
                      onChange={(e) =>
                        setParams({
                          ...params,
                          [field.name]:
                            field.type === 'integer' || field.type === 'number'
                              ? Number(e.target.value)
                              : e.target.value,
                        })
                      }
                    />
                  )}
                </label>
              ))}
            </div>
          </details>
        ) : null}

        <div className="space-y-1 border-t border-zinc-800 pt-2">
          <p className="flex items-baseline justify-between">
            <span className="text-zinc-400">This clip</span>
            <span className={overBudget ? 'text-rose-400' : 'text-zinc-100'}>
              {unpriced ? 'price not listed' : `$${listedUsd.toFixed(3)}`}
            </span>
          </p>
          <p className="flex items-baseline justify-between text-[11px] text-zinc-600">
            <span>Left this month</span>
            <span className={budget.warning ? 'text-amber-400' : undefined}>
              {usd(budget.remainingCents)} of {usd(budget.budgetCents)}
            </span>
          </p>
          {model?.priceUnit === 'second' ? (
            <p className="text-[11px] text-zinc-600">
              Charged per second, so {duration}s costs {duration}× the listed rate.
            </p>
          ) : null}
          {!unpriced && costCents > listedUsd * 100 ? (
            <p className="text-[11px] text-zinc-600">
              Counted as {usd(costCents)} against the month — the ceiling works in whole cents.
            </p>
          ) : null}
          {unpriced ? (
            <p className="text-[11px] text-amber-500/90">
              Atlas publishes no price for this model, so nothing can be quoted. Pick another
              unless you know what it costs.
            </p>
          ) : null}
        </div>

        <button
          className="btn-primary w-full"
          onClick={generate}
          disabled={busy || !renderId || !modelId || overBudget || unpriced || missingPrompt}
        >
          {status === 'starting'
            ? 'Starting…'
            : status === 'running'
              ? 'Generating…'
              : `Make the clip · ${unpriced ? '?' : `$${listedUsd.toFixed(3)}`}`}
        </button>

        {missingPrompt ? (
          <p className="text-[11px] text-amber-500/90">
            {model?.displayName} needs a motion prompt. Describe what moves — most models
            will not run without one.
          </p>
        ) : null}

        {overBudget ? (
          <p className="text-[11px] text-rose-400">
            That would go past the month&rsquo;s ceiling. Raise MONTHLY_BUDGET_USD to continue.
          </p>
        ) : null}

        {status === 'running' ? (
          <p className="text-[11px] text-zinc-500">
            Atlas takes 30 seconds to 3 minutes. You can leave this page — the clip appears
            below when it is done.
          </p>
        ) : null}

        {clipUrl ? (
          <video
            src={clipUrl}
            controls
            autoPlay
            loop
            muted
            playsInline
            className="w-full rounded border border-zinc-800"
          />
        ) : null}

        {error ? <p className="text-[11px] text-rose-400">{error}</p> : null}

        {render ? (
          <p className="border-t border-zinc-800 pt-2 text-[11px] text-zinc-600">
            {render.design_title} × {render.mockup_name}
          </p>
        ) : null}
      </aside>
    </div>
  );
}
