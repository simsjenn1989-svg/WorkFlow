'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { saveAreas } from '../actions';
import { DEFAULT_OPTIONS, type RenderOptions } from '@/lib/render/options';
import {
  centroidOf,
  isInsideQuad,
  moveQuad,
  rotateQuad,
  scaleQuad,
  tiltOf,
} from '@/lib/render/transform';
import {
  printAreaCorners,
  snapToPrintAspect,
  type MockupTemplate,
  type NormPoint,
  type NormQuad,
  type PrintArea,
} from '@/lib/mockups';
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

/**
 * Where the turn handle sits: out from the top edge, along the box's own up direction.
 *
 * A fraction of the box's height rather than a fixed distance, so it stays clear of a big
 * area and does not fly off a small one. Measured in the square space the quad is rotated
 * in, or the handle would drift sideways as the area turns on a non-square photo.
 */
function turnHandle(corners: NormQuad, aspect: number): NormPoint {
  const topMid = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 };
  const bottomMid = { x: (corners[2].x + corners[3].x) / 2, y: (corners[2].y + corners[3].y) / 2 };
  const up = { x: (topMid.x - bottomMid.x) * aspect, y: topMid.y - bottomMid.y };
  const length = Math.hypot(up.x, up.y) || 1;
  const out = 0.22;
  return {
    x: topMid.x + ((up.x / length) * length * out) / aspect,
    y: topMid.y + (up.y / length) * length * out,
  };
}

/** The pointer's bearing from an area's centre, in the same square space. */
function bearing(corners: NormQuad, point: NormPoint, aspect: number): number {
  const c = centroidOf(corners);
  return Math.atan2(point.y - c.y, (point.x - c.x) * aspect) * (180 / Math.PI);
}

const NUDGE = 0.004;
const NUDGE_FINE = 0.001;

type EditableArea = PrintArea & { designId: string };
type Drag =
  | { kind: 'corner'; area: number; corner: number }
  | { kind: 'move'; area: number; last: { x: number; y: number } }
  /** Turning by the handle: the pointer's angle last frame, so each move turns by the delta. */
  | { kind: 'turn'; area: number; last: number };

