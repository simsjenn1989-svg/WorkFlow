/**
 * Where art sits on the garment, worked out from its real size.
 *
 * A fixed `y: 0.45` placed every design's CENTRE at the same height, so a short wordmark and
 * a tall badge started in completely different places on the chest — the taller the art, the
 * higher its top edge crept. What stays constant on a rail of shirts is the TOP of the print
 * sitting a consistent distance below the collar, so that is what is held fixed here and the
 * centre is derived from it.
 *
 * Printify's units: `x` and `y` are the image centre as a fraction of the print area, and
 * `scale` is the image width as a fraction of the print area's width. Nothing is in pixels or
 * inches, which is why this conversion has to exist.
 *
 * Everything below depends on the art already being trimmed to its visible pixels — the
 * print-ready step does that — because otherwise "the top of the art" is the top of whatever
 * empty space the model happened to generate.
 */

/** Printify builds its print areas at 300 DPI, so pixels convert straight to inches. */
export const PRINT_DPI = 300;

export type PlacementRules = {
  /**
   * How far below the COLLAR the art's top edge should sit.
   *
   * Below the collar, not below the print area, because the collar is what a person sees
   * and the two are not the same place — see `collarToAreaTopIn`.
   */
  topDropIn: number;
  /**
   * Distance from the collar seam down to the top of Printify's print area.
   *
   * Measured, not assumed. The first version treated the print area as starting at the
   * collar; a real draft pushed with a 3in drop came back with the art sitting **6.79in**
   * below the collar on Printify's own mockup, so the area itself begins about 3.79in down.
   * Printify publishes the area's pixel size but nothing about where it sits on the garment,
   * so this is the only way to know.
   *
   * Specific to Comfort Colors 1717 front. Another blueprint needs its own measurement, which
   * is why it is a rule rather than a constant.
   */
  collarToAreaTopIn: number;
  /**
   * Nothing wider than this. Null fills the print area's width, which is the default.
   *
   * It was 12in, on the reasoning that art should stay clear of the sleeves. That was
   * wrong, and comparing a draft against the shop's real listings is what showed it: the
   * print area IS the safe zone — Printify defines it as the region that prints cleanly —
   * so holding art 3in inside it only makes every design 80% the size it should be. A
   * reference listing has the graphic running the full width of the area.
   */
  maxWidthIn: number | null;
  /** Nothing taller than this. Null fills the print area's height. */
  maxHeightIn: number | null;
};

export const DEFAULT_RULES: PlacementRules = {
  topDropIn: 3,
  collarToAreaTopIn: 3.79,
  maxWidthIn: null,
  maxHeightIn: null,
};

export type Placed = {
  x: number;
  y: number;
  scale: number;
  angle: number;
  /** What the numbers mean in inches, for showing rather than asserting. */
  widthIn: number;
  heightIn: number;
  /** Where the art's top edge lands, below the collar. */
  topIn: number;
  /** Set when a cap changed the size that was asked for. */
  cappedBy: 'width' | 'height' | null;
  /**
   * True when the wanted drop is above where the print area begins, so the art is sitting as
   * high as the blueprint physically allows. On this one, any `topDropIn` under 3.79in.
   */
  atTopOfArea: boolean;
};

export function placeArtwork(input: {
  /** Trimmed art, in pixels. Only the ratio matters. */
  artWidthPx: number;
  artHeightPx: number;
  /** The print area, in pixels, from the blueprint. */
  areaWidthPx: number;
  areaHeightPx: number;
  rules?: Partial<PlacementRules>;
}): Placed {
  const rules = { ...DEFAULT_RULES, ...input.rules };

  const areaWidthIn = input.areaWidthPx / PRINT_DPI;
  const areaHeightIn = input.areaHeightPx / PRINT_DPI;
  const aspect = input.artWidthPx / input.artHeightPx;

  // Start as wide as allowed, then pull back if that makes it too tall. Width is the usual
  // binding constraint for a chest print; height binds on anything portrait.
  const maxWidthIn = rules.maxWidthIn ?? areaWidthIn;
  const maxHeightIn = rules.maxHeightIn ?? areaHeightIn;

  let widthIn = Math.min(maxWidthIn, areaWidthIn);
  let heightIn = widthIn / aspect;
  let cappedBy: Placed['cappedBy'] = widthIn < areaWidthIn ? 'width' : null;

  if (heightIn > maxHeightIn) {
    heightIn = maxHeightIn;
    widthIn = heightIn * aspect;
    cappedBy = 'height';
  }

  // The drop is measured from the collar, but `y` is a fraction of the print area, which
  // starts lower down. Anything above the area's top edge is unreachable, so it clamps —
  // asking for 3in on a blueprint whose area begins at 3.79in gets 3.79in, not an error.
  const wantedWithinArea = rules.topDropIn - rules.collarToAreaTopIn;
  const maxWithinArea = Math.max(0, areaHeightIn - heightIn);
  const withinArea = Math.max(0, Math.min(wantedWithinArea, maxWithinArea));
  const atTopOfArea = wantedWithinArea <= 0;
  const topIn = rules.collarToAreaTopIn + withinArea;

  return {
    x: 0.5,
    y: clamp01((withinArea + heightIn / 2) / areaHeightIn),
    scale: round(widthIn / areaWidthIn),
    angle: 0,
    widthIn: round(widthIn),
    heightIn: round(heightIn),
    topIn: round(topIn),
    cappedBy,
    atTopOfArea,
  };
}

/** A sentence describing a placement, for the UI to show instead of four raw numbers. */
export function describePlacement(placed: Placed): string {
  const size = `${placed.widthIn.toFixed(1)}in x ${placed.heightIn.toFixed(1)}in`;
  const drop = placed.atTopOfArea
    ? `top ${placed.topIn.toFixed(1)}in below the collar (as high as this blueprint allows)`
    : `top ${placed.topIn.toFixed(1)}in below the collar`;
  const cap = placed.cappedBy ? `, capped on ${placed.cappedBy}` : '';
  return `${size}, ${drop}${cap}`;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, round(n)));
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
