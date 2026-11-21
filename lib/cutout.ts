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

/** True when the image has no usable transparency, so a cutout is worth attempting. */
export async function needsCutout(image: Buffer): Promise<boolean> {
  const meta = await sharp(image).metadata();
  if (!meta.hasAlpha) return true;

  // An alpha channel that is fully opaque everywhere is the same as not having one.
  const stats = await sharp(image).stats();
  const alpha = stats.channels[3];
  return !alpha || alpha.min >= 250;
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
  const background = median(edge);

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
    : floodFromBorder(data, channels, width, height, background, options.tolerance ?? 60);

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
  background: [number, number, number],
  tolerance: number,
): number {
  const seen = new Uint8Array(width * height);
  const stack: number[] = [];

  const consider = (x: number, y: number) => {
    const i = y * width + x;
    if (seen[i]) return;
    if (distance(pixel(data, channels, x, y, width), background) > tolerance) return;
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

function median(values: [number, number, number][]): [number, number, number] {
  const channel = (n: 0 | 1 | 2) => {
    const sorted = values.map((v) => v[n]).sort((x, y) => x - y);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
  };
  return [channel(0), channel(1), channel(2)];
}
