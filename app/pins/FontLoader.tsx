'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CustomFont } from '@/lib/pins/fonts';
import { uploadFiles } from '@/lib/upload-client';

const ACCEPTED = ['.ttf', '.otf', '.woff', '.woff2'];
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Upload a font once and keep it.
 *
 * Registers every stored font with the document before the canvas draws — a canvas can only
 * use a family the document has actually loaded, so without this a pin set to a custom font
 * would silently fall back to a system face and you would not know until you looked closely.
 */
export function FontLoader({
  fonts,
  onReady,
  onApply,
}: {
  fonts: CustomFont[];
  onReady: (families: string[]) => void;
  onApply: (family: string) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const loadedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const ready: string[] = [];
      for (const font of fonts) {
        if (!font.url) continue;
        if (loadedRef.current.has(font.family)) {
          ready.push(font.family);
          continue;
        }
        try {
          const face = new FontFace(font.family, `url(${JSON.stringify(font.url)})`);
          await face.load();
          document.fonts.add(face);
          loadedRef.current.add(font.family);
          ready.push(font.family);
        } catch {
          // A font that will not load is skipped rather than breaking the whole list.
        }
      }
      if (!cancelled) onReady(ready);
    })();

    return () => {
      cancelled = true;
    };
  }, [fonts, onReady]);

  async function upload(file: File) {
    if (!ACCEPTED.some((ext) => file.name.toLowerCase().endsWith(ext))) {
      setError(`Use a ${ACCEPTED.join(', ')} file.`);
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('That font is larger than 10 MB.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const [uploaded] = await uploadFiles('font', [file]);
      if (!uploaded) throw new Error('Upload failed.');

      const response = await fetch('/api/fonts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: uploaded.id, path: uploaded.path, fileName: file.name }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Saving the font failed.');
      }

      // Use it straight away rather than waiting for the page data to come back.
      const family = `Custom-${file.name.replace(/\.[^.]+$/, '').replace(/[^\w-]/g, '') || 'Font'}-${uploaded.id.slice(0, 8)}`;
      const face = new FontFace(family, await file.arrayBuffer());
      await face.load();
      document.fonts.add(face);
      loadedRef.current.add(family);
      onApply(`'${family}', sans-serif`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await fetch('/api/fonts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <button className="btn w-full" onClick={() => inputRef.current?.click()} disabled={busy}>
        {busy ? 'Loading…' : '+ Upload a font'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(',')}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void upload(file);
        }}
      />

      {fonts.length > 0 ? (
        <ul className="space-y-1">
          {fonts.map((font) => (
            <li key={font.id} className="flex items-center gap-2 text-[11px] text-zinc-400">
              <span className="min-w-0 flex-1 truncate" style={{ fontFamily: `'${font.family}', sans-serif` }}>
                {font.name}
              </span>
              <button
                className="shrink-0 text-zinc-500 hover:text-zinc-200"
                onClick={() => onApply(`'${font.family}', sans-serif`)}
              >
                use
              </button>
              <button
                aria-label={`Delete font ${font.name}`}
                className="shrink-0 text-zinc-600 hover:text-rose-400"
                onClick={() => remove(font.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] leading-relaxed text-zinc-600">
          Uploaded fonts are kept, so a brand font only has to be added once.
        </p>
      )}

      {error ? <p className="text-xs text-rose-400">{error}</p> : null}
    </div>
  );
}
