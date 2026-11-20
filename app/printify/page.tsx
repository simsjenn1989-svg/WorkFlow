import { isConfigured } from '@/lib/supabase';
import { boardData } from '@/lib/data';
import { isPrintifyConfigured } from '@/lib/printify/client';
import { listPresets } from '@/lib/printify/presets';
import { draftedDesignIds, listDrafts } from '@/lib/printify/data';
import { isAtlasConfigured } from '@/lib/atlas';
import { SetupNotice } from '@/app/setup/SetupNotice';
import { PresetEditor } from './PresetEditor';
import { PushRunner } from './PushRunner';
import { DraftList } from './DraftList';

export const dynamic = 'force-dynamic';

export default async function PrintifyPage() {
  if (!isConfigured) return <SetupNotice />;

  if (!isPrintifyConfigured()) {
    return (
      <div className="mx-auto w-full max-w-2xl px-5 py-10">
        <h1 className="text-base font-semibold">Printify</h1>
        <p className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-5 text-sm leading-relaxed text-zinc-400">
          Set <code className="text-zinc-200">PRINTIFY_API_TOKEN</code> to push drafts. Make one
          at <span className="text-zinc-200">printify.com → Settings → Connections → API tokens</span>{' '}
          with the <span className="text-zinc-200">shops.manage</span> and{' '}
          <span className="text-zinc-200">uploads.write</span> scopes, then add it to the
          project&rsquo;s environment variables and redeploy.
        </p>
      </div>
    );
  }

  const [board, presets, drafts, drafted] = await Promise.all([
    boardData(),
    listPresets(),
    listDrafts(),
    draftedDesignIds(),
  ]);

  const designs = Object.values(board)
    .flat()
    .filter((d) => d.artwork_labels.length > 0)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-5 py-6">
      <div>
        <h1 className="text-base font-semibold">Printify</h1>
        <p className="text-xs leading-relaxed text-zinc-500">
          Designs become drafts in your shop. Nothing is published — you review and publish in
          Printify yourself.
        </p>
      </div>

      <PresetEditor presets={presets} />

      {presets.length > 0 ? (
        <PushRunner
          designs={designs}
          presets={presets}
          drafted={[...drafted]}
          atlasAvailable={isAtlasConfigured()}
        />
      ) : (
        <p className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-6 text-center text-sm text-zinc-400">
          Make a product preset first — it decides the blueprint, the sizes and what each one
          costs.
        </p>
      )}

      <DraftList drafts={drafts} />
    </div>
  );
}
