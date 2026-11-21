import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isConfigured } from '@/lib/supabase';
import { asDownload, downloadName } from '@/lib/download';
import { getDesign, getStageHistory, listCollections, thingsMadeFrom } from '@/lib/data';
import { deleteDesign, updateDesign } from '@/app/actions';
import { STAGE_META, timeIn } from '@/lib/stages';
import { SetupNotice } from '@/app/setup/SetupNotice';
import { StageControls } from '@/components/StageControls';
import { SubmitButton } from '@/components/SubmitButton';
import { ActionForm } from '@/components/ActionForm';
import { DangerButton } from '@/components/DangerButton';
import { VariantPicker } from '@/components/VariantPicker';
import { listVariants } from '@/lib/queries';
import { listArtworks } from '@/lib/artworks';
import { ArtworkPanel } from '@/components/ArtworkPanel';

export const dynamic = 'force-dynamic';

export default async function DesignPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isConfigured) return <SetupNotice />;

  const { id } = await params;
  const design = await getDesign(id);
  if (!design) notFound();

  const [history, collections, variants, artworks, belongings] = await Promise.all([
    getStageHistory(id),
    listCollections(),
    listVariants(id),
    listArtworks(id),
    // What deleting this design would take with it. Counted so the warning states numbers
    // rather than a vague "and related items".
    thingsMadeFrom(id),
  ]);
  const meta = STAGE_META[design.stage];
  /** Placements the unpicked variants are for — the choice made when they were generated. */
  const pending = [...new Set(variants.filter((v) => !v.chosen).map((v) => v.label))];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-5 py-6">
      <div className="flex items-center gap-3 text-xs text-zinc-500">
        <Link href="/" className="hover:text-zinc-300">
          ← Board
        </Link>
        <span>·</span>
        <span className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${meta.accent}`} aria-hidden />
          {meta.label} for {timeIn(design.stage_changed_at)}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="overflow-hidden rounded-lg border border-zinc-800 bg-[repeating-conic-gradient(#27272a_0%_25%,#18181b_0%_50%)] bg-[length:20px_20px]">
              {design.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={design.image_url}
                  alt={design.title}
                  className="max-h-[60vh] w-full object-contain"
                />
              ) : (
                <div className="flex h-64 items-center justify-center text-sm text-zinc-600">
                  No image yet
                </div>
              )}
            </div>

            {design.image_url ? (
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <a
                  className="btn"
                  href={asDownload(design.image_url, downloadName(design.title, design.image_url))!}
                >
                  Download PNG
                </a>
                <span className="text-zinc-600">
                  {artworks.length === 0
                    ? 'The generated image, transparent background and all. Pick a keeper to use it on a product.'
                    : 'The chosen artwork, at full size.'}
                </span>
              </div>
            ) : null}
          </div>

          <VariantPicker designId={design.id} title={design.title} variants={variants} />

          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
            <StageControls designId={design.id} stage={design.stage} />
            <p className="mt-2 text-xs text-zinc-500">
              {meta.hint}
              {meta.phase ? (
                <span className="text-zinc-600"> · automated in phase {meta.phase}</span>
              ) : null}
            </p>
          </div>

          <ActionForm
            action={updateDesign.bind(null, design.id)}
            className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4"
          >
            <h2 className="text-sm font-semibold">Details</h2>
            <label className="block space-y-1 text-xs text-zinc-400">
              Title
              <input name="title" defaultValue={design.title} required maxLength={200} className="field" />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs text-zinc-400">
                Collection
                <select name="collectionId" defaultValue={design.collection_id ?? ''} className="field">
                  <option value="">None</option>
                  {collections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs text-zinc-400">
                Tags, comma separated
                <input name="tags" defaultValue={design.tags.join(', ')} className="field" />
              </label>
            </div>
            <label className="block space-y-1 text-xs text-zinc-400">
              Notes
              <textarea name="notes" defaultValue={design.notes ?? ''} rows={3} maxLength={5000} className="field" />
            </label>
            <div className="flex items-center justify-between gap-3">
              <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
              <DangerButton
                label="Delete design"
                confirmLabel="Really delete"
                action={deleteDesign.bind(null, design.id)}
                onDone="/"
              />
            </div>

            {belongings.total > 0 ? (
              <p className="text-[11px] leading-relaxed text-amber-500/90">
                Deleting also removes{' '}
                {[
                  belongings.renders && `${belongings.renders} render${belongings.renders === 1 ? '' : 's'}`,
                  belongings.pins && `${belongings.pins} pin${belongings.pins === 1 ? '' : 's'}`,
                  belongings.videos && `${belongings.videos} clip${belongings.videos === 1 ? '' : 's'}`,
                ]
                  .filter(Boolean)
                  .join(', ')}{' '}
                and their files.
                {belongings.drafts > 0 ? (
                  <>
                    {' '}
                    The {belongings.drafts === 1 ? 'draft' : `${belongings.drafts} drafts`} already
                    pushed to Printify {belongings.drafts === 1 ? 'stays' : 'stay'} in your shop —
                    delete {belongings.drafts === 1 ? 'it' : 'them'} there too.
                  </>
                ) : null}
              </p>
            ) : null}
          </ActionForm>
        </div>

        <aside className="space-y-4">
          <ArtworkPanel designId={design.id} artworks={artworks} variants={variants} />

          <section className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
            <h2 className="mb-3 text-sm font-semibold">Provenance</h2>
            <dl className="space-y-2 text-xs">
              <Row label="Model" value={design.source_model} />
              <Row label="Seed" value={design.seed} />
              <Row label="Created" value={new Date(design.created_at).toLocaleString()} />
              {/*
                A variant carries the placement chosen on the Generate screen, and that is
                what it becomes when it is picked. Saying "none yet" while a variant sits
                there labelled `back` reads as though the choice was thrown away, which is
                how this looked to the person using it.
              */}
              <Row
                label="Placements"
                value={
                  design.artwork_labels.join(', ') ||
                  (pending.length > 0 ? `${pending.join(', ')} — once a keeper is picked` : 'none yet')
                }
              />
            </dl>
            {!design.source_model ? (
              <p className="mt-3 text-[11px] leading-relaxed text-zinc-600">
                Uploaded by hand, so there is no prompt to trace. Designs generated in phase 2
                record their prompt, model and seed here.
              </p>
            ) : null}
          </section>

          <section className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
            <h2 className="mb-3 text-sm font-semibold">History</h2>
            {history.length === 0 ? (
              <p className="text-xs text-zinc-600">No stage changes yet.</p>
            ) : (
              <ol className="space-y-2 text-xs">
                {history.map((event) => (
                  <li key={event.id} className="flex items-baseline gap-2">
                    <span
                      className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${STAGE_META[event.to_stage].accent}`}
                      aria-hidden
                    />
                    <span className="text-zinc-300">
                      {event.from_stage ? `${STAGE_META[event.from_stage].label} → ` : ''}
                      {STAGE_META[event.to_stage].label}
                    </span>
                    <span className="ml-auto shrink-0 text-zinc-600">
                      {timeIn(event.created_at)} ago
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="truncate text-right text-zinc-300">{value ?? '—'}</dd>
    </div>
  );
}
