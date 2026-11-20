import { isConfigured } from '@/lib/supabase';
import { boardData } from '@/lib/data';
import { isPrintifyConfigured, listShops } from '@/lib/printify/client';
import { listPresets } from '@/lib/printify/presets';
import { draftedDesignIds, listDrafts } from '@/lib/printify/data';
import { listStyles } from '@/lib/listings/style';
import { listListings } from '@/lib/listings/data';
import { isAtlasConfigured } from '@/lib/atlas';
import { anthropicModels, DEFAULT_ATLAS_MODEL, type CopyModel } from '@/lib/copy/generate';
import { SetupNotice } from '@/app/setup/SetupNotice';
import { PresetEditor } from './PresetEditor';
import { PushRunner } from './PushRunner';
import { StylePanel } from './StylePanel';
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

  const [board, presets, drafts, drafted, styles, listings, shops] = await Promise.all([
    boardData(),
    listPresets(),
    listDrafts(),
    draftedDesignIds(),
    listStyles(),
    listListings(),
    // The shop list is only needed to name shops in the style panel; a Printify hiccup
    // should not take the whole screen down with it.
    listShops().catch(() => []),
  ]);

  // Same list the pin studio offers: Atlas writes by default, Claude joins when its key is set.
  const copyModels: CopyModel[] = isAtlasConfigured()
    ? [
        { id: DEFAULT_ATLAS_MODEL, label: 'DeepSeek V4.1 Flash — fast, reliable JSON', provider: 'atlas' },
        { id: 'zai-org/glm-5.3-flash', label: 'GLM 5.3 Flash', provider: 'atlas' },
        ...anthropicModels(),
      ]
    : anthropicModels();

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

      <StylePanel
        styles={styles}
        shops={shops.map((shop) => ({ id: String(shop.id), title: shop.title }))}
      />

      <DraftList drafts={drafts} listings={listings} models={copyModels} styles={styles} />
    </div>
  );
}
