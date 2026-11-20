import sharp from 'sharp';
import type { NormQuad } from '@/lib/mockups';

/**
 * Turning a mockup render into the first frame of a vertical video.
 *
 * The problem this solves: the renders are landscape — measured at 2000x1500 and 2000x1600,
 * so 1.33 and 1.25 — and TikTok wants 9:16, which is 0.5625. There is no framing that keeps
 * everything, so the choice has to be made deliberately and shown before anything is paid
 * for.
 *
 * It matters more than it sounds, because most image-to-video models take the aspect ratio
 * from the frame they are given. Seedance 2.5 only offers `ratio: adaptive`; Wan 3.0 has no
 * ratio field at all. Hand them a landscape frame and they return a landscape video. So the
 * vertical crop is not a nicety applied afterwards, it is the only way to get a vertical
 * video out of most of the catalogue.
 */

export type FrameMode = 'crop' | 'pad' | 'original';

export const TIKTOK_RATIO = 9 / 16;

export type FrameOptions = {
  mode: FrameMode;
  /** 9:16 by default; a model with its own ratio field can ask for something else. */
  ratio?: number;
  /**
   * Where the design sits in the render, if it is known.
   *
   * The mockup template already stores the print area's corners, so a crop can be centred on
   * the graphic rather than on the middle of the photo. On a lifestyle shot where the model
   * stands off-centre that is the difference between a video of the shirt and a video of a
   * Christmas tree.
   */
  focus?: NormQuad | null;
  /** Nudge the crop sideways, -1 to 1, when the automatic choice is not the one you want. */
  offsetX?: number;
  offsetY?: number;
  /** Long edge of the output. 1080 is what TikTok serves. */
  height?: number;
};

export type PreparedFrame = {
  jpeg: Buffer;
  width: number;
  height: number;
  mode: FrameMode;
  /** True when the source was already the right shape and nothing was cut or added. */
  untouched: boolean;
  /** Fraction of the original image's area that survived, so a brutal crop is visible. */
  kept: number;
};

export async function prepareFrame(
  image: Buffer,
  options: FrameOptions,
): Promise<PreparedFrame> {
  const ratio = options.ratio ?? TIKTOK_RATIO;
  const outHeight = options.height ?? 1920;
  const outWidth = Math.round(outHeight * ratio);

  const meta = await sharp(image).rotate().metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) throw new Error('That render has no readable size.');

  if (options.mode === 'original') {
    // No enlargement. A 2000x1500 render was going out as 2560x1920 — a third more bytes
    // over the wire for detail that was never there. Models that crop to their own
    // aspect ratio do it from whatever they are given, so size costs and buys nothing.
    const resized = await sharp(image)
      .rotate()
      .resize({ height: outHeight, withoutEnlargement: true })
      .jpeg({ quality: 92 })
      .toBuffer({ resolveWithObject: true });
    return {
      jpeg: resized.data,
      width: resized.info.width,
      height: resized.info.height,
      mode: 'original',
      untouched: true,
      kept: 1,
    };
  }

  if (options.mode === 'pad') {
    // A blurred, blown-up copy of the same photo behind the whole frame, rather than flat
    // bars. Nothing is cut, and it reads as a phone video rather than a letterboxed advert.
    const background = await sharp(image)
      .rotate()
      .resize(outWidth, outHeight, { fit: 'cover' })
      .blur(40)
      .modulate({ brightness: 0.82 })
      .toBuffer();

    const foreground = await sharp(image)
      .rotate()
      .resize(outWidth, outHeight, { fit: 'inside' })
      .toBuffer();

    const composed = await sharp(background)
      .composite([{ input: foreground, gravity: 'center' }])
      .jpeg({ quality: 92 })
      .toBuffer();

    return { jpeg: composed, width: outWidth, height: outHeight, mode: 'pad', untouched: false, kept: 1 };
  }

  // --- crop
  const box = cropBox({
    width,
    height,
    ratio,
    focus: options.focus ?? null,
    offsetX: options.offsetX ?? 0,
    offsetY: options.offsetY ?? 0,
  });

  const cropped = await sharp(image)
    .rotate()
    .extract(box)
    .resize(outWidth, outHeight, { fit: 'fill' })
    .jpeg({ quality: 92 })
    .toBuffer();

  return {
    jpeg: cropped,
    width: outWidth,
    height: outHeight,
    mode: 'crop',
    untouched: Math.abs(width / height - ratio) < 0.01,
    kept: (box.width * box.height) / (width * height),
  };
}

/**
 * The largest window of the wanted shape that fits, placed over the design.
 *
 * Centred on the print area's middle, then slid back inside the image. Sliding rather than
 * shrinking keeps the window as large as it can be, which matters: on a 2000x1500 render a
 * 9:16 window is only 844 pixels wide, so there is nothing spare to give away.
 */
export function cropBox(input: {
  width: number;
  height: number;
  ratio: number;
  focus: NormQuad | null;
  offsetX: number;
  offsetY: number;
}): { left: number; top: number; width: number; height: number } {
  const { width, height, ratio } = input;

  let boxWidth = width;
  let boxHeight = Math.round(width / ratio);
  if (boxHeight > height) {
    boxHeight = height;
    boxWidth = Math.round(height * ratio);
  }

  const centre = input.focus ? centroid(input.focus) : { x: 0.5, y: 0.5 };

  // The offset is in units of the slack, so the slider covers exactly the range that moves
  // the window and no further.
  const slackX = width - boxWidth;
  const slackY = height - boxHeight;

  let left = Math.round(centre.x * width - boxWidth / 2 + (input.offsetX * slackX) / 2);
  let top = Math.round(centre.y * height - boxHeight / 2 + (input.offsetY * slackY) / 2);

  left = Math.max(0, Math.min(slackX, left));
  top = Math.max(0, Math.min(slackY, top));

  return { left, top, width: boxWidth, height: boxHeight };
}

function centroid(quad: NormQuad): { x: number; y: number } {
  const x = quad.reduce((sum, p) => sum + p.x, 0) / quad.length;
  const y = quad.reduce((sum, p) => sum + p.y, 0) / quad.length;
  return { x, y };
}
