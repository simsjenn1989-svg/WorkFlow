/**
 * Small copies of images, for screens that only ever show them small.
 *
 * Every grid in the app was loading the full-resolution original to fill a 200px tile.
 * Measured: one board view pulled 156 MB for 29 cards, because a card's thumbnail is a
 * file of up to 27 MB; the Pins page pulled 67 MB; the Renders page about 578 MB. On a
 * free Supabase plan that is 5 GB of egress in roughly 31 board views, which is how the
 * allowance went.
 *
 * A 400px WebP of the same design is 49 KB — 0.64% of the original.
 *
 * Nothing that leaves the app uses these. Pinterest gets the saved pin at its own
 * 1000x1500, Atlas gets the full render, Printify gets the full print canvas. A thumbnail
 * only ever fills a tile.
 */

/** Widths worth caching. A closed set, so the route cannot be asked to make 500 variants. */
export const THUMB_WIDTHS = [200, 400, 800, 1600] as const;
export type ThumbWidth = (typeof THUMB_WIDTHS)[number];

/** Where a thumbnail lives, derived from the original so it needs no column of its own. */
export function thumbPath(path: string, width: ThumbWidth): string {
  return `thumbs/${width}/${path.replace(/\.[^./]+$/, '')}.webp`;
}

/**
 * The URL a grid should use.
 *
 * Served by the app rather than straight from storage, because the thumbnail may not exist
 * yet — the route makes it on first use. The answer is immutable for a given path and
 * width, so the browser is told to keep it for a year and the second view costs nothing at
 * all.
 */
export function thumbUrl(path: string | null, width: ThumbWidth = 400): string | null {
  if (!path) return null;
  return `/api/thumb?path=${encodeURIComponent(path)}&w=${width}`;
}
