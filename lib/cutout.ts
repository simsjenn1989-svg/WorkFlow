import sharp from 'sharp';

/**
 * Removing a flat background an image model baked in.
 *
 * Only 8 of Atlas's 84 image-to-image models can output transparency, and the best of them
 * for this shop's work — Nano Banana 2.1 — is not one. Asked for a graphic "for screen
 * printing on a dark garment" it draws the design on a solid near-black rectangle. Printed,
 * that is a full block of ink across the whole print area: wrong hand feel, visible sheen on
 * garment-dyed cotton, and useless on any other garment colour.
 *
 * This is a flood fill from the border rather than "delete every dark pixel", and the
 * difference is the whole point. The subject's own blacks — outlines, Santa's boots, a
 * gloved hand — are interior regions not connected to the edge, so they survive. Only the
 * contiguous background reachable from outside is removed.
 *
 * Free and deterministic. Atlas sells cutout models at $0.016 to $0.086 a go, which is worth
 * paying only for a photographic subject against a busy background; for flat vector art on a
 * uniform fill this is both cheaper and more predictable.
 */

export type CutoutResult = {
  png: Buffer;
  /** Fraction of the image removed, so a cutout that ate the design can be spotted. */
  removed: number;
  /** The colour that was treated as background. */
  background: [number, number, number];
  /** How it was removed — a keyed chroma screen, or a flood from the border. */
  method: 'chroma' | 'flood';
};

export type CutoutOptions = {
  /**
   * How far a pixel may differ from the background colour and still be flooded, 0-255 per
   * channel in sum. Flat vector fills are uniform, so this can stay tight; too loose and the
   * fill leaks through an anti-aliased outline into the subject.
   */
  tolerance?: number;
};

/**
 * True when the image still has a background to remove.
 *
 * Having an alpha channel is not the same as having used it, and neither is having used it
 * somewhere. A model can return partial transparency inside the artwork — a soft shadow, a
 * screen-print texture — while the canvas around it stays a solid painted colour. Judging by
 * the alpha channel's minimum alone, as this did at first, calls that image finished and
 * stores a design with a background baked into it.
 *
 * So the question asked is the one that matters: is the border opaque? If the outside edge
 * is solid, there is something out there to cut, whatever the middle is doing.
 */
export async function needsCutout(image: Buffer): Promise<boolean> {
  const meta = await sharp(image).metadata();
  if (!meta.hasAlpha) return true;

  const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  let opaque = 0;
  let sampled = 0;
  const step = Math.max(1, Math.floor(width / 128));
  const look = (x: number, y: number) => {
    sampled++;
    if (data[(y * width + x) * channels + 3]! >= 250) opaque++;
  };
  for (let x = 0; x < width; x += step) {
    look(x, 0);
    look(x, height - 1);
  }
  for (let y = 0; y < height; y += step) {
    look(0, y);
    look(width - 1, y);
  }

  return sampled === 0 || opaque / sampled > 0.9;
}

export async function cutBackground(
  image: Buffer,
  options: CutoutOptions = {},
): Promise<CutoutResult> {
  const { data, info } = await sharp(image)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  // The background is whatever most of the border is. Taking the median of the edge rather
  // than one corner survives a design that happens to touch a corner.
  const edge: [number, number, number][] = [];
  const step = Math.max(1, Math.floor(width / 64));
  for (let x = 0; x < width; x += step) {
    edge.push(pixel(data, channels, x, 0, width), pixel(data, channels, x, height - 1, width));
  }
  for (let y = 0; y < height; y += step) {
    edge.push(pixel(data, channels, 0, y, width), pixel(data, channels, width - 1, y, width));
  }
  const tones = backgroundTones(edge, options.tolerance ?? 60);
  const background = tones[0]!;

  // A saturated background is a chroma screen and can be keyed everywhere at once; a dull
  // one is part of the picture's own palette and may only be removed where it is provably
  // outside the subject.
  //
  // This distinction is the fix for a real failure: on a near-black background the border
  // flood left a pocket of black trapped between Santa's arm and a reindeer, and removing
  // every black pixel instead would have taken his boots and gloves with it.
  const chroma = saturation(background) > 120;
  const removed = chroma
    ? keyColour(data, channels, background, options.tolerance ?? 120)
    : floodFromBorder(data, channels, width, height, tones, options.tolerance ?? 60);

  const png = await sharp(data, { raw: { width, height, channels } })
    .png({ compressionLevel: 9 })
    .toBuffer();

  return { png, removed: removed / (width * height), background, method: chroma ? 'chroma' : 'flood' };
}

/**
 * Remove every pixel that is the screen colour, wherever it is.
 *
 * Safe only because the colour was requested specifically so that nothing in the artwork
 * would use it. Pixels partway to it — the anti-aliased rim of every shape — get partial
 * alpha and have the cast pulled back out, because a magenta rim on a cut-out prints as a
 * bright fringe.
 *
 * It does NOT measure plain distance to the screen colour. That was the first attempt and it
 * turned a pink Santa grey: against magenta (252,3,250), a preppy pink of (240,110,160) is
 * only 209 away in summed channels, which landed it inside the feather band and sent it
 * through despill. Lots of perfectly good colours sit within any distance wide enough to
 * catch a rim.
 *
 * What separates them is not distance but the shape of the colour. A magenta screen has red
 * and blue both far above green; so does pink, but much less so — 247 against 50 on the same
 * two images. Scoring that gap and comparing it to the screen's own gives a ratio with real
 * daylight between background and artwork.
 */
