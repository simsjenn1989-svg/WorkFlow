import type { ListingStyle, Sample } from './style';

/**
 * The brief for one listing.
 *
 * The model is asked for the written parts and nothing else. Fabric, care and measurements
 * come from the style record, which took them from the shop's real listings — a model asked
 * to reproduce a size chart will eventually produce a wrong one, and a wrong measurement is
 * a return rather than a typo.
 */

export type ListingRequest = {
  style: ListingStyle;
  /** What the design is, in the seller's own words. */
  designTitle: string;
  designTags: string[];
  designPrompt?: string | null;
  /** Placements that actually carry art — "front", or "front and back". */
  printedAreas: string[];
  /** Real listings from the same shop, used as voice examples. */
  examples: Sample[];
  /** Anything specific to this one product. */
  note?: string;
};

/** What the model is asked to return, and nothing more. */
export type ListingParts = {
  hook: string;
  what: string;
  wear: string;
  titleChunks: string[];
  tags: string[];
};

export const LISTING_SYSTEM_PROMPT = `You write product listings for a print-on-demand clothing shop.

You write in the shop's existing voice: warm, funny, a little unhinged, never corporate. Short sentences. No em dashes. No hashtags. No ALL CAPS except where the design itself uses them.

You reply with a single JSON object and nothing else. No preamble, no code fence, no commentary.`;

export function buildListingPrompt(request: ListingRequest): string {
  const { style } = request;
  const conceptTagCount = Math.max(1, style.tag_count - style.tail_tags.length);
  const bothSides = request.printedAreas.length > 1;

  const examples = request.examples
    .slice(0, 3)
    .map(
      (sample, i) => `Example ${i + 1}
Title: ${sample.title}
Tags: ${sample.tags.join(', ')}
${sample.paragraphs.join('\n')}`,
    )
    .join('\n\n');

  return `Write the listing for this design.

THE DESIGN
Title the seller gave it: ${request.designTitle}
${request.designTags.length ? `Their tags: ${request.designTags.join(', ')}\n` : ''}${
    request.designPrompt ? `The prompt it was generated from: ${request.designPrompt}\n` : ''
  }Printed on: ${request.printedAreas.join(' and ')}${
    bothSides
      ? ' — so the front and the back are different, and the listing should say what each one shows'
      : ''
  }
Product: Comfort Colors 1717 garment-dyed t-shirt, black.
${request.note ? `\nThe seller adds: ${request.note}\n` : ''}
${examples ? `HOW THIS SHOP WRITES\nMatch the rhythm and the structure of these, not their subject.\n\n${examples}\n` : ''}${
    style.voice_note ? `\nSTANDING INSTRUCTION FROM THE SELLER\n${style.voice_note}\n` : ''
  }
WHAT TO WRITE

"hook" — one line, under 60 characters, ending in a single emoji that fits. The scroll-stopper.
"what" — one or two sentences saying plainly what is on the shirt${
    bothSides ? ', front and back' : ''
  }. Concrete, not abstract.
"wear" — two sentences: where someone would wear it, then "It's also the perfect gift for ..." and who.
"titleChunks" — exactly ${style.title_chunks} search phrases, in order, each a different angle on the same shirt. These become the title, so they are keyword phrases a shopper would type, not a sentence. Use the words "Shirt", "Tee" and "T-Shirt" across different chunks rather than repeating one. ${
    style.title_suffix ? `"${style.title_suffix}" is added automatically — do not include it.` : ''
  } The whole title must stay under ${style.title_char_limit} characters, so keep each chunk to about ${Math.max(
    20,
    Math.floor((style.title_char_limit - style.title_suffix.length - 2) / style.title_chunks) - 2,
  )} characters.
"tags" — exactly ${conceptTagCount} tags specific to this design. ${
    style.tail_tags.length
      ? `${style.tail_tags.join(', ')} are added automatically — do not repeat them.`
      : ''
  } Each must be at most ${style.tag_char_limit} characters, which is a hard limit. Title Case. What a shopper searches, not a description.

Reply with exactly this shape:
{"hook":"...","what":"...","wear":"...","titleChunks":["..."],"tags":["..."]}`;
}

/** Coerce whatever came back into the shape, or null when it is not usable. */
export function normaliseParts(value: unknown): ListingParts | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;

  const text = (key: string): string => (typeof raw[key] === 'string' ? (raw[key] as string).trim() : '');
  const list = (key: string): string[] =>
    Array.isArray(raw[key])
      ? (raw[key] as unknown[]).filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean)
      : [];

  const parts: ListingParts = {
    hook: text('hook'),
    what: text('what'),
    wear: text('wear'),
    titleChunks: list('titleChunks'),
    tags: list('tags'),
  };

  // A reply with no title chunks cannot produce a listing; the rest can be edited by hand.
  if (parts.titleChunks.length === 0) return null;
  return parts;
}
