'use client';

import { useRef, useState, useTransition } from 'react';
import { uploadDesigns } from '@/app/actions';
import type { Collection } from '@/lib/types';

/**
 * Drag-and-drop or pick images to create designs. Phase 2 replaces this as the main way art
 * arrives, but manual upload stays — not every design will come from Atlas.
 */
export function UploadPanel({ collections }: { collections: Collection[] }) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const images = [...list].filter((f) => f.type.startsWith('image/'));
    if (images.length === 0) {
      setError('Those are not images.');
      return;
    }
    setError(null);
    setFiles((prev) => [...prev, ...images]);
  }

  function submit(form: HTMLFormElement) {
    if (files.length === 0) {
      setError('Pick at least one image.');
      return;
    }
    const data = new FormData(form);
    data.delete('files');
    for (const file of files) data.append('files', file);

    setError(null);
    start(async () => {
      const result = await uploadDesigns(data);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setFiles([]);
      setOpen(false);
      form.reset();
    });
  }

  if (!open) {
    return (
      <button className="btn-primary" onClick={() => setOpen(true)}>
        + Add designs
      </button>
    );
  }

  return (
    <form
      className="w-full max-w-xl space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit(e.currentTarget);
      }}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Add designs</h2>
        <button type="button" className="text-xs text-zinc-400 hover:text-zinc-200" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>

      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        className={`cursor-pointer rounded-md border-2 border-dashed p-6 text-center text-sm transition ${
          dragging ? 'border-zinc-500 bg-zinc-800/60' : 'border-zinc-800 text-zinc-400 hover:border-zinc-700'
        }`}
      >
        Drop PNG, JPG or WebP here, or click to choose
        <input
          ref={inputRef}
          type="file"
          name="files"
          accept="image/png,image/jpeg,image/webp"
          multiple
          hidden
          onChange={(e) => addFiles(e.target.files)}
        />
      </div>

      {files.length > 0 ? (
        <ul className="max-h-32 space-y-1 overflow-y-auto text-xs text-zinc-400">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2">
              <span className="truncate">{f.name}</span>
              <button
                type="button"
                className="text-zinc-500 hover:text-rose-400"
                onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs text-zinc-400">
          Title
          <input
            name="title"
            className="field"
            placeholder={files.length > 1 ? 'Numbered automatically' : 'Taken from the file name'}
          />
        </label>
        <label className="space-y-1 text-xs text-zinc-400">
          Collection
          <select name="collectionId" className="field">
            <option value="">None</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="space-y-1 text-xs text-zinc-400">
        Tags, comma separated
        <input name="tags" className="field" placeholder="halloween, retro, cat" />
      </label>

      {error ? <p className="text-xs text-rose-400">{error}</p> : null}

      <div className="flex items-center gap-2">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending
            ? 'Uploading…'
            : `Add ${files.length || ''} design${files.length === 1 ? '' : 's'}`.trim()}
        </button>
        <p className="text-xs text-zinc-500">Starts at Approved — the art already exists.</p>
      </div>
    </form>
  );
}
