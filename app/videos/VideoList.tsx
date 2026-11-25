'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatUsd } from '@/lib/budget';
import { asDownload } from '@/lib/download';
import type { VideoCard } from '@/lib/video/data';
import { deleteVideos } from './actions';

/**
 * What has been made, what is still coming, and what it cost.
 *
 * In-flight clips are listed, which they were not at first — and that omission is what made
 * a job that failed at Atlas look like nothing had happened at all. A row sat at "running"
 * in the database, this list rendered only finished and failed ones, and nothing re-polled
 * after the page was left, so a clip could be invisible forever while the screen claimed it
 * would appear when it was done.
 *
 * Now anything in flight shows here and is polled again whenever this page is open, so
 * leaving and coming back collects it.
 *
 * Clips can also be deleted and actually downloaded, which they could not be: the only
 * affordance was a link carrying the HTML `download` attribute, and browsers ignore that
 * across origins — storage is a different origin, so clicking played the clip in a tab
 * instead of saving it. Selection plus a two-step delete, matching the Renders and Pins
 * screens.
 */
export function VideoList({ videos }: { videos: VideoCard[] }) {
  const router = useRouter();
  const [checking, setChecking] = useState<string[]>([]);
  const polled = useRef<Set<string>>(new Set());

  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const inFlight = videos.filter((v) => v.status === 'running' || v.status === 'queued');
  const done = videos.filter((v) => v.status === 'done');
  const failed = videos.filter((v) => v.status === 'failed');

  const selecting = chosen.size > 0;

  async function check(id: string) {
    setChecking((c) => [...c, id]);
    try {
      await fetch(`/api/videos/${id}`);
      router.refresh();
    } finally {
      setChecking((c) => c.filter((x) => x !== id));
    }
  }

  // Resume anything left in flight, once per row per mount. This is the half that makes
  // "you can leave this page" true.
  useEffect(() => {
    for (const video of inFlight) {
      if (polled.current.has(video.id)) continue;
      polled.current.add(video.id);
      void check(video.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inFlight.map((v) => v.id).join(',')]);

  function toggle(id: string) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setConfirming(false);
  }

  function remove(ids: string[]) {
    setError(null);
    start(async () => {
      const result = await deleteVideos(ids);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setChosen(new Set());
      setConfirming(false);
      router.refresh();
    });
  }

  if (videos.length === 0) return null;

  return (
    <div className="space-y-5">
      {inFlight.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-sky-300">
            Still going <span className="font-normal text-zinc-500">{inFlight.length}</span>
          </h2>
          <ul className="divide-y divide-zinc-900 rounded-lg border border-zinc-800 text-xs">
            {inFlight.map((video) => (
              <li key={video.id} className="flex flex-wrap items-baseline gap-2 px-3 py-2">
                <span className="text-zinc-300">{video.design_title}</span>
                <span className="text-zinc-600">{video.model}</span>
                <span className="text-zinc-600">{age(video.created_at)}</span>
                {video.error ? (
                  <span className="text-amber-500/90" title="Retried automatically">
                    last try: {video.error}
                  </span>
                ) : null}
                <button
                  className="ml-auto text-zinc-400 hover:text-zinc-100"
                  onClick={() => check(video.id)}
                  disabled={checking.includes(video.id)}
                >
                  {checking.includes(video.id) ? 'checking…' : 'check now'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {failed.length > 0 ? (
        <section className="space-y-2">
          <h2 className="flex flex-wrap items-baseline gap-2 text-sm font-semibold text-rose-300">
            Failed <span className="font-normal text-zinc-500">{failed.length}</span>
            {/*
              Nothing was charged for these, so clearing them is housekeeping rather than a
              decision — one button for the lot, still two taps.
            */}
            <button
              className={`btn ml-auto ${clearing ? 'text-rose-400 hover:text-rose-300' : ''}`}
              disabled={pending}
              onClick={() => {
                if (!clearing) {
                  setClearing(true);
                  return;
                }
                setClearing(false);
                remove(failed.map((v) => v.id));
              }}
            >
              {pending ? 'Clearing…' : clearing ? 'Really clear' : 'Clear failed'}
            </button>
          </h2>
          <ul className="divide-y divide-zinc-900 rounded-lg border border-zinc-800 text-xs">
            {failed.map((video) => (
              <li key={video.id} className="flex flex-wrap items-baseline gap-2 px-3 py-2">
                <span className="text-zinc-300">{video.design_title}</span>
                <span className="text-zinc-600">{video.model}</span>
                <span className="min-w-0 flex-1 text-rose-400">{video.error}</span>
                <span className="shrink-0 text-zinc-600">not charged</span>
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

          <div className="flex flex-wrap items-center gap-2 text-xs">
            {selecting ? (
              <>
                <span className="text-zinc-500">{chosen.size} selected</span>
                <button className="btn" onClick={() => setChosen(new Set())} disabled={pending}>
                  Clear
                </button>
                {/* Two taps: this deletes the files too, and there is no undo. */}
                <button
                  className={`btn ${confirming ? 'text-rose-400 hover:text-rose-300' : ''}`}
                  disabled={pending}
                  onClick={() => (confirming ? remove([...chosen]) : setConfirming(true))}
                >
                  {pending
                    ? 'Deleting…'
                    : confirming
                      ? `Really delete ${chosen.size}`
                      : `Delete ${chosen.size}`}
                </button>
              </>
            ) : null}
            <button
              className="btn"
              disabled={pending}
              onClick={() =>
                setChosen(chosen.size === done.length ? new Set() : new Set(done.map((v) => v.id)))
              }
            >
              {chosen.size === done.length ? 'Select none' : 'Select all'}
            </button>
          </div>

          {error ? <p className="text-xs text-rose-400">{error}</p> : null}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {done.map((video) => {
              const picked = chosen.has(video.id);
              return (
                <figure key={video.id} className="space-y-1">
                  <div
                    className={`overflow-hidden rounded-lg border bg-zinc-950 ${
                      picked ? 'border-emerald-500' : 'border-zinc-800'
                    }`}
                  >
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
                  <div className="flex items-center gap-2 text-[11px]">
                    <label className="flex items-center gap-1 text-zinc-500 hover:text-zinc-200">
                      <input
                        type="checkbox"
                        className="accent-emerald-500"
                        checked={picked}
                        onChange={() => toggle(video.id)}
                        disabled={pending}
                      />
                      select
                    </label>
                    {video.url ? (
                      /*
                        `download=` on the storage URL, not the HTML attribute: the attribute
                        is ignored across origins, which is why this played the clip in a tab
                        instead of saving it. Supabase turns the parameter into
                        Content-Disposition: attachment.
                      */
                      <a
                        href={asDownload(video.url, clipName(video)) ?? '#'}
                        className="ml-auto text-zinc-500 hover:text-zinc-200"
                      >
                        download
                      </a>
                    ) : null}
                  </div>
                </figure>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** A filename a person would recognise, keeping the clip's real extension. */
function clipName(video: VideoCard): string {
  const slug =
    video.design_title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'clip';
  const extension = /\.([a-z0-9]{3,4})$/i.exec(video.output_path ?? '')?.[1]?.toLowerCase() ?? 'mp4';
  return `${slug}.${extension}`;
}

function age(since: string): string {
  const mins = Math.floor((Date.now() - new Date(since).getTime()) / 60000);
  if (mins < 1) return 'just started';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  return `${hours} hour${hours === 1 ? '' : 's'} ago`;
}
