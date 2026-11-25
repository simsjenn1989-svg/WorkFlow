'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { drawPin, imageRegionOf } from '@/lib/pins/draw';
import {
  DEFAULT_STYLE,
  EMPTY_CONTENT,
  FONTS,
  LAYOUTS,
  SIZES,
  SIZE_LABELS,
  THEMES,
  type LayoutKey,
  type PinContent,
  type PinStyle,
  type SizeKey,
} from '@/lib/pins/style';
import type { PinTemplate } from '@/lib/pins/data';
import type { RenderCard } from '@/lib/renders';
import { uploadFiles } from '@/lib/upload-client';
import { loadSettings, saveSettings, STYLE_KEY } from '@/lib/pins/persist';
import { CopyPanel } from './CopyPanel';
import type { CopyModel } from '@/lib/copy/generate';
import type { CustomFont } from '@/lib/pins/fonts';
import { FontLoader } from './FontLoader';
import { thumbUrl } from '@/lib/thumb';

/**
 * The ported Pin Maker, working from finished renders instead of manual uploads.
 *
 * Drawing happens on a canvas in the browser: it redraws instantly, costs nothing, and
 * laying out wrapped auto-shrinking text is native there. The finished image goes straight
 * from the canvas to storage.
 */
export function PinStudio({
  renders,
  templates,
  copyModels,
  fonts,
}: {
  renders: RenderCard[];
  templates: PinTemplate[];
  copyModels: CopyModel[];
  fonts: CustomFont[];
}) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [image, setImage] = useState<ImageBitmap | null>(null);
  const [renderId, setRenderId] = useState(renders[0]?.id ?? '');
  const [style, setStyle] = useState<PinStyle>({ ...DEFAULT_STYLE });
  /**
   * Several text variants of the same pin.
   *
   * Posting the same product to Pinterest several times with different headlines is how a
   * listing gets tested, so a variant holds the words and the framing while the style is
   * shared across the set — exactly the split the original drew between its per-image items
   * and its global style object.
   */
  const [variants, setVariants] = useState<PinContent[]>([{ ...EMPTY_CONTENT }]);
  const [active, setActive] = useState(0);
  const content = variants[active] ?? variants[0] ?? EMPTY_CONTENT;

  /** Edits land on the selected variant, so existing callers need no changes. */
  const setContent = useCallback(
    (update: PinContent | ((previous: PinContent) => PinContent)) => {
      setVariants((previous) =>
        previous.map((variant, i) =>
          i === active ? (typeof update === 'function' ? update(variant) : update) : variant,
        ),
      );
    },
    [active],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [templateName, setTemplateName] = useState('');
  // Set once the stored style has been read, so the first save cannot overwrite it with
  // the defaults that rendered a moment earlier.
  const [restored, setRestored] = useState(false);
  // Families that have finished loading, so the dropdowns only offer usable fonts.
  const [readyFonts, setReadyFonts] = useState<string[]>([]);

  /**
   * Restore the saved style, as the original did.
   *
   * Read after mounting rather than in the initial state, because this component renders on
   * the server too: seeding state from localStorage would make the server's HTML and the
   * browser's first render disagree, which React reports as a hydration error.
   */
  useEffect(() => {
    setStyle(loadSettings(STYLE_KEY, DEFAULT_STYLE));
    setRestored(true);
  }, []);

  // Guarded on `restored` so the first save cannot overwrite the stored style with the
  // defaults that rendered a moment before it was read.
  useEffect(() => {
    if (restored) saveSettings(STYLE_KEY, style);
  }, [style, restored]);

  const render = useMemo(() => renders.find((r) => r.id === renderId), [renders, renderId]);

  /*
    Fetched as a blob rather than set as an <img> src: a blob is same-origin, so the canvas
    is never tainted and can still be exported.

    At 1600px, not the render's full 5333px. A pin is drawn on a 1000x1500 canvas, so the
    source only has to beat that — 1600 still oversamples the widest crop, while the full
    render was 2.2 MB to produce a 1000px image. The saved pin is unchanged: same canvas,
    same 1000x1500 PNG.
  */
  const source = thumbUrl(render?.output_path ?? null, 1600);
  useEffect(() => {
    let cancelled = false;
    if (!source) {
      setImage(null);
      return;
    }
    fetch(source)
      .then((r) => r.blob())
      .then((b) => createImageBitmap(b))
      .then((bitmap) => {
        if (cancelled) bitmap.close();
        else setImage(bitmap);
      })
      .catch(() => {
        if (!cancelled) setImage(null);
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  useEffect(() => {
    if (canvasRef.current) drawPin({ canvas: canvasRef.current, style, content, image });
  }, [style, content, image]);

  const set = useCallback(<K extends keyof PinStyle>(key: K, value: PinStyle[K]) => {
    setStyle((s) => ({ ...s, [key]: value }));
  }, []);

  /** Drag the photo inside its region, as the original allowed. */
  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!image) return;
    e.preventDefault();
    setDrag({ x: e.clientX, y: e.clientY });
  }

  /**
   * Scroll on the preview to zoom, as the original had.
   *
   * Attached directly rather than through React's `onWheel`, because React registers wheel
   * listeners as passive and a passive listener cannot call preventDefault — without it the
   * page scrolls away under the cursor while you are trying to resize the photo.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      if (!image) return;
      e.preventDefault();
      setContent((c) => ({
        ...c,
        zoom: Math.min(3, Math.max(0.5, c.zoom * (e.deltaY < 0 ? 1.05 : 0.95))),
      }));
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [image]);

  useEffect(() => {
    if (!drag) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const move = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      // Screen pixels to canvas pixels: the preview is shown much smaller than 1000px wide.
      const scale = canvas.width / rect.width;
      const dx = (e.clientX - drag.x) * scale;
      const dy = (e.clientY - drag.y) * scale;
      setContent((c) => ({ ...c, offsetX: c.offsetX + dx, offsetY: c.offsetY + dy }));
      setDrag({ x: e.clientX, y: e.clientY });
    };
    const up = () => setDrag(null);

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [drag]);

  /**
   * Render one variant to a blob.
   *
   * Drawn on a canvas of its own rather than the visible one, so saving a set does not mean
   * flicking the preview through every variant and waiting for React to settle between each.
   * `drawPin` is deterministic, so an off-screen draw is identical to what is on screen.
   */
  function blobFor(variant: PinContent): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      drawPin({ canvas, style, content: variant, image });
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('The pin could not be exported.'))),
        style.format === 'jpeg' ? 'image/jpeg' : 'image/png',
        0.92,
      );
    });
  }

  const nameFor = (variant: PinContent) =>
    `${(variant.title || render?.design_title || 'pin')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')}.${style.format === 'jpeg' ? 'jpg' : 'png'}`;

  async function download() {
    setError(null);
    try {
      const blob = await blobFor(content);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nameFor(content);
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function saveOne(variant: PinContent) {
    const blob = await blobFor(variant);
    const file = new File([blob], nameFor(variant), { type: blob.type });
    const [uploaded] = await uploadFiles('pin', [file]);
    if (!uploaded) throw new Error('Upload failed.');

    const response = await fetch('/api/pins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: uploaded.path,
        renderId: render!.id,
        headline: variant.title,
        subtitle: variant.subtitle,
        cta: style.cta,
        footer: style.footer,
        pinTitle: variant.pinTitle,
        pinDescription: variant.pinDescription,
        style,
        content: variant,
      }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? 'Saving failed.');
    }
  }

  async function save(all = false) {
    if (!render) {
      setError('Pick a render first.');
      return;
    }
    const chosen = all ? variants : [content];
    setBusy(all ? `Saving ${chosen.length}…` : 'Saving…');
    setError(null);
    try {
      for (const [i, variant] of chosen.entries()) {
        if (all) setBusy(`Saving ${i + 1} of ${chosen.length}…`);
        await saveOne(variant);
      }
      setMessage(
        chosen.length === 1 ? 'Saved to your pins.' : `Saved ${chosen.length} pins.`,
      );
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  /** Same image and framing, fresh words — what the original's Duplicate Pin did. */
  function duplicateVariant() {
    setVariants((previous) => {
      const copy = { ...(previous[active] ?? EMPTY_CONTENT) };
      setActive(previous.length);
      return [...previous, copy];
    });
  }

  function removeVariant(index: number) {
    setVariants((previous) => previous.filter((_, i) => i !== index));
    setActive((current) => Math.max(0, current >= index ? current - 1 : current));
  }

  /** One variant per headline, for testing a set of them against the same image. */
  function variantsFromHeadlines(headlines: string[]) {
    if (headlines.length === 0) return;
    setVariants((previous) => {
      const base = previous[active] ?? EMPTY_CONTENT;
      return headlines.map((title) => ({ ...base, title }));
    });
    setActive(0);
  }

  async function saveTemplate() {
    setError(null);
    const response = await fetch('/api/pins/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: templateName.trim(), style }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? 'Saving the template failed.');
      return;
    }
    setTemplateName('');
    router.refresh();
  }

  async function removeTemplate(id: string) {
    await fetch('/api/pins/templates', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    router.refresh();
  }

  const fontOptions: [label: string, family: string][] = [
    ...FONTS,
    ...fonts
      .filter((f) => readyFonts.includes(f.family))
      .map((f) => [`★ ${f.name}`, `'${f.family}', sans-serif`] as [string, string]),
  ];

  const [W, H] = SIZES[style.size];

  /*
   * Controls are split either side of the canvas rather than stacked down one edge. With
   * eight sections in one column, opening a few pushes the rest below the fold and takes
   * the canvas with them.
   *
   * xl: content | canvas | appearance. lg: canvas across the top, controls in two columns
   * beneath it. Narrower than that: one column, canvas first.
   */
  return (
    <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-[19rem_minmax(0,1fr)_19rem]">
      {/* Preview — stays put while either column of controls is scrolled. */}
      <div className="space-y-3 lg:col-span-2 lg:row-start-1 xl:col-span-1 xl:col-start-2 xl:row-start-1 xl:sticky xl:top-4 xl:self-start">
        <div className="flex justify-center rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
          <canvas
            ref={canvasRef}
            width={W}
            height={H}
            onPointerDown={onPointerDown}
            className="max-h-[70vh] w-auto max-w-full cursor-grab rounded shadow-lg"
            style={{ aspectRatio: `${W} / ${H}`, touchAction: 'none' }}
          />
        </div>

        <label className="flex items-center gap-2 text-xs text-zinc-400">
          Zoom
          <input
            type="range"
            aria-label="Zoom"
            className="flex-1"
            min={50}
            max={300}
            value={Math.round(content.zoom * 100)}
            onChange={(e) => setContent((c) => ({ ...c, zoom: Number(e.target.value) / 100 }))}
          />
          <span className="w-10 text-right text-zinc-500">{Math.round(content.zoom * 100)}%</span>
        </label>

        {/* Text variants of the same image. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {variants.map((variant, i) => (
            <span
              key={i}
              className={`inline-flex items-center overflow-hidden rounded-md border text-[11px] ${
                i === active ? 'border-zinc-500 bg-zinc-800' : 'border-zinc-800'
              }`}
            >
              <button
                aria-label={`Variant ${i + 1}`}
                className="max-w-36 truncate px-2 py-1 text-zinc-200 hover:bg-zinc-800"
                onClick={() => setActive(i)}
                title={variant.title || `Variant ${i + 1}`}
              >
                {variant.title?.trim() ? variant.title : `Variant ${i + 1}`}
              </button>
              {variants.length > 1 ? (
                <button
                  aria-label={`Remove variant ${i + 1}`}
                  className="border-l border-zinc-800 px-1.5 py-1 text-zinc-600 hover:text-rose-400"
                  onClick={() => removeVariant(i)}
                >
                  ×
                </button>
              ) : null}
            </span>
          ))}
          <button
            className="btn px-2 py-1 text-[11px]"
            onClick={duplicateVariant}
            disabled={variants.length >= 12}
            title="Same image, new text variant"
          >
            + Duplicate
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-primary" onClick={() => save(false)} disabled={!!busy || !render}>
            {busy ?? 'Save pin'}
          </button>
          {variants.length > 1 ? (
            <button className="btn" onClick={() => save(true)} disabled={!!busy || !render}>
              Save all {variants.length}
            </button>
          ) : null}
          <button className="btn" onClick={download} disabled={!render}>
            Download
          </button>
          <span className="text-[11px] text-zinc-600">
            {W}×{H} · drag to reposition, scroll on the pin to zoom
          </span>
        </div>

        {error ? <p className="text-xs text-rose-400">{error}</p> : null}
        {message && !error ? <p className="text-xs text-zinc-500">{message}</p> : null}
      </div>

      {/* Content: what the pin says */}
      <div className="space-y-3 lg:col-start-1 lg:row-start-2 xl:col-start-1 xl:row-start-1">
        <Section title="Source" open>
          <label className="block space-y-1 text-xs text-zinc-400">
            Render
            <select
              aria-label="Render"
              className="field"
              value={renderId}
              onChange={(e) => setRenderId(e.target.value)}
            >
              {renders.length === 0 ? <option value="">No finished renders yet</option> : null}
              {renders.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.design_title} — {r.mockup_name}
                </option>
              ))}
            </select>
          </label>

          <button
            className="btn w-full"
            onClick={() => setContent((c) => ({ ...c, zoom: 1, offsetX: 0, offsetY: 0 }))}
          >
            Reset framing
          </button>
        </Section>

        <Section title="Write copy" open>
          <CopyPanel
            models={copyModels}
            renderId={renderId}
            onVariants={variantsFromHeadlines}
            onPick={(patch) =>
              setContent((c) => ({
                ...c,
                ...(patch.title !== undefined ? { title: patch.title } : {}),
                ...(patch.subtitle !== undefined ? { subtitle: patch.subtitle } : {}),
                ...(patch.pinTitle !== undefined ? { pinTitle: patch.pinTitle } : {}),
                ...(patch.pinDescription !== undefined ? { pinDescription: patch.pinDescription } : {}),
              }))
            }
          />
        </Section>

        <Section title="Text" open>
          <label className="block space-y-1 text-xs text-zinc-400">
            Headline
            <textarea
              name="headline"
              rows={2}
              className="field"
              value={content.title}
              onChange={(e) => setContent((c) => ({ ...c, title: e.target.value }))}
              placeholder="The Tee Everyone Asks About"
            />
          </label>
          <label className="block space-y-1 text-xs text-zinc-400">
            Subtitle
            <input
              name="subtitle"
              className="field"
              value={content.subtitle}
              onChange={(e) => setContent((c) => ({ ...c, subtitle: e.target.value }))}
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-xs text-zinc-400">
              Button
              <input className="field" value={style.cta} onChange={(e) => set('cta', e.target.value)} placeholder="Shop now" />
            </label>
            <label className="space-y-1 text-xs text-zinc-400">
              Footer
              <input className="field" value={style.footer} onChange={(e) => set('footer', e.target.value)} placeholder="yourshop.etsy.com" />
            </label>
          </div>
        </Section>

        <Section title="Pinterest fields">
          <p className="text-[11px] leading-relaxed text-zinc-600">
            These are not drawn on the image. They stay as text you paste into Pinterest.
          </p>
          <label className="block space-y-1 text-xs text-zinc-400">
            Pin title
            <input
              name="pinTitle"
              className="field"
              maxLength={100}
              value={content.pinTitle}
              onChange={(e) => setContent((c) => ({ ...c, pinTitle: e.target.value }))}
            />
          </label>
          <label className="block space-y-1 text-xs text-zinc-400">
            Pin description
            <textarea
              name="pinDescription"
              rows={3}
              className="field"
              maxLength={800}
              value={content.pinDescription}
              onChange={(e) => setContent((c) => ({ ...c, pinDescription: e.target.value }))}
            />
          </label>
        </Section>

      </div>

      {/* Appearance: how the pin looks */}
      <div className="space-y-3 lg:col-start-2 lg:row-start-2 xl:col-start-3 xl:row-start-1">
        <Section title="Layout" open>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-xs text-zinc-400">
              Size
              <select className="field" value={style.size} onChange={(e) => set('size', e.target.value as SizeKey)}>
                {(Object.keys(SIZES) as SizeKey[]).map((k) => (
                  <option key={k} value={k}>
                    {SIZE_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs text-zinc-400">
              Style
              <select className="field" value={style.layout} onChange={(e) => set('layout', e.target.value as LayoutKey)}>
                {(Object.keys(LAYOUTS) as LayoutKey[]).map((k) => (
                  <option key={k} value={k}>
                    {LAYOUTS[k]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <Segmented
            label="Text position"
            options={['top', 'center', 'bottom']}
            value={style.position}
            onChange={(v) => set('position', v as PinStyle['position'])}
          />
          <Segmented
            label="Alignment"
            options={['left', 'center', 'right']}
            value={style.align}
            onChange={(v) => set('align', v as PinStyle['align'])}
          />

          {style.layout === 'split' || style.layout === 'framed' ? (
            <Range label="Image area" value={style.split} min={40} max={80} onChange={(v) => set('split', v)} suffix="%" />
          ) : null}
          {style.layout === 'overlay' ? (
            <Range label="Fade" value={style.fade} min={0} max={90} onChange={(v) => set('fade', v)} suffix="%" />
          ) : null}
          {style.layout === 'band' || style.layout === 'box' ? (
            <Range label="Box opacity" value={style.boxOpacity} min={0} max={100} onChange={(v) => set('boxOpacity', v)} suffix="%" />
          ) : null}

          <label className="flex items-center gap-2 text-xs text-zinc-400">
            <input type="checkbox" checked={style.border} onChange={(e) => set('border', e.target.checked)} />
            Thin inset border
          </label>
        </Section>

        <Section title="Type">
          <label className="block space-y-1 text-xs text-zinc-400">
            Headline font
            <select className="field" value={style.titleFont} onChange={(e) => set('titleFont', e.target.value)}>
              {fontOptions.map(([label, family]) => (
                <option key={family} value={family}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-xs text-zinc-400">
              Weight
              <select className="field" value={style.titleWeight} onChange={(e) => set('titleWeight', e.target.value)}>
                {['400', '600', '700', '800'].map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </label>
            <Range label="Tracking" value={style.tracking} min={-2} max={20} onChange={(v) => set('tracking', v)} />
          </div>
          <Range label="Headline size" value={style.titleSize} min={40} max={180} onChange={(v) => set('titleSize', v)} suffix="px" />
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            <input type="checkbox" checked={style.upper} onChange={(e) => set('upper', e.target.checked)} />
            UPPERCASE headline
          </label>
          <label className="block space-y-1 text-xs text-zinc-400">
            Body font
            <select className="field" value={style.bodyFont} onChange={(e) => set('bodyFont', e.target.value)}>
              {fontOptions.map(([label, family]) => (
                <option key={family} value={family}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <Range label="Subtitle size" value={style.subSize} min={20} max={80} onChange={(v) => set('subSize', v)} suffix="px" />
          <Range label="Line height" value={style.lineHeight} min={90} max={150} onChange={(v) => set('lineHeight', v)} suffix="%" />
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            <input type="checkbox" checked={style.shadow} onChange={(e) => set('shadow', e.target.checked)} />
            Text shadow
          </label>

          <div className="border-t border-zinc-800 pt-2.5">
            <FontLoader
              fonts={fonts}
              onReady={setReadyFonts}
              onApply={(family) => set('titleFont', family)}
            />
          </div>
        </Section>

        <Section title="Colours">
          <div className="flex flex-wrap gap-1.5">
            {THEMES.map((theme) => (
              <button
                key={theme.name}
                className="btn px-2 py-1 text-[11px]"
                onClick={() => setStyle((s) => ({ ...s, ...theme.colours }))}
              >
                <span
                  className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-zinc-700"
                  style={{ background: theme.colours.boxColor }}
                />
                {theme.name}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Colour label="Headline" value={style.titleColor} onChange={(v) => set('titleColor', v)} />
            <Colour label="Subtitle" value={style.subColor} onChange={(v) => set('subColor', v)} />
            <Colour label="Band / box" value={style.boxColor} onChange={(v) => set('boxColor', v)} />
            <Colour label="Background" value={style.bgColor} onChange={(v) => set('bgColor', v)} />
            <Colour label="Button" value={style.ctaBg} onChange={(v) => set('ctaBg', v)} />
            <Colour label="Button text" value={style.ctaColor} onChange={(v) => set('ctaColor', v)} />
            <Colour label="Footer" value={style.footerColor} onChange={(v) => set('footerColor', v)} />
          </div>
        </Section>

        <Section title="Templates">
          <p className="text-[11px] leading-relaxed text-zinc-600">
            Your saved looks — size, layout, type and colours together. The swatches above
            change colours only.
          </p>

          {templates.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {templates.map((template) => (
                <span key={template.id} className="inline-flex items-center overflow-hidden rounded-md border border-zinc-800">
                  <button
                    className="px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-800"
                    onClick={() => setStyle({ ...DEFAULT_STYLE, ...template.style })}
                  >
                    {template.name}
                  </button>
                  <button
                    aria-label={`Delete template ${template.name}`}
                    className="border-l border-zinc-800 px-1.5 py-1 text-[11px] text-zinc-600 hover:text-rose-400"
                    onClick={() => removeTemplate(template.id)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-zinc-600">None saved yet.</p>
          )}

          <div className="flex gap-2">
            <input
              name="templateName"
              className="field"
              placeholder="Name this look"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
            />
            <button className="btn shrink-0" onClick={saveTemplate} disabled={!templateName.trim()}>
              Save
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-xs text-zinc-400">
              File format
              <select className="field" value={style.format} onChange={(e) => set('format', e.target.value as 'png' | 'jpeg')}>
                <option value="png">PNG (sharpest)</option>
                <option value="jpeg">JPG (smaller)</option>
              </select>
            </label>
            <div className="flex items-end">
              <button className="btn w-full" onClick={() => setStyle({ ...DEFAULT_STYLE })}>
                Reset style
              </button>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, open, children }: { title: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details open={open} className="rounded-lg border border-zinc-800 bg-zinc-900/60">
      <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">{title}</summary>
      <div className="space-y-2.5 border-t border-zinc-800 p-3">{children}</div>
    </details>
  );
}

function Segmented({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1 text-xs text-zinc-400">
      {label}
      <div className="flex gap-1">
        {options.map((o) => (
          <button
            key={o}
            onClick={() => onChange(o)}
            className={`flex-1 rounded-md border px-2 py-1 capitalize ${
              value === o
                ? 'border-zinc-500 bg-zinc-800 text-zinc-100'
                : 'border-zinc-800 text-zinc-400 hover:bg-zinc-800/60'
            }`}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

function Range({
  label,
  value,
  min,
  max,
  onChange,
  suffix = '',
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <label className="block space-y-1 text-xs text-zinc-400">
      <span className="flex items-baseline justify-between">
        {label}
        <span className="text-zinc-500">
          {value}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        className="w-full"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function Colour({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="space-y-1 text-xs text-zinc-400">
      {label}
      <input
        type="color"
        className="h-8 w-full rounded border border-zinc-800 bg-zinc-900"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
