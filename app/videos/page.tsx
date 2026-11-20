import { isConfigured } from '@/lib/supabase';
import { listRenders } from '@/lib/renders';
import { isAtlasConfigured, listVideoModels } from '@/lib/atlas';
import { budgetState } from '@/lib/budget';
import { listShots, listVideos } from '@/lib/video/data';
import { SetupNotice } from '@/app/setup/SetupNotice';
import { VideoStudio } from './VideoStudio';
import { VideoList } from './VideoList';

export const dynamic = 'force-dynamic';

export default async function VideosPage() {
  if (!isConfigured) return <SetupNotice />;

  if (!isAtlasConfigured()) {
    return (
      <div className="mx-auto w-full max-w-2xl px-5 py-10">
        <h1 className="text-base font-semibold">Video</h1>
        <p className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-5 text-sm leading-relaxed text-zinc-400">
          Set <code className="text-zinc-200">ATLAS_CLOUD_API_KEY</code> to turn renders into
          clips.
        </p>
      </div>
    );
  }

  const [renders, models, shots, videos, budget] = await Promise.all([
    listRenders(200),
    // A Printify or Atlas hiccup should not take the screen down with it.
    listVideoModels().catch(() => []),
    listShots(),
    listVideos(),
    budgetState(),
  ]);

  const finished = renders.filter((r) => r.status === 'done' && r.url);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-5 py-6">
      <div>
        <h1 className="text-base font-semibold">Video</h1>
        <p className="text-xs leading-relaxed text-zinc-500">
          A finished render becomes a vertical clip. This one costs money, so the price is
          shown before anything runs.
        </p>
      </div>

      {finished.length === 0 ? (
        <p className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-6 text-center text-sm text-zinc-400">
          No finished renders yet. Run a batch on the Renders screen and they will appear here.
        </p>
      ) : models.length === 0 ? (
        <p className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-6 text-center text-sm text-amber-400">
          Atlas did not return a model list. Try again in a moment.
        </p>
      ) : (
        <VideoStudio renders={finished} models={models} shots={shots} budget={budget} />
      )}

      <VideoList videos={videos} />
    </div>
  );
}
