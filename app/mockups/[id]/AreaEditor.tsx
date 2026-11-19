'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { saveArea } from '../actions';
import { DEFAULT_OPTIONS, type RenderOptions } from '@/lib/render/options';
import type { MockupTemplate, NormQuad } from '@/lib/mockups';
import type { DesignCard } from '@/lib/types';

const CORNER_LABELS = ['top left', 'top right', 'bottom right', 'bottom left'] as const;

const SLIDERS: { key: keyof RenderOptions; label: string; min: number; max: number; step: number; hint: string }[] = [
  { key: 'shadingStrength', label: 'Folds', min: 0, max: 1.5, step: 0.05, hint: 'How strongly the garment’s drape shades the print' },
  { key: 'textureStrength', label: 'Weave', min: 0, max: 1, step: 0.05, hint: 'Fabric grain in the ink. Too high looks like glitter' },
  { key: 'bleed', label: 'Garment bleed', min: 0, max: 0.3, step: 0.01, hint: 'Shirt colour showing through the ink' },
  { key: 'inkOpacity', label: 'Ink opacity', min: 0.5, max: 1, step: 0.01, hint: 'Ink is never perfectly opaque' },
  { key: 'featherPx', label: 'Edge feather', min: 0, max: 5, step: 0.1, hint: 'Printed edges are not razor sharp' },
];

export function AreaEditor({
  template,
  corners: initialCorners,
  designs,
}: {
  template: MockupTemplate;
  corners: NormQuad;
  designs: DesignCard[];
}) {
  const [corners, setCorners] = useState<NormQuad>(initialCorners);
  const [options, setOptions] = useState<RenderOptions>({
    ...DEFAULT_OPTIONS,
    ...template.render_options,
  });
  const [name, setName] = useState(template.name);
  const [designId, setDesignId] = useState(designs[0]?.id ?? '');
  const [preview, setPreview] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  const frameRef = useRef<HTMLDivElement>(null);
  const previewUrlRef = useRef<string | null>(null);

  // Revoke the previous object URL whenever a new render replaces it.
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  const pointFromEvent = useCallback((e: PointerEvent | React.PointerEvent) => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  }, []);

  useEffect(() => {
    if (dragging === null) return;

    const move = (e: PointerEvent) => {
      const p = pointFromEvent(e);
      if (!p) return;
      setCorners((prev) => prev.map((c, i) => (i === dragging ? p : c)) as NormQuad);
    };
    const up = () => setDragging(null);

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [dragging, pointFromEvent]);

  async function render() {
    if (!designId) {
      setError('Add a design with artwork first — there is nothing to place.');
      return;
    }
    setRendering(true);
    setError(null);
    try {
      const response = await fetch(`/api/mockups/${template.id}/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ designId, corners, options, maxEdge: 1100 }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? 'Rendering failed.');
        return;
      }
      const blob = await response.blob();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = URL.createObjectURL(blob);
      setPreview(previewUrlRef.current);
      setShowPreview(true);
      setMessage(
        `Garment ${response.headers.get('X-Garment') ?? '?'} · baseline ${response.headers.get('X-Base-Luma') ?? '?'}`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRendering(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    const result = await saveArea(template.id, { corners, options, name });
    if (!result.ok) setError(result.error);
    else setMessage('Saved.');
    setSaving(false);
  }

  const polygon = corners.map((c) => `${c.x * 100},${c.y * 100}`).join(' ');

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="space-y-3">
        <div
          ref={frameRef}
          className="relative select-none overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900"
          style={{ touchAction: 'none' }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={(showPreview && preview) || template.url || ''}
            alt={template.name}
            className="block w-full"
            draggable={false}
          />

          {/* The marked quad. Hidden while showing a render so it does not obscure the result. */}
          {!(showPreview && preview) ? (
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="pointer-events-none absolute inset-0 h-full w-full"
            >
              <polygon
                points={polygon}
                fill="rgba(59,130,246,0.12)"
                stroke="rgb(96,165,250)"
                strokeWidth="0.3"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          ) : null}

          {!(showPreview && preview)
            ? corners.map((c, i) => (
                <button
                  key={i}
                  aria-label={`Print area ${CORNER_LABELS[i]} corner`}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    setDragging(i);
                  }}
                  className={`absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-white shadow
                             ${dragging === i ? 'scale-125 bg-blue-400' : 'bg-blue-500'}`}
                  style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}
                />
              ))
            : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-primary" onClick={render} disabled={rendering}>
            {rendering ? 'Rendering…' : 'Render preview'}
          </button>
          {preview ? (
            <button className="btn" onClick={() => setShowPreview((v) => !v)}>
              {showPreview ? 'Show corners' : 'Show render'}
            </button>
          ) : null}
          <select
            className="field w-auto py-1.5 text-xs"
            value={designId}
            onChange={(e) => setDesignId(e.target.value)}
          >
            {designs.length === 0 ? <option value="">No designs with artwork</option> : null}
            {designs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
        </div>

        {error ? <p className="text-xs text-rose-400">{error}</p> : null}
        {message && !error ? <p className="text-xs text-zinc-500">{message}</p> : null}

        <p className="text-[11px] leading-relaxed text-zinc-600">
          Drag the four corners onto the area the print should cover, following the shirt
          rather than the screen — a corner pushed into a fold is what makes the result sit in
          the fabric instead of floating on it.
        </p>
      </div>

      <aside className="space-y-4">
        <section className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
          <label className="block space-y-1 text-xs text-zinc-400">
            Name
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </label>
          {template.garment_color ? (
            <dl className="space-y-1 text-xs">
              <div className="flex items-center justify-between">
                <dt className="text-zinc-500">Measured garment</dt>
                <dd className="flex items-center gap-1.5 text-zinc-300">
                  <span
                    className="inline-block h-3 w-3 rounded-sm border border-zinc-700"
                    style={{ background: template.garment_color }}
                  />
                  {template.garment_color}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-zinc-500">Baseline luminance</dt>
                <dd className="text-zinc-300">{template.base_luma ?? '—'}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-[11px] text-zinc-600">
              Save the area to measure this garment&rsquo;s colour and baseline.
            </p>
          )}
        </section>

        <section className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
          <h2 className="text-sm font-semibold">Ink</h2>
          {SLIDERS.map((s) => (
            <label key={s.key} className="block space-y-1 text-xs text-zinc-400" title={s.hint}>
              <span className="flex items-baseline justify-between">
                {s.label}
                <span className="text-zinc-500">{options[s.key].toFixed(2)}</span>
              </span>
              <input
                type="range"
                className="w-full"
                min={s.min}
                max={s.max}
                step={s.step}
                value={options[s.key]}
                onChange={(e) =>
                  setOptions((o) => ({ ...o, [s.key]: Number(e.target.value) }))
                }
              />
            </label>
          ))}
          <button className="btn w-full" onClick={() => setOptions({ ...DEFAULT_OPTIONS })}>
            Reset to defaults
          </button>
        </section>

        <button className="btn-primary w-full" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save print area'}
        </button>
      </aside>
    </div>
  );
}