function keyColour(
  data: Buffer,
  channels: number,
  background: [number, number, number],
  _tolerance: number,
): number {
  const order = [0, 1, 2].sort((a, b) => background[b]! - background[a]!);
  const [high, mid, weak] = order as [number, number, number];
  const screenScore = Math.min(background[high]!, background[mid]!) - background[weak]!;
  if (screenScore <= 0) return 0;

  // Fully the screen colour above this, definitely artwork below it, feathered between.
  const KEY = 0.82;
  const KEEP = 0.55;

  let removed = 0;
  for (let i = 0; i < data.length; i += channels) {
    const score =
      Math.min(data[i + high]!, data[i + mid]!) - data[i + weak]!;
    const ratio = score / screenScore;

    if (ratio >= KEY) {
      data[i + 3] = 0;
      removed++;
      continue;
    }
    if (ratio <= KEEP) continue;

    data[i + 3] = Math.round(255 * (1 - (ratio - KEEP) / (KEY - KEEP)));
    despill(data, i, high, mid, weak);
  }
  return removed;
}

/**
 * Pull the screen's cast out of a rim pixel.
 *
 * Only ever applied in the narrow feather band, so artwork colours never reach it.
 */
function despill(data: Buffer, i: number, high: number, mid: number, weak: number): void {
  const ceiling = data[i + weak]!;
  if (data[i + high]! > ceiling) data[i + high] = ceiling;
  if (data[i + mid]! > ceiling) data[i + mid] = ceiling;
}

/** Remove only background reachable from outside the image, leaving the subject's own fills. */
function floodFromBorder(
  data: Buffer,
  channels: number,
  width: number,
  height: number,
  tones: [number, number, number][],
  tolerance: number,
): number {
  const seen = new Uint8Array(width * height);
  const stack: number[] = [];

  const consider = (x: number, y: number) => {
    const i = y * width + x;
    if (seen[i]) return;
    const here = pixel(data, channels, x, y, width);
    if (!tones.some((tone) => distance(here, tone) <= tolerance)) return;
    seen[i] = 1;
    stack.push(i);
  };

  for (let x = 0; x < width; x++) {
    consider(x, 0);
    consider(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    consider(0, y);
    consider(width - 1, y);
  }

  // An explicit stack, not recursion: a 4096px image is 16 million pixels.
  let removed = 0;
  while (stack.length > 0) {
    const i = stack.pop()!;
    removed++;
    const x = i % width;
    const y = (i - x) / width;
    if (x > 0) consider(x - 1, y);
    if (x < width - 1) consider(x + 1, y);
    if (y > 0) consider(x, y - 1);
    if (y < height - 1) consider(x, y + 1);
  }

  for (let i = 0; i < seen.length; i++) if (seen[i]) data[i * channels + 3] = 0;
  return removed;
}

function saturation(c: [number, number, number]): number {
  return Math.max(...c) - Math.min(...c);
}

function pixel(
  data: Buffer,
  channels: number,
  x: number,
  y: number,
  width: number,
): [number, number, number] {
  const i = (y * width + x) * channels;
  return [data[i]!, data[i + 1]!, data[i + 2]!];
}

function distance(a: [number, number, number], b: [number, number, number]): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

/**
 * The colours the border is made of — usually one, sometimes two.
 *
 * A background is not always flat. Asked for transparency, a model that cannot produce it
 * paints the editor's checkerboard instead: two neutral tones, measured at RGB(254,254,254)
 * and RGB(222,222,224), 96 apart in summed channels. A single median picks one of them, the
 * flood clears those squares and stops at every square of the other, and the result is the
 * design wearing a hard speckled halo — which is exactly what happened, and what the 97%
 * "the cutout ate the design" guard cannot catch, because only 55% was removed.
 *
 * Taking the modal colour and then the most common colour that is NOT already covered by it
 * handles both cases with one rule: a flat background yields one tone, a checkerboard two.
 * A second tone has to hold at least 15% of the border to count, which is what keeps artwork
 * running off the edge of the canvas from being read as background and flooded away.
 */
function backgroundTones(
  edge: [number, number, number][],
  tolerance: number,
): [number, number, number][] {
  const first = modal(edge);
  const rest = edge.filter((c) => distance(c, first) > tolerance);
  if (rest.length < edge.length * 0.15) return [first];
  return [first, modal(rest)];
}

/** The most common colour in a sample, to the nearest 8 per channel. */
function modal(values: [number, number, number][]): [number, number, number] {
  const counts = new Map<string, { colour: [number, number, number]; n: number }>();
  for (const value of values) {
    const key = value.map((v) => v >> 3).join(',');
    const seen = counts.get(key);
    if (seen) seen.n++;
    else counts.set(key, { colour: value, n: 1 });
  }
  let best: { colour: [number, number, number]; n: number } | null = null;
  for (const entry of counts.values()) if (!best || entry.n > best.n) best = entry;
  return best?.colour ?? median(values);
}

function median(values: [number, number, number][]): [number, number, number] {
  const channel = (n: 0 | 1 | 2) => {
    const sorted = values.map((v) => v[n]).sort((x, y) => x - y);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
  };
  return [channel(0), channel(1), channel(2)];
}
