/**
 * Which Atlas image-to-image models can output a transparent background.
 *
 *   node --use-env-proxy scripts/transparent-models.mjs
 *
 * Worth having as a script rather than a note, because the answer decides which models are
 * usable at all. Art with a baked background prints as a rectangle on a garment, so a model
 * that cannot leave one out needs its background cutting afterwards (lib/cutout.ts) — and
 * only a small minority can. At the last run: 9 of 84.
 *
 * It also catches the catalogue moving. An earlier hand-check of the same question said 8,
 * because it looked only for a `background` enum and `seedream-v5.5/edit` declares it
 * differently. Models get added and renamed; re-run this before trusting a count, including
 * the one in the comment above.
 */

const all = (await (await fetch('https://api.atlascloud.ai/api/v1/models')).json()).data;
const i2i = all.filter(
  (m) => m.type === 'Image' && (m.categories ?? []).includes('IMAGE-TO-IMAGE') && m.schema,
);

const rows = [];
await Promise.all(
  i2i.map(async (m) => {
    try {
      const input = (await (await fetch(m.schema)).json()).components.schemas.Input;
      const props = input.properties ?? {};

      // Deliberately broad: some models expose the option under a different field name, and
      // a missed one is a model needlessly excluded.
      const values = props.background?.enum ?? props.output_background?.enum ?? [];
      const transparent =
        values.some((v) => /transparent/i.test(String(v))) ||
        Object.keys(props).some((k) => /transparen/i.test(k));
      if (!transparent) return;

      rows.push({
        model: m.model,
        price: Number(m.price?.actual?.base_price ?? 0),
        // Not standardised, and sending the wrong one is silently ignored rather than
        // rejected — the model then invents from the prompt alone.
        ref: ['images', 'reference_images', 'reference_image_urls', 'image'].find((k) => k in props),
        sizes: (props.size?.enum ?? props.resolution?.enum ?? []).slice(-3).join(' '),
      });
    } catch {
      // An unreadable schema is reported by omission rather than crashing the sweep.
    }
  }),
);

console.log(`${rows.length} of ${i2i.length} image-to-image models can output transparency\n`);
for (const r of rows.sort((a, b) => a.price - b.price)) {
  console.log(
    `  $${r.price.toFixed(3).padStart(6)}  ${r.model.padEnd(46)} ref=${String(r.ref).padEnd(18)} ${r.sizes}`,
  );
}
