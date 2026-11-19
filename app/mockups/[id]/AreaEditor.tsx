'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { saveAreas } from '../actions';
import { DEFAULT_OPTIONS, type RenderOptions } from '@/lib/render/options';
import { centroidOf, isInsideQuad, moveQuad, rotateQuad, scaleQuad } from '@/lib/render/transform';
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

const NUDGE = 0.004;
const NUDGE_FINE = 0.001;

type EditableArea = PrintArea & { designId: string };
type Drag =
  | { kind: 'corner'; area: number; corner: number }
  | { kind: 'move'; area: number; last: { x: number; y: number } };

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
  const [showOverlay, setShowOverlay] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [autoRender, setAutoRender] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [aspect, setAspect] = useState(1);

  const frameRef = useRef<HTMLDivElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const renderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const renderRef = useRef<() => void>(() => {});

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      if (renderTimer.current) clearTimeout(renderTimer.current);
    };
  }, []);

  const pointFromEvent = useCallback((e: { clientX: number; clientY: number }) => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  }, []);

  /** Re-render shortly after an adjustment settles, so dragging shows real output. */
  const scheduleRender = useCallback(() => {
    if (!autoRender || !previewUrlRef.current) return;
    if (renderTimer.current) clearTimeout(renderTimer.current);
    renderTimer.current = setTimeout(() => renderRef.current(), 600);
  }, [autoRender]);

  useEffect(() => {
    if (!drag) return;

    const move = (e: PointerEvent) => {
      const p = pointFromEvent(e);
      if (!p) return;

      if (drag.kind === 'corner') {
        setAreas((prev) =>
          prev.map((area, ai) =>
            ai !== drag.area
              ? area
              : {
                  ...area,
                  corners: area.corners.map((c, ci) =>
                    ci === drag.corner ? { x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) } : c,
                  ) as NormQuad,
                },
          ),
        );
        return;
      }

      const dx = p.x - drag.last.x;
      const dy = p.y - drag.last.y;
      setAreas((prev) =>
        prev.map((area, ai) =>
          ai !== drag.area ? area : { ...area, corners: moveQuad(area.corners, dx, dy) },
        ),
      );
      setDrag({ ...drag, last: p });
    };

    const up = () => {
      setDrag(null);
      scheduleRender();
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [drag, pointFromEvent, scheduleRender]);

  /** Arrow keys nudge the active area; shift makes the step finer. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      const step = e.shiftKey ? NUDGE_FINE : NUDGE;
      const delta =
        e.key === 'ArrowUp'
          ? { x: 0, y: -step }
          : e.key === 'ArrowDown'
            ? { x: 0, y: step }
            : e.key === 'ArrowLeft'
              ? { x: -step, y: 0 }
              : e.key === 'ArrowRight'
                ? { x: step, y: 0 }
                : null;
      if (!delta) return;

      e.preventDefault();
      setAreas((prev) =>
        prev.map((area, ai) =>
          ai !== activeIndex ? area : { ...area, corners: moveQuad(area.corners, delta.x, delta.y) },
        ),
      );
      scheduleRender();
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeIndex, scheduleRender]);

  function transformActive(fn: (corners: NormQuad) => NormQuad) {
    setAreas((prev) =>
      prev.map((area, ai) => (ai !== activeIndex ? area : { ...area, corners: fn(area.corners) })),
    );
    scheduleRender();
  }

  function addArea() {
    setAreas((prev) => {
      const index = prev.length;
      setActiveIndex(index);
      return [
        ...prev,
        {
          id: crypto.randomUUID(),
          label: index === 1 ? 'back' : `area ${index + 1}`,
          corners: defaultCornersFor(index),
          designId: designs[0]?.id ?? '',
        },
      ];
    });
  }

  function removeArea(index: number) {
    setAreas((prev) => prev.filter((_, i) => i !== index));
    setActiveIndex((i) => Math.max(0, i >= index ? i - 1 : i));
    scheduleRender();
  }

  const render = useCallback(async () => {
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
  }, [areas, options, template.id]);

  renderRef.current = render;

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

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-3">
        <div
          ref={frameRef}
          className="relative select-none overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900"
          style={{ touchAction: 'none', cursor: drag?.kind === 'move' ? 'grabbing' : 'default' }}
          onPointerDown={(e) => {
            // A press inside an area grabs the whole thing; corners handle themselves.
            const p = pointFromEvent(e);
            if (!p) return;
            const order = [activeIndex, ...areas.map((_, i) => i).filter((i) => i !== activeIndex)];
            const hit = order.find((i) => areas[i] && isInsideQuad(areas[i]!.corners, p));
            if (hit === undefined) return;
            e.preventDefault();
            setActiveIndex(hit);
            setDrag({ kind: 'move', area: hit, last: p });
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview ?? template.url ?? ''}
            alt={template.name}
            className="block w-full"
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalHeight > 0) setAspect(img.naturalWidth / img.naturalHeight);
            }}
          />

          {showOverlay ? (
            <>
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                className="pointer-events-none absolute inset-0 h-full w-full"
              >
                {areas.map((area, ai) => (
                  <polygon
                    key={area.id}
                    points={area.corners.map((c) => `${c.x * 100},${c.y * 100}`).join(' ')}
                    fill={`rgba(${AREA_COLOURS[ai % AREA_COLOURS.length]},${ai === activeIndex ? 0.1 : 0.04})`}
                    stroke={`rgb(${AREA_COLOURS[ai % AREA_COLOURS.length]})`}
                    strokeWidth={ai === activeIndex ? 0.35 : 0.18}
                    strokeDasharray={ai === activeIndex ? undefined : '1 1'}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </svg>

              {areas.flatMap((area, ai) =>
                area.corners.map((c, ci) => (
                  <button
                    key={`${area.id}-${ci}`}
                    aria-label={`${area.label} ${CORNER_LABELS[ci]} corner`}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setActiveIndex(ai);
                      setDrag({ kind: 'corner', area: ai, corner: ci });
                    }}
                    className={`absolute -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-white shadow transition-transform
                                ${ai === activeIndex ? 'h-4 w-4' : 'h-3 w-3 opacity-60'}
                                ${drag?.kind === 'corner' && drag.area === ai && drag.corner === ci ? 'scale-125' : ''}`}
                    style={{
                      left: `${c.x * 100}%`,
                      top: `${c.y * 100}%`,
                      background: `rgb(${AREA_COLOURS[ai % AREA_COLOURS.length]})`,
                    }}
                  />
                )),
              )}
            </>
          ) : null}

          {rendering ? (
            <span className="pointer-events-none absolute right-2 top-2 rounded bg-zinc-950/80 px-2 py-1 text-[11px] text-zinc-300">
              Rendering…
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-primary" onClick={render} disabled={rendering}>
            {rendering ? 'Rendering…' : preview ? 'Re-render' : 'Render preview'}
          </button>
          <button className="btn" onClick={() => setShowOverlay((v) => !v)}>
            {showOverlay ? 'Hide guides' : 'Show guides'}
          </button>
          <button className="btn" onClick={addArea} disabled={areas.length >= 6}>
            + Add area
          </button>
          <label className="ml-auto flex items-center gap-1.5 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={autoRender}
              onChange={(e) => setAutoRender(e.target.checked)}
            />
            Re-render as I adjust
          </label>
        </div>

        {/* Whole-area controls for the active area. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2">
          <span className="text-xs text-zinc-400">
            Adjust{' '}
            <span
              className="rounded px-1.5 py-0.5 text-zinc-200"
              style={{ background: `rgba(${AREA_COLOURS[activeIndex % AREA_COLOURS.length]},0.25)` }}
            >
              {areas[activeIndex]?.label ?? '—'}
            </span>
          </span>

          <Nudger
            onMove={(dx, dy) => transformActive((c) => moveQuad(c, dx, dy))}
          />

          <span className="flex items-center gap-1 text-xs text-zinc-400">
            Size
            <button className="btn px-2 py-0.5" onClick={() => transformActive((c) => scaleQuad(c, 1 / 1.05))} aria-label="Smaller">
              −
            </button>
            <button className="btn px-2 py-0.5" onClick={() => transformActive((c) => scaleQuad(c, 1.05))} aria-label="Bigger">
              +
            </button>
          </span>

          <span className="flex items-center gap-1 text-xs text-zinc-400">
            Rotate
            <button className="btn px-2 py-0.5" onClick={() => transformActive((c) => rotateQuad(c, -1.5, aspect))} aria-label="Rotate left">
              ↺
            </button>
            <button className="btn px-2 py-0.5" onClick={() => transformActive((c) => rotateQuad(c, 1.5, aspect))} aria-label="Rotate right">
              ↻
            </button>
          </span>
        </div>

        {error ? <p className="text-xs text-rose-400">{error}</p> : null}
        {message && !error ? <p className="text-xs text-zinc-500">{message}</p> : null}

        <p className="text-[11px] leading-relaxed text-zinc-600">
          Drag inside an area to move the whole print, or a corner to reshape it. Arrow keys
          nudge the selected area; hold shift for finer steps. A corner pushed into a fold is
          what makes the result sit in the fabric instead of floating on it.
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
                    setAreas((prev) => prev.map((a, i) => (i === ai ? { ...a, label: e.target.value } : a)))
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
                onChange={(e) => {
                  setAreas((prev) => prev.map((a, i) => (i === ai ? { ...a, designId: e.target.value } : a)));
                  scheduleRender();
                }}
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
                onPointerUp={scheduleRender}
                onKeyUp={scheduleRender}
              />
            </label>
          ))}
          <button
            className="btn w-full"
            onClick={() => {
              setOptions({ ...DEFAULT_OPTIONS });
              scheduleRender();
            }}
          >
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

/** A small directional pad, for when the keyboard is not where your hands are. */
function Nudger({ onMove }: { onMove: (dx: number, dy: number) => void }) {
  const button = 'btn px-2 py-0.5 leading-none';
  return (
    <span className="flex items-center gap-1 text-xs text-zinc-400">
      Move
      <button className={button} aria-label="Move left" onClick={() => onMove(-NUDGE, 0)}>
        ←
      </button>
      <button className={button} aria-label="Move up" onClick={() => onMove(0, -NUDGE)}>
        ↑
      </button>
      <button className={button} aria-label="Move down" onClick={() => onMove(0, NUDGE)}>
        ↓
      </button>
      <button className={button} aria-label="Move right" onClick={() => onMove(NUDGE, 0)}>
        →
      </button>
    </span>
  );
}
