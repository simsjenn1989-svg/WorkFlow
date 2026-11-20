import { blocksFor, renderDescription } from './blocks';
import type { ListingParts } from './prompt';
import type { ListingStyle } from './style';

/**
 * Assembling the listing from the written parts and the style.
 *
 * Deterministic on purpose. Asking a model to respect a 140-character title and thirteen
 * tags of at most twenty characters mostly works, and "mostly" is how a listing gets
 * rejected at publish time. The limits are enforced here, where they cannot be ignored, and
 * what had to be cut is reported rather than silently applied.
 */

export type ComposedListing = {
  title: string;
  description: string;
  tags: string[];
  /** Anything the limits forced, so the editor can show it instead of hiding it. */
  adjustments: string[];
};

export function composeListing(
  parts: ListingParts,
  style: ListingStyle,
  facts: { bothSides: boolean },
): ComposedListing {
  const adjustments: string[] = [];

  // ---------------------------------------------------------------- title
  const chunks = parts.titleChunks.map(clean).filter(Boolean);
  const suffix = style.title_suffix.trim();

  let kept = [...chunks];
  const join = (list: string[]) => [...list, suffix].filter(Boolean).join(', ');

  // Drop written chunks from the end until it fits. The suffix stays: it is the part every
  // listing in the shop shares, so losing it would break the pattern rather than trim it.
  while (kept.length > 1 && join(kept).length > style.title_char_limit) kept.pop();
  if (kept.length < chunks.length) {
    adjustments.push(
      `Title was ${join(chunks).length} characters; dropped ${chunks.length - kept.length} phrase${
        chunks.length - kept.length === 1 ? '' : 's'
      } to fit ${style.title_char_limit}.`,
    );
  }

  let title = join(kept);
  if (title.length > style.title_char_limit) {
    // One chunk plus the suffix is still too long: cut at a word rather than mid-word.
    title = truncateWords(title, style.title_char_limit);
    adjustments.push(`Title was still too long and was cut to ${style.title_char_limit} characters.`);
  }

  // ---------------------------------------------------------------- tags
  const seen = new Set<string>();
  const tags: string[] = [];
  const dropped: string[] = [];

  const add = (raw: string, fromStyle: boolean) => {
    const tag = clean(raw);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) return;
    if (tag.length > style.tag_char_limit) {
      // Truncating a search tag makes it match nothing, so an over-long one is dropped.
      // A tail tag is the seller's own and is kept with a note instead.
      if (fromStyle) {
        seen.add(key);
        tags.push(tag);
        adjustments.push(`"${tag}" is ${tag.length} characters, over Etsy's ${style.tag_char_limit}.`);
      } else {
        dropped.push(tag);
      }
      return;
    }
    seen.add(key);
    tags.push(tag);
  };

  for (const tag of parts.tags) add(tag, false);
  for (const tag of style.tail_tags) add(tag, true);

  if (dropped.length > 0) {
    adjustments.push(
      `Dropped ${dropped.length} tag${dropped.length === 1 ? '' : 's'} over ${style.tag_char_limit} characters: ${dropped.join(', ')}.`,
    );
  }

  const trimmed = tags.slice(0, style.tag_count);
  if (tags.length > style.tag_count) {
    adjustments.push(`Kept the first ${style.tag_count} of ${tags.length} tags.`);
  } else if (trimmed.length < style.tag_count) {
    adjustments.push(`Only ${trimmed.length} of ${style.tag_count} tags — room for ${style.tag_count - trimmed.length} more.`);
  }

  // ---------------------------------------------------------------- description
  const paragraphs = [parts.hook, parts.what, parts.wear].map(clean).filter(Boolean);
  const description = renderDescription(paragraphs, blocksFor(style.blocks, facts));

  return { title, description, tags: trimmed, adjustments };
}

/** Collapse whitespace and strip any markup a model decided to add. */
function clean(text: string): string {
  return text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function truncateWords(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const space = cut.lastIndexOf(' ');
  return (space > limit * 0.6 ? cut.slice(0, space) : cut).trim();
}
