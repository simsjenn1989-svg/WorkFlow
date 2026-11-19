import Link from 'next/link';
import { STAGE_META, timeIn } from '@/lib/stages';
import type { DesignCard } from '@/lib/types';

export function DesignTile({ design }: { design: DesignCard }) {
  return (
    <Link
      href={`/designs/${design.id}`}
      className="group block overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900
                 transition hover:border-zinc-600"
    >
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
          <div className="flex h-full items-center justify-center text-xs text-zinc-600">
            No image yet
          </div>
        )}
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
  );
}
