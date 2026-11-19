import sharp from 'sharp';
import { apply, boundsOf, invert, unitSquareToQuad, type Quad } from './homography';

export type RenderOptions = {
  /**
   * How strongly the garment's own light and shade act on the print. 0 is a flat sticker,
   * 1 is the raw ratio. Around 0.75 reads as printed without crushing the art.
   */
  shadingStrength: number;
  /**
   * How much garment colour shows through the ink. Real DTG white on a dark tee is never
   * pure white, and this is the single biggest tell when it is missing.
   */
  bleed: number;
  /**
   * How much of the photo's fine grain — weave and sensor/JPEG noise — reaches the ink.
   * Some is right; real ink sits on a textured surface. Full strength looks like glitter,
   * because on a near-black garment the per-pixel noise is large relative to the median.
   */
  textureStrength: number;
  /** Ink is never perfectly opaque. */
  inkOpacity: number;
  /** Feather on the print edge, in output pixels. Printed edges are not razor sharp. */
  featherPx: number;
};

export const DEFAULT_OPTIONS: RenderOptions = {
  shadingStrength: 0.8,
  textureStrength: 0.3,
  bleed: 0.07,
  inkOpacity: 0.96,
  featherPx: 1.2,
};

export type RenderInput = {
  mockup: Buffer;
  design: Buffer;
  quad: Quad;
  options?: Partial<RenderOptions>;
  /** Longest edge of the output. Smaller values give a quick preview from the same code. */
  maxEdge?: number;
};

export type RenderResult = {
  jpeg: Buffer;
  width: number;
  height: number;
  /** Median luminance inside the print area — the base the light map is measured against. */
  baseLuma: number;
  garmentHex: string;
};

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * Composite a design onto a garment photo.
 *
 * The method is deliberately simple and it is the reason the result reads as printed rather
 * than pasted: the garment's own luminance, relative to the median inside the print area,
 * is used as a multiplier. That single ratio carries the folds, the drape and the fabric
 * weave at once, because all three are already in the photograph. Nothing is invented.
 *
 * Measuring against the median per template matters. On a near-black tee the absolute
 * luminance range can be as narrow as 32 of 255, which as an absolute shadow map would be
 * almost invisible; as a ratio against a median of about 23 it spans roughly 0.35x to 1.75x,
 * which is plenty.
 */
