/**
 * Named styles for redrawing a reference image.
 *
 * The point of this feature is "here is a design I like, make one like it but preppy". A
 * style name on its own is a weak instruction to an image model — "preppy" could mean
 * anything — so each one carries a concrete description. That description is what reaches
 * the model; the name is only what the dropdown says.
 *
 * Each style is split in two, and the split is the important part:
 *
 *   grammar  how the design is DRAWN — palette, line quality, finish, era, mood. Always
 *            applied. Contains no objects.
 *   motifs   extra things DRAWN INTO it — mushrooms, cactuses, bows. Opt-in, off by default.
 *
 * It was one field. The Preppy description asked for "smiley faces" and every redraw came
 * back covered in them: the model had been told to draw them, and nothing on screen said so,
 * because the word lived in a prompt behind a dropdown. The smiley is also trademarked, so a
 * legal exposure had been written into a style and made invisible at the moment of use.
 *
 * Keeping motifs separate fixes both halves of that. A style no longer staples the same
 * props onto every subject, and anything that could belong to somebody else is listed where
 * it can be read, switched off by default, and reviewed before it is used.
 *
 * So: nothing in `grammar` may name a recognisable character, logo or mark, and `motifs`
 * should stay generic — "stars", not a particular star someone owns.
 */

export type DesignStyle = {
  id: string;
  name: string;
  /** How it is drawn. Always sent. No objects. */
  grammar: string;
  /** Objects added to the design. Only sent when asked for. */
  motifs?: string;
};

export const STYLES: DesignStyle[] = [
  {
    id: 'preppy',
    name: 'Preppy',
    grammar:
      'preppy coastal style: bright saturated pastels, pink, green and sky blue, bold clean even ' +
      'outlines, chunky rounded shapes, flat colour with no gradients, cheerful and youthful',
    motifs: 'gingham patterning, scalloped edges and ribbon bows',
  },
  {
    id: 'retro-70s',
    name: 'Retro 70s groovy',
    grammar:
      '1970s groovy style: burnt orange, mustard, avocado and cream, thick wavy outlines, ' +
      'flowing curved forms, warm slightly faded print',
    motifs: 'rainbow arcs, sun rays and bubble shapes',
  },
  {
    id: 'vintage-distressed',
    name: 'Vintage distressed',
    grammar:
      'vintage screen-print style: limited muted palette, heavy halftone dots and visible grain, ' +
      'cracked and worn ink texture, bold simplified shapes, looks printed decades ago',
  },
  {
    id: 'y2k',
    name: 'Y2K',
    grammar:
      'Y2K style: chrome and glossy gradients, hot pink, lime and electric blue, inflated bubbly ' +
      'forms, early-2000s graphic energy',
    motifs: 'stars, butterflies and sparkles',
  },
  {
    id: 'cottagecore',
    name: 'Cottagecore',
    grammar:
      'cottagecore style: soft muted sage, cream and dusty rose, delicate fine line work, ' +
      'gentle hand-drawn quality, soft and nostalgic',
    motifs: 'wildflowers, mushrooms and trailing botanicals',
  },
  {
    id: 'kawaii',
    name: 'Kawaii cartoon',
    grammar:
      'kawaii cartoon style: rounded chibi proportions, big simple eyes, soft pastel palette, ' +
      'thick friendly outlines, very cute and very simple',
    motifs: 'blush marks, sparkles and tiny stars',
  },
  {
    id: 'western',
    name: 'Western / cowgirl',
    grammar:
      'western style: tan, rust, turquoise and cream, bold slab shapes, weathered print, ' +
      'vintage rodeo poster feel',
    motifs: 'cactus, cowboy boots and hats, rope borders and stars',
  },
  {
    id: 'minimal-line',
    name: 'Minimal line art',
    grammar:
      'minimal single-weight line art: one or two colours only, continuous clean strokes, ' +
      'generous empty space, no shading or texture, calm and modern',
  },
  {
    id: 'boho',
    name: 'Boho neutral',
    grammar:
      'boho neutral style: warm terracotta, sand, clay and off-white, organic hand-drawn shapes, ' +
      'flat matte colour, earthy and understated',
    motifs: 'arches, sun and moon shapes and simple botanicals',
  },
  {
    id: 'comic-pop',
    name: 'Comic pop art',
    grammar:
      'comic book pop art style: bold black outlines, flat primary colours, ben-day halftone dots, ' +
      'punchy and graphic',
    motifs: 'speech bubbles, action lines and starbursts',
  },
  {
    id: 'watercolour',
    name: 'Watercolour',
    grammar:
      'soft watercolour style: translucent washes with visible pigment bleed and paper texture, ' +
      'gentle colour transitions, loose edges, delicate and painterly',
  },
  {
    id: 'folk',
    name: 'Scandinavian folk',
    grammar:
      'Scandinavian folk art style: deep red, forest green and cream, symmetrical flat decorative ' +
      'shapes, hand-painted wooden quality',
    motifs: 'stylised animals, folk flowers and repeating borders',
  },
  {
    id: 'varsity',
    name: 'Varsity collegiate',
    grammar:
      'varsity collegiate style: bold block and serif collegiate letterforms, layered offset ' +
      'outlines, two or three strong team colours, sporty and classic',
    motifs: 'chenille patch and felt texture, and stars',
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
  /**
   * Draw the style's motifs into the design as well.
   *
   * Off unless asked for. Motifs are props added to whatever the subject is, so leaving them
   * on by default makes every design in a style look like the last one, and quietly puts
   * objects on a garment that nobody chose to put there.
   */
  includeMotifs: boolean;
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

  const look = [
    style?.grammar,
    brief.includeMotifs && style?.motifs ? `Include ${style.motifs}` : null,
    brief.extra?.trim(),
  ]
    .filter(Boolean)
    .join('. ');

  return [
    'Redraw this image as a brand new t-shirt graphic in the following style.',
    `Style: ${look || 'keep the original style but make it cleaner and bolder'}.`,
    'Keep the same subject, pose and overall composition, but reinterpret every element in that style — do not simply recolour or filter the original.',
    brief.includeMotifs
      ? ''
      : 'Add no extra decorative objects that are not already in the reference.',
    brief.keepLettering
      ? 'Keep the same wording, redrawn as lettering that belongs to this style.'
      : 'Leave out all text and lettering; illustration only.',
    'Flat vector-style illustration suitable for screen printing on a dark garment.',
    'No scene, no shadow, no mockup, no frame.',
    // A chroma colour rather than "transparent background", because the best models for this
    // cannot output transparency — only 8 of Atlas's 84 can, and none of the good ones. Asked
    // for a dark background they draw a near-black rectangle, and a border flood cannot
    // remove the pockets of it enclosed by the subject, so one survived between Santa's arm
    // and a reindeer. Pure magenta is removable everywhere at once because nothing in the
    // artwork is that colour, enclosed or not.
    'Place the artwork on a completely solid flat background of pure magenta RGB(255, 0, 255).',
    'The magenta must be one uniform colour with no gradient, texture or shading, and must not appear anywhere in the artwork itself.',
  ]
    .filter(Boolean)
    .join(' ');
}
