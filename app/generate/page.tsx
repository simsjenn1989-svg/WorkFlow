import Link from 'next/link';
import { isConfigured } from '@/lib/supabase';
import { isAtlasConfigured, listImageModels } from '@/lib/atlas';
import { budgetState, formatUsd } from '@/lib/budget';
import { listCollections } from '@/lib/data';
import { listPrompts } from '@/lib/queries';
import { SetupNotice } from '@/app/setup/SetupNotice';
import { GenerateForm } from './GenerateForm';

export const dynamic = 'force-dynamic';

/** Sensible starting point: strong in-image text and a real alpha channel. */
const PREFERRED = 'openai/gpt-image-2.6-flare/text-to-image';

export default async function GeneratePage() {
  if (!isConfigured) return <SetupNotice />;

  if (!isAtlasConfigured()) {
    return (
      <div className="mx-auto max-w-xl space-y-3 px-5 py-12">
        <h1 className="text-base font-semibold">Atlas Cloud is not connected</h1>
        <p className="text-sm leading-relaxed text-zinc-400">
          Set <code className="text-zinc-300">ATLAS_CLOUD_API_KEY</code> to generate designs here.
          Everything else in the app works without it — you can still upload art by hand from the{' '}
          <Link href="/" className="underline hover:text-zinc-200">
            board
          </Link>
          .
        </p>
      </div>
    );
  }

  const [models, prompts, collections, budget] = await Promise.all([
    listImageModels(),
    listPrompts(),
    listCollections(),
    budgetState(),
  ]);

  const defaultModel = models.some((m) => m.model === PREFERRED)
    ? PREFERRED
    : (models[0]?.model ?? '');

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-5 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold">Generate</h1>
          <p className="text-xs text-zinc-500">
            New designs land in <span className="text-zinc-400">Generated</span>, where you pick the
            keeper.
          </p>
        </div>
        <div className="text-right text-xs">
          <p className={budget.warning ? 'text-amber-400' : 'text-zinc-400'}>
            {formatUsd(budget.spentCents)} of {formatUsd(budget.budgetCents)} used this month
          </p>
          <p className="text-zinc-600">{formatUsd(budget.remainingCents)} left</p>
        </div>
      </div>

      {models.length === 0 ? (
        <p className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 text-sm text-zinc-400">
          Atlas Cloud returned no text-to-image models. That is almost certainly a temporary
          problem at their end rather than anything wrong here.
        </p>
      ) : (
        <GenerateForm
          models={models}
          prompts={prompts}
          collections={collections}
          defaultModel={defaultModel}
          remainingCents={budget.remainingCents}
        />
      )}
    </div>
  );
}
