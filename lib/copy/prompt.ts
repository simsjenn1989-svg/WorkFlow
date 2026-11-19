/**
 * The per-request half of the copywriting brief, ported from the original Pin Maker.
 *
 * The destination rules, headline rules and Amazon affiliate handling are carried over.
 * What changed is where the product description comes from: the old tool sent a downscaled
 * photo and asked the model to work out what it was looking at, because it had nothing else.
 * Here the design's own prompt, title, tags and product are known, so they are given as
 * text — better copy, no image tokens, and no risk of the model guessing wrong.
 */

export const DESTINATIONS = {
  'etsy-listing': 'an Etsy listing where the shopper can buy this exact item',
  'etsy-shop': "the seller's Etsy shop (or a shop section) with this item and similar products",
  store: "a product page on the seller's own online store",
  'tiktok-shop': 'a TikTok Shop listing where the shopper can buy this exact item',
  blog: 'a blog post or article',
  amazon:
    "an Amazon product page, through the creator's affiliate link. The creator recommends this product; they did not make it and do not sell it",
} as const;

export type Destination = keyof typeof DESTINATIONS;

export const TONES = [
  'friendly and warm',
  'playful',
  'calm and minimal',
  'bold and direct',
  'cosy and nostalgic',
] as const;

export type CopyRequest = {
  destination: Destination;
  tone: string;
  /** What the product is, in the seller's words. */
  product: string;
  /** Extra standing instructions from the seller. */
  instructions?: string;
  /** Headlines the seller starred, used as style examples. */
  examples?: string[];
};

export type CopyResult = {
  headlines: string[];
  subtitles: string[];
  cta: string;
  pinTitle: string;
  pinDescription: string;
};

export function buildCopyPrompt(request: CopyRequest): string {
  const blog = request.destination === 'blog';
  const amazon = request.destination === 'amazon';
  const likes = (request.examples ?? []).filter(Boolean).slice(-15);

  const amazonRules = amazon
    ? `
This is an Amazon affiliate Pin. Write as a curator recommending a great find (e.g. "The Amazon Find Every Mom Needs", "My Favorite Cozy Gift Under the Tree" style), never as the brand, maker or store. Rules:
- Don't claim the creator personally owns, uses or tested it unless their note says so.
- Never mention prices, deals, discounts, ratings, reviews, "bestseller", Prime or shipping (these change and can't be promised).
- Name the product type clearly so shoppers know exactly what they're getting.
- cta: e.g. "Shop now", "See it on Amazon", "Get yours".
- pinDescription: keep it under 380 characters (a disclosure line will be added separately; don't write one).
`
    : '';

  const headlineRules = blog
    ? `- headlines: 5 options, max 9 words each. This Pin links to an article, so curiosity, how-to, numbered lists and "why" hooks are welcome. Each headline uses a different angle.`
    : `- headlines: 5 options, max 8 words each. These are product ads, so make it clear something is for sale. At least 3 of the 5 must name the product type (e.g. "tee", "sweatshirt", "mug"). No questions, no "Why...", "How to...", "X ways/tips/ideas", "secret", "here's", or teaser lines that promise information instead of a product. Use a DIFFERENT angle for each: (1) the product plus its best benefit, (2) gift or occasion, (3) the outcome or feeling it gives, (4) the problem it solves, (5) a short, appealing shop-style product line.`;

  const subRules = blog
    ? `- subtitles: 3 options, max 8 words, what the reader will learn or get.`
    : `- subtitles: 3 options, max 8 words, a concrete reason to buy or what they get (use facts from the seller's note).`;

  const ctaRule = blog
    ? `- cta: 2-3 word button text (e.g. "Read more").`
    : `- cta: 2-3 word shopping button text (e.g. "Shop now", "Get yours").`;

  return `Write Pinterest Pin text for this product.

Where the Pin links: ${DESTINATIONS[request.destination] ?? DESTINATIONS['etsy-listing']}
Product (from the seller): ${request.product || '(not given)'}
Tone: ${request.tone}
${amazonRules}${request.instructions ? `\nSeller's instructions (follow these closely):\n${request.instructions}\n` : ''}${
    likes.length
      ? `\nHeadlines the seller loves. Match their style, length and voice (don't copy them):\n${likes.map((l) => `- ${l}`).join('\n')}\n`
      : ''
  }
Write:
${headlineRules}
${subRules}
${ctaRule}
- pinTitle: under 100 characters. This one is for Pinterest search, so lead with the keywords people search for this ${blog ? 'topic' : 'product'}, phrased naturally.
- pinDescription: 2-3 sentences, under 450 characters. Open with the benefit, ${blog ? 'say what the article covers' : 'make clear it is available to buy'}, and work in natural search keywords. No hashtags.

Reply with ONLY valid JSON in this exact shape:
{"headlines":["","","","",""],"subtitles":["","",""],"cta":"","pinTitle":"","pinDescription":""}`;
}

/** Coerce whatever came back into the shape the UI expects. */
export function normaliseResult(value: unknown): CopyResult | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const strings = (x: unknown): string[] =>
    Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string' && s.trim() !== '') : [];

  const headlines = strings(v.headlines);
  const subtitles = strings(v.subtitles);
  if (headlines.length === 0 && subtitles.length === 0) return null;

  return {
    headlines,
    subtitles,
    cta: typeof v.cta === 'string' ? v.cta : '',
    pinTitle: typeof v.pinTitle === 'string' ? v.pinTitle : '',
    pinDescription: typeof v.pinDescription === 'string' ? v.pinDescription : '',
  };
}
