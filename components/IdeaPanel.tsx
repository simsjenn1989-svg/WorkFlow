'use client';

import { useState } from 'react';
import { createIdea } from '@/app/actions';
import { ActionForm } from '@/components/ActionForm';
import { SubmitButton } from '@/components/SubmitButton';
import type { Collection } from '@/lib/types';

/**
 * Write down a design you intend to make, before it exists.
 *
 * Deliberately smaller than the upload panel beside it: an idea is a sentence you want out
 * of your head and onto the board, and anything that asks more of you than that gets
 * written somewhere else instead.
 */
export function IdeaPanel({ collections }: { collections: Collection[] }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button className="btn" onClick={() => setOpen(true)}>
        + New idea
      </button>
    );
  }

  return (
    <div className="w-80 space-y-3 rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">New idea</h2>
        <button className="text-xs text-zinc-500 hover:text-zinc-300" onClick={() => setOpen(false)}>
          close
        </button>
      </div>

      <ActionForm
        action={async (form) => {
          const result = await createIdea(form);
          // Closing only on success keeps what was typed on screen when it failed.
          if (result.ok) setOpen(false);
          return result;
        }}
        className="space-y-2"
      >
        <label className="block space-y-1 text-xs text-zinc-400">
          Title
          <input name="title" required maxLength={200} className="field" placeholder="Most likely to…" />
        </label>

        <label className="block space-y-1 text-xs text-zinc-400">
          The idea
          <textarea
            name="notes"
            rows={3}
            maxLength={5000}
            className="field"
            placeholder="Groovy retro lettering, cranberry and sage, a row of ugly sweaters"
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
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
          <label className="space-y-1 text-xs text-zinc-400">
            Tags
            <input name="tags" className="field" placeholder="christmas, funny" />
          </label>
        </div>

        <p className="text-[11px] leading-relaxed text-zinc-600">
          Lands in Idea with no image and nothing charged. The card gets a{' '}
          <span className="text-zinc-400">Generate this</span> button that opens the Generate
          screen with this text already in the prompt.
        </p>

        <SubmitButton pendingLabel="Saving…">Add to Idea</SubmitButton>
      </ActionForm>
    </div>
  );
}
