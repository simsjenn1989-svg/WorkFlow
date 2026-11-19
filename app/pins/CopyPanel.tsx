'use client';

import { useEffect, useState } from 'react';
import { DESTINATIONS, TONES, type CopyResult } from '@/lib/copy/prompt';
import type { CopyModel } from '@/lib/copy/generate';
import { COPY_KEY, loadSettings, saveSettings } from '@/lib/pins/persist';

/**
 * Write the overlay text, then pick from what comes back.
 *
 * The chosen headline can be starred. Starred headlines are fed back as style examples next
 * time, which is how the copy learns a particular voice rather than a generic one.
 */
export function CopyPanel({
  models,
  renderId,
  onPick,
}: {
  models: CopyModel[];
  renderId: string;
  onPick: (patch: Partial<{ title: string; subtitle: string; pinTitle: string; pinDescription: string }>) => void;
}) {
  const [model, setModel] = useState(models[0]?.id ?? '');
  const [destination, setDestination] = useState<string>('etsy-listing');
  const [tone, setTone] = useState<string>(TONES[0]);
  // The note is about one product, so it is not remembered.
  const [note, setNote] = useState('');
  const [restored, setRestored] = useState(false);
  const [result, setResult] = useState<CopyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starred, setStarred] = useState<string[]>([]);

  // Read after mounting: this renders on the server too, and seeding state from
  // localStorage would make the two first renders disagree.
  useEffect(() => {
    const saved = loadSettings(COPY_KEY, { model: '', destination: 'etsy-listing', tone: TONES[0] as string });
    setDestination(saved.destination);
    setTone(saved.tone);
    // Only restore a model that is still on offer — a key may have been removed since.
    if (saved.model && models.some((m) => m.id === saved.model)) setModel(saved.model);
    setRestored(true);
  }, [models]);

  useEffect(() => {
    if (restored) saveSettings(COPY_KEY, { model, destination, tone });
  }, [model, destination, tone, restored]);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/pins/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, renderId: renderId || null, destination, tone, note }),
      });
      const body = (await response.json()) as CopyResult & { error?: string };
      if (!response.ok) {
        setError(body.error ?? 'Writing failed.');
        return;
      }
      setResult(body);
      // Apply the first option straight away: the common case is keeping it.
      onPick({
        title: body.headlines[0] ?? '',
        subtitle: body.subtitles[0] ?? '',
        pinTitle: body.pinTitle,
        pinDescription: body.pinDescription,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function star(text: string) {
    setStarred((s) => [...s, text]);
    await fetch('/api/pins/examples', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }).catch(() => {});
  }

  if (models.length === 0) {
    return (
      <p className="text-[11px] leading-relaxed text-zinc-600">
        Set <code className="text-zinc-400">ATLAS_CLOUD_API_KEY</code> to write copy here.
      </p>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-xs text-zinc-400">
          Links to
          <select
            aria-label="Destination"
            className="field"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          >
            {Object.keys(DESTINATIONS).map((k) => (
              <option key={k} value={k}>
                {k.replace(/-/g, ' ')}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs text-zinc-400">
          Tone
          <select className="field" value={tone} onChange={(e) => setTone(e.target.value)}>
            {TONES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block space-y-1 text-xs text-zinc-400">
        Anything to add
        <input
          name="note"
          className="field"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. runs oversized, ships in 2 days"
        />
      </label>

      <label className="block space-y-1 text-xs text-zinc-400">
        Model
        <select aria-label="Copy model" className="field" value={model} onChange={(e) => setModel(e.target.value)}>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>

      <button className="btn-primary w-full" onClick={generate} disabled={busy}>
        {busy ? 'Writing…' : 'Write copy'}
      </button>

      {error ? <p className="text-xs text-rose-400">{error}</p> : null}

      {result ? (
        <div className="space-y-2 border-t border-zinc-800 pt-2.5">
          <Options
            label="Headlines"
            items={result.headlines}
            onPick={(t) => onPick({ title: t })}
            onStar={star}
            starred={starred}
          />
          <Options
            label="Subtitles"
            items={result.subtitles}
            onPick={(t) => onPick({ subtitle: t })}
          />
          {result.pinTitle ? (
            <p className="text-[11px] leading-relaxed text-zinc-500">
              Pinterest title and description were filled in too — see the Pinterest fields
              section.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Options({
  label,
  items,
  onPick,
  onStar,
  starred = [],
}: {
  label: string;
  items: string[];
  onPick: (text: string) => void;
  onStar?: (text: string) => void;
  starred?: string[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium text-zinc-400">{label}</p>
      <ul className="space-y-1">
        {items.map((text) => (
          <li key={text} className="flex items-start gap-1.5">
            <button
              className="min-w-0 flex-1 rounded border border-zinc-800 px-2 py-1 text-left text-[11px] text-zinc-200 hover:border-zinc-600 hover:bg-zinc-800/60"
              onClick={() => onPick(text)}
            >
              {text}
            </button>
            {onStar ? (
              <button
                aria-label={`Star: ${text}`}
                title="Teach the copy your voice"
                className={`shrink-0 px-1 text-sm ${starred.includes(text) ? 'text-amber-400' : 'text-zinc-600 hover:text-amber-400'}`}
                onClick={() => onStar(text)}
                disabled={starred.includes(text)}
              >
                {starred.includes(text) ? '★' : '☆'}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
