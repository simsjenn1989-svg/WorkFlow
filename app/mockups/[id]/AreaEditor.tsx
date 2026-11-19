'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { saveAreas } from '../actions';
import { DEFAULT_OPTIONS, type RenderOptions } from '@/lib/render/options';
import { defaultCornersFor, type MockupTemplate, type NormQuad, type PrintArea } from '@/lib/mockups';
import type { DesignCard } from '@/lib/types';

const CORNER_LABELS = ['top left', 'top right', 'bottom right', 'bottom left'] as const;

const SLIDERS: { key: keyof RenderOptions; label: string; min: number; max: number; step: number; hint: string }[] = [
  { key: 'shadingStrength', label: 'Folds', min: 0, max: 1.5, step: 0.05, hint: 'How strongly the garment’s drape shades the print' },
  { key: 'textureStrength', label: 'Weave', min: 0, max: 1, step: 0.05, hint: 'Fabric grain in the ink. Too high looks like glitter' },
  { key: 'bleed', label: 'Garment bleed', min: 0, max: 0.3, step: 0.01, hint: 'Shirt colour showing through the ink' },
  { key: 'inkOpacity', label: 'Ink opacity', min: 0.5, max: 1, step: 0.01, hint: 'Ink is never perfectly opaque' },
  { key: 'featherPx', label: 'Edge feather', min: 0, max: 5, step: 0.1, hint: 'Printed edges are not razor sharp' },
];

const AREA_COLOURS = ['96,165,250', '244,114,182', '52,211,153', '251,191,36', '167,139,250', '248,113,113'];

type EditableArea = PrintArea & { designId: string };

