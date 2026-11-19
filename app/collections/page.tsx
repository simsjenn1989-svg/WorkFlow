import Link from 'next/link';
import { isConfigured } from '@/lib/supabase';
import { collectionCounts, listCollections } from '@/lib/data';
import { createCollection, deleteCollection } from '@/app/actions';
import { SetupNotice } from '@/app/setup/SetupNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { ActionForm } from '@/components/ActionForm';
import { DangerButton } from '@/components/DangerButton';

/**
 * Always rendered per request. The board reflects live database state, so a build-time
 * snapshot would be both stale and impossible to produce without network access.
 */
export const dynamic = 'force-dynamic';

export default async function CollectionsPage() {
  if (!isConfigured) return <SetupNotice />;

  const [collections, counts] = await Promise.all([listCollections(), collectionCounts()]);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-5 py-6">
      <section className="space-y-3">
        <div>
          <h1 className="text-base font-semibold">Collections</h1>
          <p className="text-xs text-zinc-500">
            A theme you run as a batch — all its designs through the same mockups and pins.
          </p>
        </div>

        <ActionForm
          action={createCollection}
          className="grid gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 sm:grid-cols-3"
          errorClassName="sm:col-span-3"
        >
          <label className="space-y-1 text-xs text-zinc-400">
            Name
            <input name="name" required maxLength={120} className="field" placeholder="Cozy Autumn" />
          </label>
          <label className="space-y-1 text-xs text-zinc-400">
            Theme
            <input name="theme" maxLength={200} className="field" placeholder="retro, warm tones" />
          </label>
          <label className="space-y-1 text-xs text-zinc-400">
            Notes
            <input name="notes" maxLength={2000} className="field" placeholder="optional" />
          </label>
          <div className="sm:col-span-3">
            <SubmitButton pendingLabel="Creating…">Create collection</SubmitButton>
          </div>
        </ActionForm>
      </section>

      <section className="space-y-2">
        {collections.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-500">
            No collections yet. Designs do not need one, but batching is much easier with them.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-900 rounded-lg border border-zinc-800">
            {collections.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-100">{c.name}</p>
                  <p className="truncate text-xs text-zinc-500">
                    {c.theme ?? 'No theme'}
                    {c.notes ? ` · ${c.notes}` : ''}
                  </p>
                </div>
                <Link href={{ pathname: '/', query: { collection: c.id } }} className="btn">
                  {counts[c.id] ?? 0} design{(counts[c.id] ?? 0) === 1 ? '' : 's'}
                </Link>
                <DangerButton
                  label="Delete"
                  confirmLabel="Really delete"
                  action={deleteCollection.bind(null, c.id)}
                />
              </li>
            ))}
          </ul>
        )}
        {collections.length > 0 ? (
          <p className="text-xs text-zinc-600">
            Deleting a collection keeps its designs — they just become uncollected.
          </p>
        ) : null}
      </section>
    </div>
  );
}
