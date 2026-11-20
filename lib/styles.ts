/**
 * Named styles for redrawing a reference image.
 *
 * The point of this feature is "here is a design I like, make one like it but preppy". A
 * style name on its own is a weak instruction to an image model — "preppy" could mean
 * anything — so each one carries a concrete description of its visual language: palette,
 * line quality, shapes, era. That description is what actually reaches the model; the name
 * is only what the dropdown says.
 *
 * Chosen for what sells as a garment print rather than as general art styles, which is why
 * the list is short and leans on recognisable Etsy and TikTok Shop aesthetics.
 */

export type DesignStyle = {
  id: string;
  name: string;
  /** What the model is actually told. */
  description: string;
};

export const STYLES: DesignStyle[] = [
  {
    id: 'preppy',
    name: 'Preppy',
    // No smiley faces. The classic smiley is both trademarked and claimed in copyright, and
    // a style description that asks for one puts it on every garment printed through this
    // style — a legal problem baked into a dropdown. Do not add it back, here or elsewhere.
    description:
      'preppy coastal style: bright saturated pastels, pink, green and sky blue, bold clean outlines, ' +
      'gingham and scallop edges, chunky rounded shapes, cheerful and youthful',
  },
  {
    id: 'retro-70s',
    name: 'Retro 70s groovy',
    description:
      '1970s groovy style: burnt orange, mustard, avocado and cream, thick wavy outlines, ' +
      'rainbow arcs, bubble shapes, sun rays, warm and slightly faded',
  },
  {
    id: 'vintage-distressed',
    name: 'Vintage distressed',
    description:
      'vintage screen-print style: limited muted palette, heavy halftone dots and visible grain, ' +
      'cracked and worn ink texture, bold simplified shapes, looks printed decades ago',
  },
  {
    id: 'y2k',
    name: 'Y2K',
    description:
      'Y2K style: chrome and glossy gradients, hot pink, lime and electric blue, star and butterfly motifs, ' +
      'bubbly inflated lettering shapes, early-2000s graphic energy',
  },
  {
    id: 'cottagecore',
    name: 'Cottagecore',
    description:
      'cottagecore style: soft muted sage, cream and dusty rose, delicate hand-drawn botanicals, ' +
      'mushrooms, wildflowers and gentle florals, fine line work, soft and nostalgic',
  },
  {
    id: 'kawaii',
    name: 'Kawaii cartoon',
    description:
      'kawaii cartoon style: rounded chibi proportions, big simple eyes, soft pastel palette, ' +
      'thick friendly outlines, tiny blush marks and sparkles, very cute and simple',
  },
  {
    id: 'western',
    name: 'Western / cowgirl',
    description:
      'western cowgirl style: tan, rust, turquoise and cream, desert and cactus motifs, ' +
      'cowboy boots and hats, rope and star details, vintage rodeo poster feel',
  },
  {
    id: 'minimal-line',
    name: 'Minimal line art',
    description:
      'minimal single-weight line art: one or two colours only, continuous clean strokes, ' +
      'generous empty space, no shading or texture, calm and modern',
  },
  {
    id: 'boho',
    name: 'Boho neutral',
    description:
      'boho neutral style: warm terracotta, sand, clay and off-white, organic hand-drawn shapes, ' +
      'arches, sun and moon motifs, earthy and understated',
  },
  {
    id: 'comic-pop',
    name: 'Comic pop art',
    description:
      'comic book pop art style: bold black outlines, flat primary colours, ben-day halftone dots, ' +
      'dynamic action lines, speech-bubble shapes, punchy and graphic',
  },
  {
    id: 'watercolour',
    name: 'Watercolour',
    description:
      'soft watercolour style: translucent washes with visible pigment bleed and paper texture, ' +
      'gentle colour transitions, loose edges, delicate and painterly',
  },
  {
    id: 'folk',
    name: 'Scandinavian folk',
    description:
      'Scandinavian folk art style: symmetrical decorative motifs, deep red, forest green and cream, ' +
      'simple stylised animals and flowers, flat shapes, hand-painted wooden quality',
  },
  {
    id: 'varsity',
    name: 'Varsity collegiate',
    description:
      'varsity collegiate style: bold block and serif collegiate shapes, layered offset outlines, ' +
      'two or three strong team colours, chenille patch and felt texture, sporty and classic',
  },
];

export function styleById(id: string): DesignStyle | undefined {
  return STYLES.find((s) => s.id === id);
}

export type ReferenceBrief = {
  /** The chosen style's id, or null when a description is being typed instead. */
  styleId: string | null;
  /** Free text, used when no style is chosen or to add to one. */
  extra?: string;
  /** Redraw the reference's wording too, rather than dropping it. */
  keepLettering: boolean;
};

/**
 * The instruction sent alongside the reference image.
 *
 * Three things it has to get right, learned from what this shop prints:
 *
 *  - It must say REDRAW, not edit. An edit model handed a picture and a style name tends to
 *    tint the original; the wording has to ask for a new illustration that borrows the
 *    subject and composition.
 *  - Transparent background and no backdrop, because the art is printed on fabric. A scene
 *    with its own background prints as a rectangle.
 *  - Lettering is opt-in. The reference may carry a word that belongs to the design, or a
 *    word that should be left out so new copy can go in its place.
 */
export function buildReferencePrompt(brief: ReferenceBrief): string {
  const style = brief.styleId ? styleById(brief.styleId) : undefined;
  const look = [style?.description, brief.extra?.trim()].filter(Boolean).join('. ');

  return [
    'Redraw this image as a brand new t-shirt graphic in the following style.',
    `Style: ${look || 'keep the original style but make it cleaner and bolder'}.`,
    'Keep the same subject, pose and overall composition, but reinterpret every element in that style — do not simply recolour or filter the original.',
    brief.keepLettering
      ? 'Keep the same wording, redrawn as lettering that belongs to this style.'
      : 'Leave out all text and lettering; illustration only.',
    'Flat vector-style illustration suitable for screen printing on a dark garment.',
    'Clean transparent background, no background fill, no scene, no shadow, no mockup, no frame.',
  ].join(' ');
}