export async function renderMockup(input: RenderInput): Promise<RenderResult> {
  const options = { ...DEFAULT_OPTIONS, ...input.options };

  const base = sharp(input.mockup).rotate();
  const meta = await base.metadata();
  const fullWidth = meta.width ?? 0;
  const fullHeight = meta.height ?? 0;
  if (!fullWidth || !fullHeight) throw new Error('That mockup image could not be read.');

  // Scale the whole job if a smaller output was asked for; the quad scales with it.
  const maxEdge = input.maxEdge ?? Math.max(fullWidth, fullHeight);
  const scale = Math.min(1, maxEdge / Math.max(fullWidth, fullHeight));
  const width = Math.round(fullWidth * scale);
  const height = Math.round(fullHeight * scale);
  const quad = input.quad.map((p) => ({ x: p.x * scale, y: p.y * scale })) as Quad;

  const resized = await base.resize(width, height, { fit: 'fill' }).removeAlpha().toBuffer();

  const { data: mock } = await sharp(resized).raw().toBuffer({ resolveWithObject: true });

  // Two luminance maps. The blurred one carries the folds and drape; dividing the sharp one
  // by it leaves the weave and the noise, which are applied far more weakly. Without this
  // split a near-black garment's grain reads as glitter in the print.
  const { data: grey } = await sharp(resized).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { data: greyLow } = await sharp(resized)
    .greyscale()
    .blur(Math.max(2, Math.round(width / 220)))
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Feathering the design's alpha before warping is cheaper and smoother than feathering
  // in the loop, and it scales with the design rather than the output.
  const designPipeline = sharp(input.design).ensureAlpha();
  const designMeta = await designPipeline.metadata();
  const dw = designMeta.width ?? 0;
  const dh = designMeta.height ?? 0;
  if (!dw || !dh) throw new Error('That design image could not be read.');

  const { data: art } = await (options.featherPx > 0
    ? sharp(await designPipeline.toBuffer()).blur(Math.max(0.3, options.featherPx))
    : designPipeline
  )
    .raw()
    .toBuffer({ resolveWithObject: true });

  const toQuad = unitSquareToQuad(quad);
  const toUnit = invert(toQuad);
  const bounds = boundsOf(quad, width, height);

  // Median luminance inside the print area, and the garment's own colour there.
  const samples: number[] = [];
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let counted = 0;
  const step = Math.max(1, Math.floor(Math.min(bounds.right - bounds.left, bounds.bottom - bounds.top) / 160));

  for (let y = bounds.top; y < bounds.bottom; y += step) {
    for (let x = bounds.left; x < bounds.right; x += step) {
      const u = apply(toUnit, { x: x + 0.5, y: y + 0.5 });
      if (u.x < 0 || u.x > 1 || u.y < 0 || u.y > 1) continue;
      const i = (y * width + x) * 3;
      const r = mock[i]!;
      const g = mock[i + 1]!;
      const b = mock[i + 2]!;
      // Measured on the blurred map, so one bright speck cannot shift the baseline.
      samples.push(greyLow[y * width + x]!);
      rSum += r;
      gSum += g;
      bSum += b;
      counted++;
    }
  }
  if (counted === 0) throw new Error('The print area does not overlap the image.');

  samples.sort((a, b) => a - b);
  const baseLuma = Math.max(1, samples[Math.floor(samples.length / 2)]!);
  const garment = {
    r: rSum / counted,
    g: gSum / counted,
    b: bSum / counted,
  };

  const out = Buffer.from(mock);

  for (let y = bounds.top; y < bounds.bottom; y++) {
    for (let x = bounds.left; x < bounds.right; x++) {
      const u = apply(toUnit, { x: x + 0.5, y: y + 0.5 });
      if (u.x < 0 || u.x > 1 || u.y < 0 || u.y > 1) continue;

      const ink = sampleBilinear(art, dw, dh, u.x * (dw - 1), u.y * (dh - 1));
      const alpha = (ink.a / 255) * options.inkOpacity;
      if (alpha <= 0.002) continue;

      const i = (y * width + x) * 3;
      const gr = mock[i]!;
      const gg = mock[i + 1]!;
      const gb = mock[i + 2]!;

      // Folds and drape, measured against the print area's median.
      const low = greyLow[y * width + x]!;
      const fold = Math.pow(Math.max(0.04, low / baseLuma), options.shadingStrength);

      // Weave and grain: what the sharp luminance has over the blurred one.
      const texture = Math.pow(
        Math.max(0.04, (grey[y * width + x]! + 0.5) / (low + 0.5)),
        options.textureStrength,
      );

      const shade = fold * texture;

      const r = shadeChannel(ink.r, shade, garment.r, options.bleed);
      const g = shadeChannel(ink.g, shade, garment.g, options.bleed);
      const b = shadeChannel(ink.b, shade, garment.b, options.bleed);

      out[i] = clamp8(gr + (r - gr) * alpha);
      out[i + 1] = clamp8(gg + (g - gg) * alpha);
      out[i + 2] = clamp8(gb + (b - gb) * alpha);
    }
  }

  const jpeg = await sharp(out, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .toBuffer();

  return {
    jpeg,
    width,
    height,
    baseLuma: Math.round(baseLuma),
    garmentHex: hex(garment.r, garment.g, garment.b),
  };
}

function shadeChannel(inkValue: number, shade: number, garmentValue: number, bleed: number): number {
  const lit = inkValue * shade;
  return lit * (1 - bleed) + garmentValue * bleed;
}

function clamp8(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

function hex(r: number, g: number, b: number): string {
  const p = (v: number) => clamp8(v).toString(16).padStart(2, '0');
  return `#${p(r)}${p(g)}${p(b)}`;
}

function sampleBilinear(data: Buffer, w: number, h: number, fx: number, fy: number) {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;

  const at = (x: number, y: number) => (y * w + Math.max(0, Math.min(w - 1, x))) * 4;
  const i00 = at(x0, Math.max(0, Math.min(h - 1, y0)));
  const i10 = at(x1, Math.max(0, Math.min(h - 1, y0)));
  const i01 = at(x0, y1);
  const i11 = at(x1, y1);

  const mix = (o: number) => {
    const top = data[i00 + o]! * (1 - tx) + data[i10 + o]! * tx;
    const bottom = data[i01 + o]! * (1 - tx) + data[i11 + o]! * tx;
    return top * (1 - ty) + bottom * ty;
  };

  return { r: mix(0), g: mix(1), b: mix(2), a: mix(3) };
}
