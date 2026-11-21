import Link from 'next/link';
import type { Route } from 'next';
import { STAGE_META, timeIn } from '@/lib/stages';
import type { DesignCard } from '@/lib/types';

/**
 * What the tile should say about a design with no chosen artwork.
 *
 * "No image yet" was shown for every case, including a design whose generation had finished
 * hours ago with two usable images sitting unpicked. That reads as a failure when the only
 * thing missing is a decision.
 */
function describe(design: DesignCard): { empty: string; badge: string | null; tone: string } {
  const job = design.job;

  if (job && (job.status === 'queued' || job.status === 'running')) {
    return {
      empty: `Generating since ${timeIn(job.createdAt)} ago`,
      badge: 'generating',
      tone: 'bg-sky-500/20 text-sky-200',
    };
  }
  if (job?.status === 'failed') {
    return {
      empty: job.error ? `Failed: ${job.error}` : 'Generation failed',
      badge: 'failed',
      tone: 'bg-rose-500/20 text-rose-200',
    };
  }
  if (design.unchosen_variants > 0) {
    return {
      empty: '',
      badge: `pick 1 of ${design.unchosen_variants}`,
      tone: 'bg-amber-500/20 text-amber-200',
    };
  }
  if (design.stage === 'idea') {
    return { empty: design.notes?.trim() || 'Not generated yet', badge: null, tone: '' };
  }
  return { empty: 'No image yet', badge: null, tone: '' };
}

/** Generate, prefilled from the failed job, onto the same design. */
function retryHref(design: DesignCard): Route {
  const r = design.job?.retry;
  const params = new URLSearchParams({
    designId: design.id,
    ...(r ? { prompt: r.prompt, model: r.model, count: String(r.count), label: r.label } : {}),
  });
  // typedRoutes cannot see through a built query string; the path itself is a real route.
  return `/generate?${params}` as Route;
}

/** Generate, prefilled from the idea's own words, onto the same design. */
function generateHref(design: DesignCard): Route {
  const params = new URLSearchParams({
    designId: design.id,
    // The notes are the draft prompt; the title is the fallback, because an idea written as
    // a title alone is still an idea.
    prompt: design.notes?.trim() || design.title,
  });
  return `/generate?${params}` as Route;
}

export function DesignTile({ design }: { design: DesignCard }) {
  const status = describe(design);
  // An idea has nothing to retry and no image to pick; what it needs is to be made.
  const waiting = design.stage === 'idea' && !design.job && design.artwork_labels.length === 0;
  return (
    // The card is a link, but Retry is a second destination, so the two are siblings inside
    // a positioned wrapper rather than one nested in the other: a link inside a link is
    // invalid HTML and browsers resolve it unpredictably.
    <div className="group relative overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 transition hover:border-zinc-600">
      <Link href={`/designs/${design.id}`} className="block">
      <div className="relative aspect-square bg-[repeating-conic-gradient(#27272a_0%_25%,#18181b_0%_50%)] bg-[length:16px_16px]">
        {design.image_url ? (
          /* Signed, expiring URLs — next/image would cache them past their lifetime. */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={design.image_url}
            alt={design.title}
            className="h-full w-full object-contain"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center px-3 text-center text-xs text-zinc-600">
            {status.empty}
          </div>
        )}

        {/*
          A badge rather than silence. The thumbnail now falls back to an unpicked variant,
          so without this a design waiting on a decision looks identical to a finished one.
        */}
        {status.badge ? (
          <span
            className={`absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[10px] ${status.tone}`}
          >
            {status.badge}
          </span>
        ) : null}

        {/*
          Retry reopens Generate with the same prompt, model and count rather than firing a
          new job on one click. Generating costs money, and this app's rule is that nothing
          paid runs without the price being shown and confirmed — a silent one-click retry
          would quietly break that.
        */}
      </div>
      <div className="space-y-1 p-2.5">
        <p className="truncate text-sm font-medium text-zinc-100" title={design.title}>
          {design.title}
        </p>
        <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-500">
          <span className="truncate">{design.collection_name ?? 'No collection'}</span>
          <span className="shrink-0" title={`In ${STAGE_META[design.stage].label} for this long`}>
            {timeIn(design.stage_changed_at)}
          </span>
        </div>
        {design.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {design.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                {tag}
              </span>
            ))}
            {design.tags.length > 3 ? (
              <span className="text-[10px] text-zinc-600">+{design.tags.length - 3}</span>
            ) : null}
          </div>
        ) : null}
      </div>
      </Link>

      {/*
        Retry reopens Generate with the same prompt, model and count rather than firing a new
        job on one click. Generating costs money, and this app's rule is that nothing paid
        runs without the price being shown and confirmed; a silent one-click retry would
        quietly break that.
      */}
      {design.job?.status === 'failed' && design.job.retry ? (
        <Link
          href={retryHref(design)}
          className="absolute right-1.5 top-1.5 z-10 rounded bg-zinc-200 px-2 py-0.5 text-[10px]
                     font-medium text-zinc-900 hover:bg-white"
        >
          Retry
        </Link>
      ) : null}

      {waiting ? (
        <Link
          href={generateHref(design)}
          className="absolute right-1.5 top-1.5 z-10 rounded bg-zinc-200 px-2 py-0.5 text-[10px]
                     font-medium text-zinc-900 hover:bg-white"
        >
          Generate this
        </Link>
      ) : null}
    </div>
  );
}
