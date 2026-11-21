/**
 * Turning a storage URL into something a browser will save.
 *
 * Kept apart from `lib/supabase.ts` on purpose: these two functions are pure string work and
 * the variant picker is a client component, so importing them from the module that holds the
 * service-role client would pull server-only code into the browser bundle.
 */

/**
 * The same signed URL, but asking storage to send it as a download.
 *
 * The HTML `download` attribute is ignored across origins, and storage is a different origin
 * from the app, so a plain `<a download>` opens the image in a tab instead of saving it.
 * Supabase honours a `download` query parameter by setting `Content-Disposition: attachment`,
 * which works regardless of origin and lets the filename be chosen.
 */
export function asDownload(url: string | null, filename: string): string | null {
  if (!url) return null;
  const joiner = url.includes('?') ? '&' : '?';
  return `${url}${joiner}download=${encodeURIComponent(filename)}`;
}

/** A filename a person would recognise: the design's own title, plus the real extension. */
export function downloadName(title: string, url: string, suffix = ''): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'design';
  const extension = /\.(png|jpe?g|webp)(\?|$)/i.exec(url)?.[1]?.toLowerCase() ?? 'png';
  return `${slug}${suffix}.${extension}`;
}
