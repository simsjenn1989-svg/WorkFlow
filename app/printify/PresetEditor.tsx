'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Preset, PresetPlacement, PresetVariant } from '@/lib/printify/presets';

type Suggestion = {
  preset: {
    name: string;
    shopId: string;
    shopTitle: string | null;
    blueprintId: number;
    printProviderId: number;
    colour: string;
    variants: PresetVariant[];
    placements: Record<string, PresetPlacement>;
    printWidthPx: number | null;
    printHeightPx: number | null;
    isDefault?: boolean;
  };
  shops: { id: string; title: string; salesChannel: string }[];
  areas: string[];
  warnings: string[];
};

/**
 * The product preset: everything that is the same for every design.
 *
 * It is built by reading Printify's live catalogue rather than typed in — variant ids, sizes
 * and print-area pixel sizes all come back from the API, so there is nothing here to go stale
 * when Printify changes a blueprint.
 */
export function PresetEditor({ presets }: { presets: Preset[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(presets.length === 0);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Suggestion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disabled, setDisabled] = useState<number[]>([]);
  const [bulkPrice, setBulkPrice] = useState('');

  async function suggest(from?: Preset) {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (from) {
        params.set('blueprintId', String(from.blueprint_id));
        params.set('printProviderId', String(from.print_provider_id));
        params.set('colour', from.colour);
        params.set('shopId', from.shop_id);
      }
      const response = await fetch(`/api/printify/presets?${params}`);
      const body = (await response.json()) as Suggestion & { error?: string };
      if (!response.ok) {
        setError(body.error ?? 'Printify did not answer.');
        return;
      }

      if (from) {
        // Editing: keep what was decided before (name, prices, placements) and refresh only
        // the facts that come from Printify.
        const prices = new Map(from.variants.map((v) => [v.variantId, v.priceCents]));
        setDraft({
          ...body,
          preset: {
            ...body.preset,
            name: from.name,
            shopId: from.shop_id,
            isDefault: from.is_default,
            placements: { ...body.preset.placements, ...from.placements },
            variants: body.preset.variants.map((v) => ({
              ...v,
              priceCents: prices.get(v.variantId) ?? v.priceCents,
            })),
          },
        });
        setDisabled(
          body.preset.variants
            .filter((v) => !prices.has(v.variantId))
            .map((v) => v.variantId),
        );
        setEditing(from.id);
      } else {
        setDraft(body);
        setDisabled([]);
        setEditing(null);
      }
      setOpen(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/printify/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editing,
          ...draft.preset,
          variants: draft.preset.variants.filter((v) => !disabled.includes(v.variantId)),
        }),
      });
      const body = (await response.json()) as { id?: string; error?: string };
      if (!response.ok) {
        setError(body.error ?? 'Saving failed.');
        return;
      }
      setDraft(null);
      setEditing(null);
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const response = await fetch('/api/printify/presets', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? 'That preset could not be deleted.');
      return;
    }
    router.refresh();
  }

  function patch(change: Partial<Suggestion['preset']>) {
    setDraft((d) => (d ? { ...d, preset: { ...d.preset, ...change } } : d));
  }

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/60">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-3 py-2">
        <h2 className="text-sm font-semibold">
          Product presets <span className="font-normal text-zinc-500">{presets.length}</span>
        </h2>
        <div className="flex items-center gap-3">
          <button
            className="text-xs text-zinc-400 hover:text-zinc-200"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'Hide' : 'Show'}
          </button>
          <button className="btn text-xs" onClick={() => suggest()} disabled={busy}>
            {busy && !draft ? 'Reading Printify…' : '+ New from Printify'}
          </button>
        </div>
      </header>

      {open ? (
        <div className="space-y-4 p-3">
          {presets.length > 0 ? (
            <ul className="divide-y divide-zinc-900 rounded border border-zinc-800 text-xs">
              {presets.map((preset) => (
                <li key={preset.id} className="flex flex-wrap items-baseline gap-2 px-3 py-2">
                  <span className="font-medium text-zinc-200">{preset.name}</span>
                  {preset.is_default ? (
                    <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">
                      default
                    </span>
                  ) : null}
                  <span className="text-zinc-500">
                    {preset.shop_title ?? preset.shop_id} · {preset.variants.length} size
                    {preset.variants.length === 1 ? '' : 's'} ·{' '}
                    {Object.entries(preset.placements)
                      .filter(([, pl]) => pl?.enabled !== false)
                      .map(([area]) => area)
                      .join(' + ') || 'no areas'}
                    {preset.print_width_px
                      ? ` · ${preset.print_width_px}×${preset.print_height_px} px`
                      : ''}
                  </span>
                  <span className="ml-auto flex gap-3">
                    <button
                      className="text-zinc-400 hover:text-zinc-200"
                      onClick={() => suggest(preset)}
                      disabled={busy}
                    >
                      edit
                    </button>
                    <button
                      className="text-zinc-600 hover:text-rose-400"
                      onClick={() => remove(preset.id)}
                    >
                      delete
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {draft ? (
            <div className="space-y-4 rounded border border-zinc-700 bg-zinc-950/60 p-3">
              {draft.warnings.map((w) => (
                <p key={w} className="text-[11px] text-amber-400">
                  {w}
                </p>
              ))}

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-xs text-zinc-400">
                  Name
                  <input
                    className="field"
                    value={draft.preset.name}
                    onChange={(e) => patch({ name: e.target.value })}
                  />
                </label>
                <label className="space-y-1 text-xs text-zinc-400">
                  Shop
                  <select
                    aria-label="Shop"
                    className="field"
                    value={draft.preset.shopId}
                    onChange={(e) =>
                      patch({
                        shopId: e.target.value,
                        shopTitle:
                          draft.shops.find((s) => s.id === e.target.value)?.title ?? null,
                      })
                    }
                  >
                    {draft.shops.map((shop) => (
                      <option key={shop.id} value={shop.id}>
                        {shop.title} ({shop.salesChannel})
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <p className="text-[11px] text-zinc-500">
                Blueprint {draft.preset.blueprintId} · provider {draft.preset.printProviderId} ·{' '}
                {draft.preset.colour}
                {draft.preset.printWidthPx ? (
                  <>
                    {' '}
                    · print area {draft.preset.printWidthPx}×{draft.preset.printHeightPx} px (
                    {(draft.preset.printWidthPx / 300).toFixed(1)}×
                    {((draft.preset.printHeightPx ?? 0) / 300).toFixed(1)} in at 300 DPI)
                  </>
                ) : null}
              </p>

              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[11px] font-medium text-zinc-400">Sizes and prices</p>
                  {/*
                    One price across every size. The sizes mostly share a price and the
                    ladder is the exception, so typing the common figure seven times is the
                    wrong default — set them all, then raise the big ones.
                  */}
                  <label className="ml-auto flex items-center gap-1.5 text-[11px] text-zinc-500">
                    set all to $
                    <input
                      aria-label="Price for every size"
                      className="field w-20 py-0.5"
                      value={bulkPrice}
                      onChange={(e) => setBulkPrice(e.target.value)}
                      placeholder="29.99"
                    />
                    <button
                      className="rounded border border-zinc-700 px-1.5 py-0.5 text-zinc-300 hover:border-zinc-500"
                      onClick={() => {
                        const cents = Math.round(Number(bulkPrice) * 100);
                        if (!Number.isFinite(cents) || cents <= 0) return;
                        patch({
                          variants: draft.preset.variants.map((v) => ({ ...v, priceCents: cents })),
                        });
                      }}
                    >
                      apply
                    </button>
                  </label>
                </div>
                <ul className="grid gap-1.5 sm:grid-cols-2">
                  {draft.preset.variants.map((variant) => (
                    <li key={variant.variantId} className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        aria-label={`Sell ${variant.size}`}
                        checked={!disabled.includes(variant.variantId)}
                        onChange={() =>
                          setDisabled((d) =>
                            d.includes(variant.variantId)
                              ? d.filter((x) => x !== variant.variantId)
                              : [...d, variant.variantId],
                          )
                        }
                      />
                      <span className="w-10 shrink-0 text-zinc-300">{variant.size}</span>
                      <span className="text-zinc-600">$</span>
                      <input
                        aria-label={`Price for ${variant.size}`}
                        className="field w-20 py-1"
                        value={(variant.priceCents / 100).toFixed(2)}
                        onChange={(e) => {
                          const cents = Math.round(Number(e.target.value || 0) * 100);
                          patch({
                            variants: draft.preset.variants.map((v) =>
                              v.variantId === variant.variantId
                                ? { ...v, priceCents: Number.isFinite(cents) ? cents : v.priceCents }
                                : v,
                            ),
                          });
                        }}
                      />
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-2">
                <p className="text-[11px] font-medium text-zinc-400">
                  Print areas
                  <span className="ml-2 font-normal text-zinc-600">
                    position is worked out per design from the trimmed art, so these are the
                    limits, not the coordinates
                  </span>
                </p>
                {Object.entries(draft.preset.placements).map(([area, placement]) => (
                  <div key={area} className="space-y-1.5 rounded border border-zinc-800 p-2">
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        aria-label={`Print the ${area}`}
                        checked={placement.enabled !== false}
                        onChange={(e) =>
                          patch({
                            placements: {
                              ...draft.preset.placements,
                              [area]: { ...placement, enabled: e.target.checked },
                            },
                          })
                        }
                      />
                      <span className="font-medium text-zinc-200">{area}</span>
                      <span className="text-zinc-600">
                        {placement.enabled === false
                          ? 'not printed — no placeholder is sent'
                          : 'printed'}
                      </span>
                    </label>

                    {placement.enabled !== false ? (
                      <div className="flex flex-wrap gap-3 pl-6 text-[11px] text-zinc-500">
                        {(
                          [
                            ['topDropIn', 'top below collar', 3],
                            ['maxWidthIn', 'max width', 12],
                            ['maxHeightIn', 'max height', 14],
                          ] as const
                        ).map(([field, label, fallback]) => (
                          <label key={field} className="flex items-center gap-1.5">
                            {label}
                            <input
                              aria-label={`${area} ${label}`}
                              className="field w-16 py-0.5"
                              value={placement[field] ?? fallback}
                              onChange={(e) => {
                                const value = Number(e.target.value);
                                patch({
                                  placements: {
                                    ...draft.preset.placements,
                                    [area]: {
                                      ...placement,
                                      [field]: Number.isFinite(value) ? value : fallback,
                                    },
                                  },
                                });
                              }}
                            />
                            in
                          </label>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>

              <label className="flex items-center gap-2 text-xs text-zinc-400">
                <input
                  type="checkbox"
                  checked={draft.preset.isDefault ?? false}
                  onChange={(e) => patch({ isDefault: e.target.checked })}
                />
                Use this preset by default
              </label>

              <div className="flex items-center gap-3">
                <button className="btn-primary" onClick={save} disabled={busy}>
                  {busy ? 'Saving…' : editing ? 'Save changes' : 'Save preset'}
                </button>
                <button
                  className="text-xs text-zinc-500 hover:text-zinc-300"
                  onClick={() => {
                    setDraft(null);
                    setEditing(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {error ? <p className="text-xs text-rose-400">{error}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
