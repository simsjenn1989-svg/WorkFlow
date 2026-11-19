/**
 * Render tuning, kept free of any Node-only import.
 *
 * The editor is a client component and needs these defaults, so they cannot live beside the
 * compositor — importing that would drag `sharp` into the browser bundle.
 */
export type RenderOptions = {
  /**
   * How strongly the garment's own light and shade act on the print. 0 is a flat sticker,
   * 1 is the raw ratio. Around 0.8 reads as printed without crushing the art.
   */
  shadingStrength: number;
  /**
   * How much of the photo's fine grain — weave and sensor/JPEG noise — reaches the ink.
   * Some is right; real ink sits on a textured surface. Full strength looks like glitter,
   * because on a near-black garment the per-pixel noise is large relative to the median.
   */
  textureStrength: number;
  /**
   * How much garment colour shows through the ink. Real DTG white on a dark tee is never
   * pure white, and this is the single biggest tell when it is missing.
   */
  bleed: number;
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
