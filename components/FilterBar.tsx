import Link from 'next/link';
import type { Collection } from '@/lib/types';

/**
 * Plain GET form, so filters are shareable URLs and survive a reload with no client state.
 */
export function FilterBar({
  collections,
  tags,
  active,
}: {
  collections: Collection[];
  tags: { tag: string; count: number }[];
  active: { collectionId?: string; tag?: string; q?: string };
}) {
  const filtering = Boolean(active.collectionId || active.tag || active.q);

  return (
    <form className="flex flex-wrap items-end gap-2" action="/">
      <label className="space-y-1 text-xs text-zinc-400">
        Search
        <input
          name="q"
          defaultValue={active.q ?? ''}
          className="field w-44 py-1.5"
          placeholder="Title contains…"
        />
      </label>

      <label className="space-y-1 text-xs text-zinc-400">
        Collection
        <select name="collection" defaultValue={active.collectionId ?? ''} className="field w-40 py-1.5">
          <option value="">All</option>
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <label className="space-y-1 text-xs text-zinc-400">
        Tag
        <select name="tag" defaultValue={active.tag ?? ''} className="field w-40 py-1.5">
          <option value="">All</option>
          {tags.map(({ tag, count }) => (
            <option key={tag} value={tag}>
              {tag} ({count})
            </option>
          ))}
        </select>
      </label>

      <button type="submit" className="btn">
        Apply
      </button>
      {filtering ? (
        <Link href="/" className="btn">
          Clear
        </Link>
      ) : null}
    </form>
  );
}
