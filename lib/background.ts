/**
 * What to tell an image model about the background.
 *
 * The history matters, because both earlier answers were wrong in instructive ways.
 *
 * Asking for a "transparent background" in prose does not work on a model that cannot
 * produce one. Nano Banana 2.1 publishes no alpha for text-to-image, so when the prompt
 * insisted, it satisfied the instruction the only way a painter can: it drew the
 * grey-and-white checkerboard that means "transparent" in an image editor. Measured on a
 * real generation — 3584x4800, hasAlpha false, 100px squares of RGB(254,254,254) and
 * RGB(222,222,224) over every part of the canvas the artwork did not cover.
 *
 * The fix then was a magenta chroma screen, keyed out afterwards. That worked until it
 * didn't: the key is a hard in-or-out decision per pixel, so it cannot keep the feathered
 * rim of a letter, and it eats a design whose own colours sit near the screen. A pink
 * script on magenta is exactly the case it fails.
 *
 * So the answer is neither: ask the MODEL for transparency, through the parameter it
 * publishes. 7 of 76 text-to-image models and 9 of 84 image-to-image ones have one — run
 * `scripts/transparent-models.mjs` for the current list. Measured on seedream-v5.5 with
 * `background: transparent`: four channels, corners at alpha 0, 51.6% clear, and 0.7%
 * partial — the soft edge no chroma key can reproduce.
 *
 * A model without that parameter gets no background instruction at all. Whatever it draws
 * is cut by lib/cutout.ts, which is the honest fallback rather than a trick that distorts
 * the art.
 */

/**
 * Phrasings that ask for transparency, which a model without the parameter cannot give.
 *
 * Still stripped for those models, because the checkerboard above is what happens
 * otherwise, and it cost a whole generation to learn.
 */
const TRANSPARENCY = [
  /\s*\((?=[^)]*transparent)[^)]*\)/gi,
  /(?:^|[,.;]\s*|\s+(?:and|with|on)\s+)(?:a\s+|an\s+|the\s+)?(?:fully|completely|clean|pure|true|truly|real)?\s*transparen(?:t|cy)(?:\s+(?:png|background|backdrop|bg))?(?:\s+background)?/gi,
  /(?:^|[,.;]\s*|\s+and\s+)(?:no|without(?:\s+a)?)\s+background(?:\s+(?:fill|colour|color))?/gi,
  /(?:^|[,.;]\s*|\s+and\s+)png\s+transparent/gi,
];

/**
 * The prompt as it should be sent.
 *
 * Nothing is added. On a model that can give real transparency the prompt goes through
 * untouched; on one that cannot, the transparency talk comes out so it does not paint a
 * checkerboard.
 */
export function preparePrompt(prompt: string, canDoTransparency: boolean): string {
  if (canDoTransparency) return prompt.trim();

  let body = prompt;
  for (const pattern of TRANSPARENCY) body = body.replace(pattern, '');

  return body
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;])/g, '$1')
    .replace(/([,;])\s*(?=[,.;])/g, '')
    .replace(/^[\s,.;]+/, '')
    .replace(/[\s,;]+$/, '')
    .trim();
}
