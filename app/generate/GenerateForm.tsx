'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AtlasField, AtlasModel } from '@/lib/atlas';
import type { Prompt } from '@/lib/queries';
import type { Collection, DesignCard } from '@/lib/types';
import { COMMON_LABELS, PRIMARY_LABEL } from '@/lib/artworks';
import { fillSlots, slotsIn } from '@/lib/queries';

type Phase = 'idle' | 'starting' | 'generating' | 'done' | 'error';

/** Fields worth showing by default; the rest sit behind "More settings". */
const PROMINENT = new Set(['size', 'quality', 'background', 'output_format', 'aspect_ratio']);

export function GenerateForm({
  models,
  prompts,
  collections,
  designs,
  defaultModel,
  remainingCents,
}: {
  models: AtlasModel[];
  prompts: Prompt[];
  collections: Collection[];
  designs: DesignCard[];
  defaultModel: string;
  remainingCents: number;
}) {
  const router = useRouter();

  const [modelId, setModelId] = useState(defaultModel);
  const [search, setSearch] = useState('');
  const [promptId, setPromptId] = useState('');
  const [body, setBody] = useState('');
  const [slotValues, setSlotValues] = useState<Record<string, string>>({});
  const [count, setCount] = useState(2);
  const [collectionId, setCollectionId] = useState('');
  const [tags, setTags] = useState('');
  const [label, setLabel] = useState<string>(PRIMARY_LABEL);
  const [targetDesignId, setTargetDesignId] = useState('');

  const [fields, setFields] = useState<AtlasField[]>([]);
  const [params, setParams] = useState<Record<string, string>>({});
  const [loadingFields, setLoadingFields] = useState(false);

  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');

  const model = useMemo(() => models.find((m) => m.model === modelId), [models, modelId]);
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const matched = term
      ? models.filter(
          (m) => m.displayName.toLowerCase().includes(term) || m.model.toLowerCase().includes(term),
        )
      : models;
    // Always keep the selected model selectable, even when it is filtered out.
    return model && !matched.some((m) => m.model === model.model) ? [model, ...matched] : matched;
  }, [models, search, model]);

  const slots = useMemo(() => slotsIn(body), [body]);
  const finalPrompt = useMemo(() => fillSlots(body, slotValues), [body, slotValues]);
  const estimateCents = Math.round((model?.basePriceUsd ?? 0) * count * 100);
  const overBudget = estimateCents > remainingCents;

  /**
   * Settings known to push the real charge well above the listed base price.
   *
   * Not a formula — Atlas publishes no multiplier — just the two knobs that were measured
   * turning $0.014 into $0.16168: a quality tier above the default, and a size with a big
   * pixel count.
   */
  const raisesPrice =
    ['high', 'xhigh', 'max', 'ultra'].includes(String(params.quality ?? '').toLowerCase()) ||
    (() => {
      const match = /(\d{3,5})\s*[x×]\s*(\d{3,5})/.exec(String(params.size ?? ''));
      return match ? Number(match[1]) * Number(match[2]) > 2_000_000 : false;
    })();

  // Load the chosen model's own fields and seed the parameter defaults.
  useEffect(() => {
    let cancelled = false;
    setLoadingFields(true);
    fetch(`/api/models/fields?model=${encodeURIComponent(modelId)}`)
      .then((r) => r.json())
      .then((data: { fields?: AtlasField[] }) => {
        if (cancelled) return;
        const next = data.fields ?? [];
        setFields(next);
        setParams(
          Object.fromEntries(
            next
              .filter((f) => f.default !== undefined && f.name !== 'n')
              .map((f) => [f.name, String(f.default)]),
          ),
        );
      })
      .catch(() => {
        if (!cancelled) setFields([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingFields(false);
      });
    return () => {
      cancelled = true;
    };
  }, [modelId]);

  function applyPrompt(id: string) {
    setPromptId(id);
    const chosen = prompts.find((p) => p.id === id);
    if (chosen) {
      setBody(chosen.body);
      setSlotValues({});
      if (chosen.target_model && models.some((m) => m.model === chosen.target_model)) {
        setModelId(chosen.target_model);
      }
    }
  }

  async function generate() {
    setPhase('starting');
    setMessage('');

    const typed: Record<string, unknown> = {};
    for (const field of fields) {
      const raw = params[field.name];
      if (raw === undefined || raw === '') continue;
      typed[field.name] = field.type === 'integer' || field.type === 'number' ? Number(raw) : raw;
    }

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: finalPrompt,
          model: modelId,
          count,
          params: typed,
          collectionId: collectionId || null,
          promptId: promptId || null,
          label,
          designId: targetDesignId || null,
          tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        }),
      });
      const started = (await response.json()) as {
        error?: string;
        designId?: string;
        predictionId?: string;
      };
      if (!response.ok || !started.predictionId) {
        setPhase('error');
        setMessage(started.error ?? 'Starting the generation failed.');
        return;
      }

      setPhase('generating');
      setMessage('Atlas is working. This usually takes about twenty seconds.');

      // Poll until it settles. The job is recorded server-side, so a closed tab only means
      // the images are collected on the next poll rather than lost.
      for (let attempt = 0; attempt < 100; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const poll = await fetch(`/api/generate/${started.predictionId}`);
        const result = (await poll.json()) as { status?: string; error?: string };

        if (result.status === 'completed') {
          setPhase('done');
          router.push(`/designs/${started.designId}`);
          return;
        }
        if (result.status === 'failed') {
          setPhase('error');
          setMessage(result.error ?? 'The generation failed.');
          return;
        }
      }
      setPhase('error');
      setMessage('Still not finished after five minutes. Check the design later — the job is saved.');
    } catch (error) {
      setPhase('error');
      setMessage((error as Error).message);
    }
  }

  const busy = phase === 'starting' || phase === 'generating';

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="space-y-4">
        <section className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Prompt</h2>
            {prompts.length > 0 ? (
              <select
                className="field w-auto py-1 text-xs"
                value={promptId}
                onChange={(e) => applyPrompt(e.target.value)}
              >
                <option value="">Start from scratch</option>
                {prompts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>

          <textarea
            className="field min-h-28"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Light cream retro lettering reading GHOST MODE, flat vector, transparent background"
          />

          {slots.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {slots.map((slot) => (
                <label key={slot} className="space-y-1 text-xs text-zinc-400">
                  {slot}
                  <input
                    className="field"
                    value={slotValues[slot] ?? ''}
                    onChange={(e) => setSlotValues((v) => ({ ...v, [slot]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
          ) : null}

          {slots.length > 0 ? (
            <p className="rounded border border-zinc-800 bg-zinc-950 p-2 text-[11px] leading-relaxed text-zinc-400">
              {finalPrompt}
            </p>
          ) : null}

          <p className="text-[11px] leading-relaxed text-zinc-600">
            You print on black, so ask for light colours and a transparent background. Dark art
            disappears on a dark tee.
          </p>
        </section>

        <section className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
          <h2 className="text-sm font-semibold">Model</h2>
          <input
            className="field"
            placeholder={`Search ${models.length} text-to-image models…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="field"
            size={6}
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
          >
            {visible.map((m) => (
              <option key={m.model} value={m.model}>
                {m.displayName} — ${m.basePriceUsd.toFixed(3)}
              </option>
            ))}
          </select>
          {model ? (
            <p className="text-[11px] leading-relaxed text-zinc-500">{model.profile}</p>
          ) : null}
        </section>

        <section className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
          <h2 className="text-sm font-semibold">
            Settings{' '}
            {loadingFields ? <span className="text-xs font-normal text-zinc-500">loading…</span> : null}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {fields
              .filter((f) => PROMINENT.has(f.name))
              .map((field) => (
                <Field key={field.name} field={field} params={params} setParams={setParams} />
              ))}
          </div>
          {fields.some((f) => !PROMINENT.has(f.name) && f.name !== 'n') ? (
            <details>
              <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-300">
                More settings
              </summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {fields
                  .filter((f) => !PROMINENT.has(f.name) && f.name !== 'n')
                  .map((field) => (
                    <Field key={field.name} field={field} params={params} setParams={setParams} />
                  ))}
              </div>
            </details>
          ) : null}
        </section>
      </div>

      <aside className="space-y-4">
        <section className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
          <label className="block space-y-1 text-xs text-zinc-400">
            How many
            <input
              type="number"
              min={1}
              max={10}
              className="field"
              value={count}
              onChange={(e) => setCount(Math.min(10, Math.max(1, Number(e.target.value) || 1)))}
            />
          </label>
          <label className="block space-y-1 text-xs text-zinc-400">
            Placement
            <input
              name="placement"
              className="field"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              list="generate-placements"
              maxLength={40}
            />
            <datalist id="generate-placements">
              {COMMON_LABELS.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
          </label>

          <label className="block space-y-1 text-xs text-zinc-400">
            Add to
            <select
              name="targetDesign"
              className="field"
              value={targetDesignId}
              onChange={(e) => setTargetDesignId(e.target.value)}
            >
              <option value="">A new design</option>
              {designs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title} ({d.artwork_labels.join(', ')})
                </option>
              ))}
            </select>
          </label>

          {targetDesignId ? (
            <p className="text-[11px] leading-relaxed text-zinc-600">
              The result becomes this design&rsquo;s {label || 'front'} artwork, replacing any
              it already has for that placement.
            </p>
          ) : (
            <label className="block space-y-1 text-xs text-zinc-400">
              Collection
              <select className="field" value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
                <option value="">None</option>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block space-y-1 text-xs text-zinc-400">
            Tags
            <input
              className="field"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="halloween, retro"
            />
          </label>
        </section>

        <section className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-zinc-400">Estimate</span>
            <span className="font-semibold">
              from ${(estimateCents / 100).toFixed(2)}
            </span>
          </div>
          {/*
            "From", not a price. Measured on a real run: two 2160x3840 images at quality
            `high` were quoted at $0.014 from the listed base price and charged $0.16168 —
            eleven times more. Size and quality multiply the base by a factor Atlas does not
            publish, so the only honest figure arrives with the finished prediction, and
            that is what the ledger records.
          */}
          <p className="text-[11px] leading-relaxed text-zinc-600">
            Atlas&rsquo;s listed base price for {count} image{count === 1 ? '' : 's'} — a floor,
            not a quote.{' '}
            {raisesPrice ? (
              <span className="text-amber-500/90">
                A large size or a high quality tier can multiply it several times over. The real
                charge is recorded against your month once the images arrive.
              </span>
            ) : (
              <>The real charge is recorded against your month once the images arrive.</>
            )}
          </p>
          {overBudget ? (
            <p className="text-xs text-rose-400">
              Over what is left of this month&rsquo;s budget (${(remainingCents / 100).toFixed(2)}).
            </p>
          ) : null}

          <button
            className="btn-primary w-full"
            disabled={busy || !body.trim() || !model || overBudget}
            onClick={generate}
          >
            {phase === 'starting'
              ? 'Starting…'
              : phase === 'generating'
                ? 'Generating…'
                : `Generate ${count} image${count === 1 ? '' : 's'}`}
          </button>

          {message ? (
            <p className={`text-xs ${phase === 'error' ? 'text-rose-400' : 'text-zinc-400'}`}>
              {message}
            </p>
          ) : null}
        </section>
      </aside>
    </div>
  );
}

function Field({
  field,
  params,
  setParams,
}: {
  field: AtlasField;
  params: Record<string, string>;
  setParams: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  const value = params[field.name] ?? '';
  const set = (next: string) => setParams((p) => ({ ...p, [field.name]: next }));

  return (
    <label className="space-y-1 text-xs text-zinc-400" title={field.description}>
      {field.name.replaceAll('_', ' ')}
      {field.enum ? (
        <select className="field" value={value} onChange={(e) => set(e.target.value)}>
          {field.enum.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="field"
          type={field.type === 'integer' || field.type === 'number' ? 'number' : 'text'}
          value={value}
          onChange={(e) => set(e.target.value)}
        />
      )}
    </label>
  );
}
