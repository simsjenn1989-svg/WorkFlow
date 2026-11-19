'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { checkFiles, uploadFiles } from '@/lib/upload-client';
import type { Collection } from '@/lib/types';

/**
 * Drag-and-drop or pick images to create designs.
 *
 * Bytes go straight from the browser to storage rather than through a Server Action, which
 * caps a request body at 1 MB — small enough that a single real design file fails.
 */
export function UploadPanel({ collections }: { collections: Collection[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState('');
  const [collectionId, setCollectionId] = useState('');
  const [tags, setTags] = useState('');
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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

  async function submit() {
    const problem = checkFiles(files);
    if (problem) {
      setError(problem);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const uploaded = await uploadFiles('design', files, (done, total) =>
        setProgress(`Uploading ${done} of ${total}…`),
      );
      setProgress('Saving…');

      const response = await fetch('/api/designs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: uploaded,
          title: title.trim() || null,
          collectionId: collectionId || null,
          tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Saving failed.');
      }

      setFiles([]);
      setTitle('');
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  if (!open) {
    return (
      <button className="btn-primary" onClick={() => setOpen(true)}>
        + Add designs
      </button>
    );
  }

  return (
    <div className="w-full max-w-xl space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Add designs</h2>
        <button className="text-xs text-zinc-400 hover:text-zinc-200" onClick={() => setOpen(false)}>
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
          dragging
            ? 'border-zinc-500 bg-zinc-800/60'
            : 'border-zinc-800 text-zinc-400 hover:border-zinc-700'
        }`}
      >
        Drop PNG, JPG or WebP here, or click to choose
        <input
          ref={inputRef}
          type="file"
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
              <span className="truncate">
                {f.name}{' '}
                <span className="text-zinc-600">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
              </span>
              <button
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
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={files.length > 1 ? 'Numbered automatically' : 'Taken from the file name'}
          />
        </label>
        <label className="space-y-1 text-xs text-zinc-400">
          Collection
          <select
            className="field"
            value={collectionId}
            onChange={(e) => setCollectionId(e.target.value)}
          >
            <option value="">None</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block space-y-1 text-xs text-zinc-400">
        Tags, comma separated
        <input
          name="tags"
          className="field"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="halloween, retro, cat"
        />
      </label>

      {error ? <p className="text-xs text-rose-400">{error}</p> : null}

      <div className="flex items-center gap-3">
        <button className="btn-primary" onClick={submit} disabled={busy}>
          {busy
            ? 'Working…'
            : `Add ${files.length || ''} design${files.length === 1 ? '' : 's'}`.trim()}
        </button>
        {progress ? (
          <span className="text-xs text-zinc-500">{progress}</span>
        ) : (
          <p className="text-xs text-zinc-500">Starts at Approved — the art already exists.</p>
        )}
      </div>
    </div>
  );
}