export function AreaEditor({
  template,
  designs,
}: {
  template: MockupTemplate;
  designs: DesignCard[];
}) {
  const [areas, setAreas] = useState<EditableArea[]>(() =>
    (template.print_areas.length > 0
      ? template.print_areas
      : [{ id: crypto.randomUUID(), label: 'front', corners: defaultCornersFor(0) }]
    ).map((a) => ({ ...a, designId: designs[0]?.id ?? '' })),
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [options, setOptions] = useState<RenderOptions>({
    ...DEFAULT_OPTIONS,
    ...template.render_options,
  });
  const [name, setName] = useState(template.name);
  const [preview, setPreview] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ area: number; corner: number } | null>(null);

  const frameRef = useRef<HTMLDivElement>(null);
  const previewUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  const pointFromEvent = useCallback((e: PointerEvent) => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  }, []);

  useEffect(() => {
    if (!dragging) return;

    const move = (e: PointerEvent) => {
      const p = pointFromEvent(e);
      if (!p) return;
      setAreas((prev) =>
        prev.map((area, ai) =>
          ai !== dragging.area
            ? area
            : {
                ...area,
                corners: area.corners.map((c, ci) => (ci === dragging.corner ? p : c)) as NormQuad,
              },
        ),
      );
    };
    const up = () => setDragging(null);

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [dragging, pointFromEvent]);

  function addArea() {
    setAreas((prev) => {
      const index = prev.length;
      const label = index === 1 ? 'back' : `area ${index + 1}`;
      setActiveIndex(index);
      return [
        ...prev,
        {
          id: crypto.randomUUID(),
          label,
          corners: defaultCornersFor(index),
          designId: designs[0]?.id ?? '',
        },
      ];
    });
  }

  function removeArea(index: number) {
    setAreas((prev) => prev.filter((_, i) => i !== index));
    setActiveIndex((i) => Math.max(0, i >= index ? i - 1 : i));
  }

  async function render() {
    if (areas.some((a) => !a.designId)) {
      setError('Every area needs a design. Add artwork first, or remove the spare area.');
      return;
    }
    setRendering(true);
    setError(null);
    try {
      const response = await fetch(`/api/mockups/${template.id}/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          placements: areas.map((a) => ({ label: a.label, designId: a.designId, corners: a.corners })),
          options,
          maxEdge: 1100,
        }),
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

      const measured = JSON.parse(response.headers.get('X-Measurements') ?? '[]') as {
        label: string;
        garment: string;
        baseLuma: number;
      }[];
      setMessage(measured.map((m) => `${m.label} ${m.garment} · baseline ${m.baseLuma}`).join('   '));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRendering(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    const result = await saveAreas(template.id, {
      areas: areas.map((a) => ({ id: a.id, label: a.label, corners: a.corners })),
      options,
      name,
    });
    if (!result.ok) setError(result.error);
    else setMessage('Saved.');
    setSaving(false);
  }

  const showingRender = showPreview && preview;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-3">
        <div
          ref={frameRef}
          className="relative select-none overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900"
          style={{ touchAction: 'none' }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={showingRender ? preview! : template.url || ''}
            alt={template.name}
            className="block w-full"
            draggable={false}
          />

          {!showingRender ? (
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="pointer-events-none absolute inset-0 h-full w-full"
            >
              {areas.map((area, ai) => (
                <polygon
                  key={area.id}
                  points={area.corners.map((c) => `${c.x * 100},${c.y * 100}`).join(' ')}
                  fill={`rgba(${AREA_COLOURS[ai % AREA_COLOURS.length]},${ai === activeIndex ? 0.16 : 0.07})`}
                  stroke={`rgb(${AREA_COLOURS[ai % AREA_COLOURS.length]})`}
                  strokeWidth={ai === activeIndex ? 0.4 : 0.2}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
          ) : null}

          {!showingRender
            ? areas.flatMap((area, ai) =>
                area.corners.map((c, ci) => (
                  <button
                    key={`${area.id}-${ci}`}
                    aria-label={`${area.label} ${CORNER_LABELS[ci]} corner`}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      setActiveIndex(ai);
                      setDragging({ area: ai, corner: ci });
                    }}
                    className={`absolute -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-white shadow transition-transform
                                ${ai === activeIndex ? 'h-5 w-5' : 'h-3.5 w-3.5 opacity-70'}
                                ${dragging?.area === ai && dragging?.corner === ci ? 'scale-125' : ''}`}
                    style={{
                      left: `${c.x * 100}%`,
                      top: `${c.y * 100}%`,
                      background: `rgb(${AREA_COLOURS[ai % AREA_COLOURS.length]})`,
                    }}
                  />
                )),
              )
            : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-primary" onClick={render} disabled={rendering}>
            {rendering ? 'Rendering…' : 'Render preview'}
          </button>
          {preview ? (
            <button className="btn" onClick={() => setShowPreview((v) => !v)}>
              {showPreview ? 'Show areas' : 'Show render'}
            </button>
          ) : null}
          <button className="btn" onClick={addArea} disabled={areas.length >= 6}>
            + Add area
          </button>
        </div>

        {error ? <p className="text-xs text-rose-400">{error}</p> : null}
        {message && !error ? <p className="text-xs text-zinc-500">{message}</p> : null}

        <p className="text-[11px] leading-relaxed text-zinc-600">
          Drag the corners onto the area the print should cover, following the shirt rather
          than the screen — a corner pushed into a fold is what makes the result sit in the
          fabric instead of floating on it. A photo showing front and back together takes two
          areas, each with its own design.
        </p>
      </div>

      <aside className="space-y-4">
        <section className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
          <label className="block space-y-1 text-xs text-zinc-400">
            Name
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </label>
        </section>

        <section className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
          <h2 className="text-sm font-semibold">
            Print areas <span className="font-normal text-zinc-500">{areas.length}</span>
          </h2>

          {areas.map((area, ai) => (
            <div
              key={area.id}
              role="button"
              tabIndex={0}
              onClick={() => setActiveIndex(ai)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setActiveIndex(ai);
              }}
              className={`space-y-2 rounded-md border p-2.5 transition ${
                ai === activeIndex ? 'border-zinc-600 bg-zinc-800/50' : 'border-zinc-800'
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ background: `rgb(${AREA_COLOURS[ai % AREA_COLOURS.length]})` }}
                />
                <input
                  aria-label={`Area ${ai + 1} label`}
                  className="field py-1 text-xs"
                  value={area.label}
                  maxLength={40}
                  onChange={(e) =>
                    setAreas((prev) =>
                      prev.map((a, i) => (i === ai ? { ...a, label: e.target.value } : a)),
                    )
                  }
                />
                {areas.length > 1 ? (
                  <button
                    className="shrink-0 text-xs text-zinc-500 hover:text-rose-400"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeArea(ai);
                    }}
                  >
                    remove
                  </button>
                ) : null}
              </div>

              <select
                aria-label={`Design for ${area.label}`}
                className="field py-1 text-xs"
                value={area.designId}
                onChange={(e) =>
                  setAreas((prev) =>
                    prev.map((a, i) => (i === ai ? { ...a, designId: e.target.value } : a)),
                  )
                }
              >
                {designs.length === 0 ? <option value="">No designs with artwork</option> : null}
                {designs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </select>

              {area.garmentHex ? (
                <p className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm border border-zinc-700"
                    style={{ background: area.garmentHex }}
                  />
                  {area.garmentHex} · baseline {area.baseLuma ?? '—'}
                </p>
              ) : (
                <p className="text-[11px] text-zinc-600">Save to measure this area.</p>
              )}
            </div>
          ))}
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
                onChange={(e) => setOptions((o) => ({ ...o, [s.key]: Number(e.target.value) }))}
              />
            </label>
          ))}
          <button className="btn w-full" onClick={() => setOptions({ ...DEFAULT_OPTIONS })}>
            Reset to defaults
          </button>
        </section>

        <button className="btn-primary w-full" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : `Save ${areas.length} print area${areas.length === 1 ? '' : 's'}`}
        </button>
      </aside>
    </div>
  );
}
