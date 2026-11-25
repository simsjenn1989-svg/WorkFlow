/**
 * A product title Printify will accept.
 *
 * Printify validates titles and rejects the whole product with
 * `Product is invalid. Title contains excessive caps.` — a 400 on create, so nothing is made
 * at all. A batch of 24 drafts failed on exactly this: the design titles are the shirt text
 * ("MOST LIKELY TO BUY MATCHING PAJAMAS"), and the push sent them to Printify verbatim.
 *
 * Shouting is the thing being fixed, not capitals, so a title that is already normally cased
 * is returned untouched — including one that happens to contain an acronym. Only a title
 * that is mostly capitals gets recased, which also means this cannot quietly rewrite copy a
 * person typed deliberately.
 */

/** Lowercase inside a title, but not as its first or last word. */
const SMALL = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'nor', 'of', 'off',
  'on', 'or', 'over', 'the', 'to', 'up', 'via', 'vs', 'with',
]);

/**
 * Words that stay shouting even while the rest is recased.
 *
 * Needed because the test for shouting is the whole title: inside one, there is nothing to
 * distinguish a real acronym from an ordinary shouted word, so the ones worth keeping have
 * to be named. A size or any word carrying a digit (3XL) is kept by shape instead.
 */
const ACRONYMS = new Set([
  'af', 'bbq', 'diy', 'dj', 'id', 'lgbtq', 'mlb', 'nfl', 'nsfw', 'og', 'ok', 'pta', 'rv',
  'suv', 'tv', 'ufc', 'uk', 'usa', 'xl', 'xxl', 'xoxo',
]);

/** Mostly capitals, counting only letters, so punctuation and digits do not skew it. */
function shouting(title: string): boolean {
  const letters = title.replace(/[^a-z]/gi, '');
  if (letters.length < 4) return false;
  const upper = letters.replace(/[^A-Z]/g, '').length;
  return upper / letters.length > 0.6;
}

/** One word, recased: `SANTA'S` → `Santa's`, `TOP-RATED` → `Top-Rated`. */
function recase(word: string): string {
  // Split on the separators that start a new word, keeping them. An apostrophe is absent on
  // purpose — the letter after one continues the same word ("Santa's", not "Santa'S").
  return word
    .split(/([-–—/])/)
    .map((part) =>
      /^[-–—/]$/.test(part)
        ? part
        : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase(),
    )
    .join('');
}

/**
 * The title as it should be sent to Printify.
 *
 * Already-cased titles come back unchanged; a shouted one comes back in title case.
 */
export function listingTitle(raw: string): string {
  const title = raw.trim().replace(/\s+/g, ' ');
  if (!shouting(title)) return title;

  const words = title.split(' ');
  return words
    .map((word, i) => {
      const bare = word.replace(/[^a-z0-9]/gi, '').toLowerCase();
      // A word with a digit in it is a size or a model number, not shouting: 3XL, S24.
      if (/\d/.test(bare) || ACRONYMS.has(bare)) return word;
      const first = i === 0;
      const last = i === words.length - 1;
      if (!first && !last && SMALL.has(bare)) return word.toLowerCase();
      return recase(word);
    })
    .join(' ');
}

/** Whether sending this title to Printify would be rejected for shouting. */
export function wouldBeRejected(title: string): boolean {
  return shouting(title.trim().replace(/\s+/g, ' '));
}
