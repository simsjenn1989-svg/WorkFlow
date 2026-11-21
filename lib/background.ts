/**
 * What to tell an image model about the background, and how to undo what people type.
 *
 * Asking for a "transparent background" does not work, and fails in a way that looks like it
 * worked. Nano Banana 2.1 publishes no transparent output for text-to-image — the file comes
 * back three-channel, no alpha at all — so when the prompt insists on transparency the model
 * satisfies it the only way a painter can: it draws the grey-and-white checkerboard that
 * means "transparent" in an image editor. Measured on a real generation (prediction
 * bab8c23d, 5c): a 3584x4800 PNG, hasAlpha false, 100px squares of RGB(254,254,254) and
 * RGB(222,222,224) covering every part of the canvas the artwork did not.
 *
 * The cutout then made it worse. Two tones 96 apart, a flood tolerance of 60: the white
 * squares were removed and the grey ones kept, as a hard speckled halo around the art. Only
 * 55% of the image went, so the "this cutout ate the design" guard at 97% never fired and
 * the ruined variant was stored as if it were fine.
 *
 * So the rule is a chroma screen, the same one the style path has always used, applied to
 * every generation rather than only the ones that start from a reference.
 */

/** The background instruction every generation gets, whatever the person typed. */
export const CHROMA_SCREEN = [
  'Place the artwork on a completely solid flat background of pure magenta RGB(255, 0, 255).',
  'The magenta must be one uniform colour with no gradient, texture or shading, and must not appear anywhere in the artwork itself.',
].join(' ');

/**
 * Phrasings that ask for transparency, which no model this shop uses can deliver.
 *
 * Written to catch the clause and the punctuation holding it to the sentence, so removing it
 * leaves readable English rather than a dangling comma. The parenthesised spec note is its
 * own case because it is a whole aside, not a clause.
 */
const TRANSPARENCY = [
  /\s*\((?=[^)]*transparent)[^)]*\)/gi,
  /(?:^|[,.;]\s*|\s+(?:and|with|on)\s+)(?:a\s+|an\s+|the\s+)?(?:fully|completely|clean|pure|true|truly|real)?\s*transparen(?:t|cy)(?:\s+(?:png|background|backdrop|bg))?(?:\s+background)?/gi,
  /(?:^|[,.;]\s*|\s+and\s+)(?:no|without(?:\s+a)?)\s+background(?:\s+(?:fill|colour|color))?/gi,
  /(?:^|[,.;]\s*|\s+and\s+)png\s+transparent/gi,
];

/** True when the prompt already carries the chroma screen, so it is not added twice. */
export function mentionsChromaScreen(prompt: string): boolean {
  return /magenta/i.test(prompt);
}

/**
 * The prompt as it should actually be sent: no transparency talk, chroma screen on the end.
 *
 * Both the Generate form and the API route call this. The form so the person reads the real
 * prompt before spending anything, the route so nothing reaches Atlas without it — a saved
 * prompt, a retry of an old generation or a direct call would otherwise slip past.
 */
export function withPrintBackground(prompt: string): string {
  let body = prompt;
  for (const pattern of TRANSPARENCY) body = body.replace(pattern, '');

  body = body
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;])/g, '$1')
    .replace(/([,;])\s*(?=[,.;])/g, '')
    .replace(/^[\s,.;]+/, '')
    .replace(/[\s,;]+$/, '')
    .trim();

  if (!body) return CHROMA_SCREEN;
  if (mentionsChromaScreen(body)) return body;
  return `${body.replace(/\.+$/, '')}. ${CHROMA_SCREEN}`;
}