export function AreaEditor({
  template,
  designs,
  printArea,
}: {
  template: MockupTemplate;
  designs: DesignCard[];
  /** The print area every approved design is normalised to, in pixels. */
  printArea: { width: number; height: number };
}) {
  const areaAspect = printArea.width / printArea.height;
  const [areas, setAreas] = useState<EditableArea[]>(() =>
    (template.print_areas.length > 0
      ? template.print_areas
      : // Aspect 1 for now; the image's real aspect arrives when it loads and the first
        // area is reshaped then, since a newly opened mockup has nothing to lose.
        [{ id: crypto.randomUUID(), label: 'front', corners: printAreaCorners(1, areaAspect) }]
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

      if (drag.kind === 'turn') {
        setAreas((prev) =>
          prev.map((area, ai) => {
            if (ai !== drag.area) return area;
            // Turn by how far the pointer swept, not to where it points: the handle is
            // then wherever you grabbed it rather than snapping under the cursor.
            const now = bearing(area.corners, p, aspect);
            let delta = now - drag.last;
            if (delta > 180) delta -= 360;
            if (delta < -180) delta += 360;
            return { ...area, corners: rotateQuad(area.corners, delta, aspect) };
          }),
        );
        setDrag({ ...drag, last: bearing(areas[drag.area]?.corners ?? [p, p, p, p] as NormQuad, p, aspect) });
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
  }, [areas, aspect, drag, pointFromEvent, scheduleRender]);

  /** Arrow keys nudge the active area, [ and ] tilt it; shift makes either step finer. */
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
      // Tilt from the keyboard too: dragging a corner to turn an area means moving it and
      // its opposite by hand and hoping the middle stayed put.
      const turn = e.key === '[' ? -1 : e.key === ']' ? 1 : 0;
      if (turn !== 0) {
        e.preventDefault();
        const degrees = turn * (e.shiftKey ? 0.25 : 1);
        setAreas((prev) =>
          prev.map((area, ai) =>
            ai !== activeIndex ? area : { ...area, corners: rotateQuad(area.corners, degrees, aspect) },
          ),
        );
        scheduleRender();
        return;
      }

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
  }, [activeIndex, aspect, scheduleRender]);

  function transformActive(fn: (corners: NormQuad) => NormQuad) {
    setAreas((prev) =>
      prev.map((area, ai) => (ai !== activeIndex ? area : { ...area, corners: fn(area.corners) })),
    );
    scheduleRender();
  }

  const [placing, setPlacing] = useState(false);

  /** The selected area's current tilt, measured from its corners rather than remembered. */
  const active = areas[activeIndex];
  const tilt = active ? tiltOf(active.corners, aspect) : 0;

  async function autoPlace() {
    setPlacing(true);
    setError(null);
    try {
      const response = await fetch('/api/mockups/auto-place', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: template.id }),
      });
      const body = (await response.json().catch(() => null)) as
        | { areas?: { id: string; label: string; corners: NormQuad }[]; error?: string }
        | null;
      if (!response.ok || !body?.areas) throw new Error(body?.error ?? 'Auto-place failed.');

      // Saved server-side already; this is only so the canvas shows it straight away.
      setAreas((prev) =>
        body.areas!.map((a, i) => ({
          ...(prev[i] ?? { designId: designs[0]?.id ?? '' }),
          id: a.id,
          label: a.label,
          corners: a.corners,
          designId: prev[i]?.designId ?? designs[0]?.id ?? '',
        })),
      );
      setMessage('Placed on the garment. Adjust from here, then save.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPlacing(false);
    }
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
          corners: printAreaCorners(aspect, areaAspect, {
            x: index % 2 === 1 ? 0.25 : 0.75,
            y: 0.47,
          }),
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
          style={{ touchAction: 'none', cursor: drag?.kind === 'move' || drag?.kind === 'turn' ? 'grabbing' : 'default' }}
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
              if (img.naturalHeight > 0) {
                const real = img.naturalWidth / img.naturalHeight;
                setAspect(real);
                // The starting area was built before the photo's shape was known. Snap it,
                // but only on a mockup that has never been marked — reshaping corners
                // someone has already placed would undo their work.
                if (template.print_areas.length === 0) {
                  setAreas((prev) =>
                    prev.map((a, i) =>
                      i === 0 ? { ...a, corners: printAreaCorners(real, areaAspect) } : a,
                    ),
                  );
                }
              }
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

                {/* The stem, so the handle reads as attached to the box rather than loose. */}
                {areas[activeIndex]
                  ? (() => {
                      const corners = areas[activeIndex]!.corners;
                      const mid = {
                        x: (corners[0].x + corners[1].x) / 2,
                        y: (corners[0].y + corners[1].y) / 2,
                      };
                      const h = turnHandle(corners, aspect);
                      return (
                        <line
                          x1={mid.x * 100}
                          y1={mid.y * 100}
                          x2={h.x * 100}
                          y2={h.y * 100}
                          stroke={`rgb(${AREA_COLOURS[activeIndex % AREA_COLOURS.length]})`}
                          strokeWidth={0.3}
                          vectorEffect="non-scaling-stroke"
                        />
                      );
                    })()
                  : null}
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

              {/*
                Grab and turn, the way any graphics program does it. The slider and the
                arrows stay for a precise angle, but reaching for a handle above the box
                and swinging it is how someone actually squares a print to a shoulder.

                Only the active area gets one: four handles and a stem on every area at
                once is a thicket, and you can only turn the one you have selected anyway.
              */}
              {areas[activeIndex]
                ? (() => {
                    const h = turnHandle(areas[activeIndex]!.corners, aspect);
                    return (
                      <button
                        aria-label={`Turn the ${areas[activeIndex]!.label} area`}
                        title="Drag to turn"
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const p = pointFromEvent(e.nativeEvent);
                          if (!p) return;
                          setDrag({
                            kind: 'turn',
                            area: activeIndex,
                            last: bearing(areas[activeIndex]!.corners, p, aspect),
                          });
                        }}
                        className={`absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center
                                    justify-center rounded-full border-2 border-white bg-zinc-900 text-[11px]
                                    text-white shadow transition-transform hover:scale-110
                                    ${drag?.kind === 'turn' ? 'scale-110 cursor-grabbing' : 'cursor-grab'}`}
                        style={{ left: `${h.x * 100}%`, top: `${h.y * 100}%` }}
                      >
                        ↻
                      </button>
                    );
                  })()
                : null}
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

          {/*
            Tilt, as a slider rather than only a pair of arrows.

            It was two unlabelled icons turning 1.5 degrees a click, which is a long way
            from "tilt this to sit with the shoulder" and easy to miss entirely. The angle
            is read back off the corners by `tiltOf`, so the handle shows where the area
            really is — including after a corner has been dragged by hand — and moving it
            turns by the difference rather than from some remembered zero.
          */}
          <span className="flex items-center gap-1.5 text-xs text-zinc-400">
            Tilt
            <button
              className="btn px-2 py-0.5"
              onClick={() => transformActive((c) => rotateQuad(c, -1, aspect))}
              aria-label="Tilt left one degree"
            >
              ↺
            </button>
            <input
              type="range"
              min={-20}
              max={20}
              step={0.5}
              value={tilt}
              aria-label="Tilt the print area"
              className="w-28 accent-zinc-300"
              onChange={(e) =>
                transformActive((c) => rotateQuad(c, Number(e.target.value) - tiltOf(c, aspect), aspect))
              }
            />
            <button
              className="btn px-2 py-0.5"
              onClick={() => transformActive((c) => rotateQuad(c, 1, aspect))}
              aria-label="Tilt right one degree"
            >
              ↻
            </button>
            {/* A hair below zero reads as "-0.0", which looks like a bug. */}
            <span className="w-12 tabular-nums text-zinc-500">
              {`${(Math.abs(tilt) < 0.05 ? 0 : tilt).toFixed(1)}°`}
            </span>
            <button
              className="text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
              onClick={() => transformActive((c) => rotateQuad(c, -tiltOf(c, aspect), aspect))}
              disabled={Math.abs(tilt) < 0.05}
            >
              level
            </button>
          </span>

          {/*
            A button, not a constraint. Corners have to stay free — pushing one into a fold
            is what makes a print sit in the fabric rather than on it, and a quad in
            perspective has no single aspect to hold. So: snap to the right shape, then
            fine-tune from there.
          */}
          <div className="ml-auto flex items-center gap-2">
            {/*
              Auto-place measures the shirt in the photo and puts the areas on it. Marking
              by eye went wrong in a repeatable way — a fixed fraction of the PHOTO is a
              sensible print on a close crop and runs off the sleeves on a wide shot — so
              the detector sizes to the garment instead. See lib/render/garment.ts.
            */}
            <button
              className="btn px-2 py-0.5 text-xs"
              disabled={placing}
              onClick={autoPlace}
              title="Find the shirt in this photo and put the print area on its chest"
            >
              {placing ? 'Placing…' : 'Auto-place'}
            </button>
            <button
              className="btn px-2 py-0.5 text-xs"
              onClick={() => transformActive((c) => snapToPrintAspect(c, aspect, areaAspect))}
              title={`Reshape to ${printArea.width}x${printArea.height}, keeping the centre and width`}
            >
              Fit to print area
            </button>
          </div>
        </div>

        {error ? <p className="text-xs text-rose-400">{error}</p> : null}
        {message && !error ? <p className="text-xs text-zinc-500">{message}</p> : null}

        <p className="text-[11px] leading-relaxed text-zinc-600">
          Drag inside an area to move the whole print, a corner to reshape it, or the{' '}
          <span className="text-zinc-400">&#8635;</span> handle above it to turn it. Arrow keys
          nudge the selected area and <kbd className="rounded bg-zinc-800 px-1">[</kbd>{' '}
          <kbd className="rounded bg-zinc-800 px-1">]</kbd> tilt it; hold shift for finer
          steps. A corner pushed into a fold is what makes the result sit in the fabric
          instead of floating on it.
          {' '}An area starts at the print area&rsquo;s own shape ({printArea.width}&times;
          {printArea.height}), and every approved design is sized to exactly that — so mark
          the area over the whole printable panel, not around the artwork, and each design
          lands where it would really print.
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
