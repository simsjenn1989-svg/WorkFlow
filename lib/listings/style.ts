import { db } from '@/lib/supabase';
import { listShopProducts, type ShopProduct } from '@/lib/printify/client';
import { blockKey, parseDescription, type Block, type BlockLine } from './blocks';

/**
 * The house style: how this shop's listings are built.
 *
 * Derived from the shop's own live listings rather than written by hand. Reading what is
 * already selling is both more accurate than guessing and the only version that stays true
 * when the shop's voice moves on — re-deriving picks the change up.
 */

export type ListingStyle = {
  id: string;
  name: string;
  shop_id: string | null;
  title_suffix: string;
  title_chunks: number;
  tail_tags: string[];
  tag_count: number;
  tag_char_limit: number;
  title_char_limit: number;
  blocks: Block[];
  voice_note: string | null;
  learn_from_shop: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

export type StyleInput = Omit<ListingStyle, 'id' | 'created_at' | 'updated_at'>;

/** One of the shop's listings, reduced to what deriving a style needs. */
export type Sample = {
  title: string;
  tags: string[];
  paragraphs: string[];
  blocks: Block[];
  bothSides: boolean;
};

// ---------------------------------------------------------------- reading

export async function listStyles(): Promise<ListingStyle[]> {
  const { data, error } = await db()
    .from('listing_styles')
    .select('*')
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Loading listing styles failed: ${error.message}`);
  return (data ?? []) as ListingStyle[];
}

export async function getStyle(id: string): Promise<ListingStyle | null> {
  const { data } = await db().from('listing_styles').select('*').eq('id', id).maybeSingle();
  return (data as ListingStyle | null) ?? null;
}

export async function styleForShop(shopId: string): Promise<ListingStyle | null> {
  const { data } = await db()
    .from('listing_styles')
    .select('*')
    .eq('shop_id', shopId)
    .order('is_default', { ascending: false })
    .limit(1);
  const rows = (data ?? []) as ListingStyle[];
  if (rows[0]) return rows[0];

  const { data: fallback } = await db()
    .from('listing_styles')
    .select('*')
    .eq('is_default', true)
    .maybeSingle();
  return (fallback as ListingStyle | null) ?? null;
}

// ---------------------------------------------------------------- writing

export async function saveStyle(
  id: string | null,
  input: StyleInput,
): Promise<{ id: string | null; error: string | null }> {
  const row = { ...input, updated_at: new Date().toISOString() };

  // One default, enforced by a partial unique index; clearing the old one turns what would
  // be a constraint violation into an ordinary switch.
  if (row.is_default) {
    const clear = db().from('listing_styles').update({ is_default: false }).eq('is_default', true);
    await (id ? clear.neq('id', id) : clear);
  }

  if (id) {
    const { error } = await db().from('listing_styles').update(row).eq('id', id);
    return { id: error ? null : id, error: error?.message ?? null };
  }
  const { data, error } = await db().from('listing_styles').insert(row).select('id').single();
  return { id: (data as { id: string } | null)?.id ?? null, error: error?.message ?? null };
}

export async function deleteStyle(id: string): Promise<{ error: string | null }> {
  const { error } = await db().from('listing_styles').delete().eq('id', id);
  return { error: error?.message ?? null };
}

// ---------------------------------------------------------------- deriving

/** Agreement needed before something counts as part of the style rather than one listing's quirk. */
const AGREEMENT = 0.6;
const TAG_AGREEMENT = 0.8;

export async function sampleShop(shopId: string, limit = 20): Promise<Sample[]> {
  const products = await listShopProducts(shopId, limit);
  return products.map(toSample).filter((s) => s.paragraphs.length > 0 || s.blocks.length > 0);
}

export function toSample(product: ShopProduct): Sample {
  const parsed = parseDescription(product.description ?? '');
  return {
    title: product.title ?? '',
    tags: product.tags ?? [],
    paragraphs: parsed.paragraphs,
    blocks: parsed.blocks,
    bothSides: printedPositions(product).length > 1,
  };
}

/** Positions that actually carry art. A placeholder with no images is not a print. */
export function printedPositions(product: ShopProduct): string[] {
  const positions = new Set<string>();
  for (const area of product.print_areas ?? []) {
    for (const placeholder of area.placeholders ?? []) {
      if ((placeholder.images ?? []).length > 0) positions.add(placeholder.position);
    }
  }
  return [...positions];
}

export type Derived = {
  style: StyleInput;
  /** What the sample actually agreed on, for showing rather than asserting. */
  evidence: {
    sampled: number;
    titleSuffixSeenIn: number;
    tagCountMode: number;
    longestTag: number;
    blocksFound: { heading: string; seenIn: number; conditionalLines: number }[];
  };
};

/**
 * Work out the style from a set of the shop's listings.
 *
 * Nothing here is clever: it keeps what most of the listings agree on and discards the rest.
 * The one piece of real inference is the conditional line — a bullet that appears in every
 * two-sided listing and in none of the one-sided ones is recorded as belonging to two-sided
 * products, which is how "Printed on the front and back" stops being something to remember.
 */
export function deriveStyle(samples: Sample[], options: { name: string; shopId: string }): Derived {
  const usable = samples.filter((s) => s.title && s.tags.length > 0);
  const n = usable.length;

  // --- title suffix: the last comma-separated chunk, when most listings share it.
  const suffixes = new Map<string, number>();
  for (const sample of usable) {
    const last = sample.title.split(',').pop()?.trim();
    if (last) suffixes.set(last, (suffixes.get(last) ?? 0) + 1);
  }
  const [suffix, suffixSeen] = topEntry(suffixes);
  const titleSuffix = n > 0 && suffixSeen / n >= AGREEMENT ? suffix : '';

  // --- tail tags: the ones nearly every listing carries, kept in the order they appear in.
  const tagCounts = new Map<string, number>();
  const tagPositions = new Map<string, number[]>();
  for (const sample of usable) {
    sample.tags.forEach((tag, index) => {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      // Position from the END, since shared tags sit at the end of the list.
      const fromEnd = sample.tags.length - 1 - index;
      tagPositions.set(tag, [...(tagPositions.get(tag) ?? []), fromEnd]);
    });
  }
  const tailTags = [...tagCounts.entries()]
    .filter(([, count]) => n > 0 && count / n >= TAG_AGREEMENT)
    .sort((a, b) => mean(tagPositions.get(b[0])!) - mean(tagPositions.get(a[0])!))
    .map(([tag]) => tag);

  // --- the fixed blocks, matched by heading so a block that gains a line still matches.
  const byHeading = new Map<string, Block[]>();
  for (const sample of usable) {
    for (const block of sample.blocks) {
      byHeading.set(block.heading, [...(byHeading.get(block.heading) ?? []), block]);
    }
  }

  const twoSided = usable.filter((s) => s.bothSides);
  const oneSided = usable.filter((s) => !s.bothSides);

  const blocks: Block[] = [];
  const blocksFound: Derived['evidence']['blocksFound'] = [];

  for (const [heading, seen] of byHeading) {
    if (n === 0 || seen.length / n < AGREEMENT) continue;

    // The longest version carries every line, so it sets the canonical order.
    const canonical = seen.reduce((a, b) => (b.lines.length > a.lines.length ? b : a));

    const lines: BlockLine[] = canonical.lines.map((line) => {
      const inTwoSided = countWithLine(twoSided, heading, line.text);
      const inOneSided = countWithLine(oneSided, heading, line.text);
      const onlyTwoSided =
        twoSided.length > 0 && oneSided.length > 0 && inTwoSided === twoSided.length && inOneSided === 0;
      return onlyTwoSided ? { text: line.text, requires: 'both-sides' as const } : { text: line.text };
    });

    blocks.push({ heading, bulleted: canonical.bulleted, lines });
    blocksFound.push({
      heading,
      seenIn: seen.length,
      conditionalLines: lines.filter((l) => l.requires).length,
    });
  }

  // Keep the blocks in the order the longest description used them.
  const order = usable
    .reduce<Block[]>((best, sample) => (sample.blocks.length > best.length ? sample.blocks : best), [])
    .map((b) => b.heading);
  blocks.sort((a, b) => order.indexOf(a.heading) - order.indexOf(b.heading));

  const tagCountMode = mode(usable.map((s) => s.tags.length)) || 13;
  const longestTag = Math.max(0, ...usable.flatMap((s) => s.tags.map((t) => t.length)));

  return {
    style: {
      name: options.name,
      shop_id: options.shopId,
      title_suffix: titleSuffix,
      // The chunks the model writes: whatever is left once the shared suffix is removed.
      title_chunks: Math.max(1, Math.round(mean(usable.map((s) => s.title.split(',').length))) - (titleSuffix ? 1 : 0)),
      tail_tags: tailTags,
      tag_count: tagCountMode,
      // Etsy's limit, not the shop's habit: the sample's longest tag was over it, which is
      // the sort of slip worth catching rather than copying.
      tag_char_limit: 20,
      title_char_limit: 140,
      blocks,
      voice_note: null,
      learn_from_shop: true,
      is_default: false,
    },
    evidence: {
      sampled: n,
      titleSuffixSeenIn: titleSuffix ? suffixSeen : 0,
      tagCountMode,
      longestTag,
      blocksFound,
    },
  };
}

function countWithLine(samples: Sample[], heading: string, text: string): number {
  return samples.filter((s) =>
    s.blocks.some((b) => b.heading === heading && b.lines.some((l) => l.text === text)),
  ).length;
}

function topEntry(counts: Map<string, number>): [string, number] {
  let best: [string, number] = ['', 0];
  for (const entry of counts) if (entry[1] > best[1]) best = entry;
  return best;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function mode(values: number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = 0;
  let bestCount = 0;
  for (const [v, c] of counts) if (c > bestCount) [best, bestCount] = [v, c];
  return best;
}

/** Exported for the tests and the editor: two blocks are the same when their text matches. */
export { blockKey };
