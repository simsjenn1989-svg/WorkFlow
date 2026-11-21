'use client';

import { useRef, useState } from 'react';
import { STYLES, buildReferencePrompt, styleById } from '@/lib/styles';
import { checkFiles, uploadFiles } from '@/lib/upload-client';

export type Reference = { path: string; url: string; name: string };

/**
 * Redraw an existing design in a different style.
 *
 * Upload a picture, pick a style, and the prompt is written for you. The prompt still goes
 * into the normal box afterwards and stays editable — the dropdown is a shortcut for writing
 * a good brief, not a separate hidden pipeline, so anything that can be typed by hand can be
 * adjusted here too.
 */
export function ReferencePanel({
  reference,
  onReference,
  onPrompt,
}: {
  reference: Reference | null;
  onReference: (reference: Reference | null) => void;
  /** Hands the written brief back to the main prompt box. */
  onPrompt: (prompt: string) => void;
}) {
  const [styleId, setStyleId] = useState(STYLES[0]!.id);
  const [extra, setExtra] = useState('');
  const [keepLettering, setKeepLettering] = useState(true);
  // Off by default: motifs are props bolted onto whatever the subject is, and leaving them
  // on makes every design in a style look like the last one.
  const [includeMotifs, setIncludeMotifs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const motifs = styleById(styleId)?.motifs ?? null;

  async function upload(file: File) {
    const problem = checkFiles([file]);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const [uploaded] = await uploadFiles('reference', [file]);
      if (!uploaded) throw new Error('Upload failed.');
      // A local preview, so the panel shows the picture without another round trip.
      onReference({ path: uploaded.path, url: URL.createObjectURL(file), name: file.name });
      write(styleId, extra, keepLettering, includeMotifs);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function write(style: string, more: string, lettering: boolean, motifs: boolean) {
    onPrompt(
      buildReferencePrompt({
        styleId: style,
        extra: more,
        keepLettering: lettering,
        includeMotifs: motifs,
      }),
    );
  }

  return (
    <section className="space-y-2.5 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Start from a reference</h2>
        <span className="text-[11px] text-zinc-600">optional</span>
      </div>

      {reference ? (
        <div className="flex gap-3">
          <div className="h-28 w-28 shrink-0 overflow-hidden rounded border border-zinc-800 bg-[repeating-conic-gradient(#27272a_0%_25%,#18181b_0%_50%)] bg-[length:12px_12px]">
            {/* A blob URL for the file just picked; next/image cannot help here. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={reference.url} alt={reference.name} className="h-full w-full object-contain" />
          </div>

          <div className="min-w-0 flex-1 space-y-2">
            <label className="block space-y-1 text-xs text-zinc-400">
              Style
              <select
                aria-label="Style"
                className="field"
                value={styleId}
                onChange={(e) => {
                  setStyleId(e.target.value);
                  write(e.target.value, extra, keepLettering, includeMotifs);
                }}
              >
                {STYLES.map((style) => (
                  <option key={style.id} value={style.id}>
                    {style.name}
                  </option>
                ))}
              </select>
            </label>

            <input
              aria-label="Anything to add"
              className="field py-1 text-xs"
              placeholder="anything to add — e.g. swap the reindeer for a cat"
              value={extra}
              onChange={(e) => {
                setExtra(e.target.value);
                write(styleId, e.target.value, keepLettering, includeMotifs);
              }}
            />

            <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-400">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={keepLettering}
                  onChange={(e) => {
                    setKeepLettering(e.target.checked);
                    write(styleId, extra, e.target.checked, includeMotifs);
                  }}
                />
                keep the wording
              </label>
              <button
                className="text-zinc-500 hover:text-zinc-200"
                onClick={() => {
                  onReference(null);
                  onPrompt('');
                }}
              >
                remove reference
              </button>
            </div>

            {/*
              Motifs are listed, not just toggled. A style that silently drew extra objects
              into every design is how a trademarked smiley ended up on a garment: the word
              lived in a prompt nobody could see. Naming them makes the choice reviewable.
            */}
            {motifs ? (
              <label className="flex items-start gap-1.5 text-[11px] leading-relaxed text-zinc-400">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={includeMotifs}
                  onChange={(e) => {
                    setIncludeMotifs(e.target.checked);
                    write(styleId, extra, keepLettering, e.target.checked);
                  }}
                />
                <span>
                  add this style&rsquo;s motifs
                  <span className="text-zinc-600"> — {motifs}</span>
                </span>
              </label>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <button className="btn w-full" onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? 'Uploading…' : '+ Upload an image to redraw'}
          </button>
          <p className="text-[11px] leading-relaxed text-zinc-600">
            Give it a design you like and pick a style. It redraws the same subject and layout
            in that style rather than recolouring the original, and the model switches to one
            that can read an image.
          </p>
        </>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void upload(file);
        }}
      />

      {error ? <p className="text-xs text-rose-400">{error}</p> : null}
    </section>
  );
}
