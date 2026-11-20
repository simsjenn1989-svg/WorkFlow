import { formatUsd } from '@/lib/budget';
import type { VideoCard } from '@/lib/video/data';

/** What has been made, and what it cost. */
export function VideoList({ videos }: { videos: VideoCard[] }) {
  if (videos.length === 0) return null;

  const done = videos.filter((v) => v.status === 'done');
  const failed = videos.filter((v) => v.status === 'failed');

  return (
    <div className="space-y-5">
      {failed.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-rose-300">
            Failed <span className="font-normal text-zinc-500">{failed.length}</span>
          </h2>
          <ul className="divide-y divide-zinc-900 rounded-lg border border-zinc-800 text-xs">
            {failed.map((video) => (
              <li key={video.id} className="flex flex-wrap items-baseline gap-2 px-3 py-2">
                <span className="text-zinc-300">{video.design_title}</span>
                <span className="text-zinc-600">{video.model}</span>
                <span className="text-rose-400">{video.error}</span>
                <span className="ml-auto text-zinc-600">not charged</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {done.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">
            Clips <span className="font-normal text-zinc-500">{done.length}</span>
            <span className="ml-2 font-normal text-zinc-600">
              {formatUsd(done.reduce((sum, v) => sum + v.cost_cents, 0))} in total
            </span>
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {done.map((video) => (
              <figure key={video.id} className="space-y-1">
                <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
                  {video.url ? (
                    <video
                      src={video.url}
                      poster={video.posterUrl ?? undefined}
                      controls
                      loop
                      muted
                      playsInline
                      className="aspect-[9/16] w-full object-cover"
                    />
                  ) : null}
                </div>
                <figcaption className="truncate text-[11px] text-zinc-500">
                  {video.design_title}
                  <span className="text-zinc-600">
                    {' '}
                    · {video.duration_s}s · {formatUsd(video.cost_cents)}
                  </span>
                </figcaption>
                {video.url ? (
                  <a
                    href={video.url}
                    download
                    className="block text-[11px] text-zinc-500 hover:text-zinc-200"
                  >
                    download
                  </a>
                ) : null}
              </figure>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
