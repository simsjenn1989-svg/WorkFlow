/**
 * Which Atlas models can output a transparent background, for both directions.
 *
 *   node --use-env-proxy scripts/transparent-models.mjs            # text-to-image
 *   node --use-env-proxy scripts/transparent-models.mjs image      # image-to-image
 *   node --use-env-proxy scripts/transparent-models.mjs both
 *
 * Worth having as a script rather than a note, because the answer decides which models are
 * usable at all. Art with a baked background prints as a rectangle on a garment, so a model
 * that cannot leave one out needs its background cutting afterwards (lib/cutout.ts) — and
 * the cut is only as good as the edge it is given. A glow, a soft shadow, or a pink design
 * on the magenta screen all defeat it.
 *
 * It also catches the catalogue moving. An earlier hand-check said 8 image-to-image models,
 * because it looked only for a `background` enum and `seedream-v5.5/edit` declares it
 * differently. Models get added and renamed; re-run this before trusting any count.
 */

const which = (process.argv[2] ?? 'text').toLowerCase();
const categories =
  which === 'image'
    ? ['IMAGE-TO-IMAGE']
    : which === 'both'
      ? ['TEXT-TO-IMAGE', 'IMAGE-TO-IMAGE']
      : ['TEXT-TO-IMAGE'];

const all = (await (await fetch('https://api.atlascloud.ai/api/v1/models')).json()).data;
const models = all.filter(
  (m) => m.type === 'Image' && m.schema && (m.categories ?? []).some((c) => categories.includes(c)),
);

const rows = [];
let checked = 0;

await Promise.all(
  models.map(async (m) => {
    try {
      const input = (await (await fetch(m.schema)).json()).components.schemas.Input;
      const props = input.properties ?? {};
      checked++;

      // Deliberately broad: the option is spelled differently across the catalogue, and a
      // missed one is a model needlessly excluded.
      const named = Object.entries(props).filter(([k, v]) => {
        const enumValues = (v?.enum ?? []).map(String);
        return /transparen/i.test(k) || enumValues.some((e) => /transparen/i.test(e));
      });
      if (named.length === 0) return;

      rows.push({
        model: m.model,
        price: Number(m.price?.actual?.base_price ?? 0),
        how: named
          .map(([k, v]) => (v?.enum ? `${k}: ${v.enum.join('|')}` : `${k} (${v?.type ?? '?'})`))
          .join('  '),
      });
    } catch {
      // A schema that will not load is a model we cannot drive anyway.
    }
  }),
);

rows.sort((a, b) => a.price - b.price || a.model.localeCompare(b.model));
console.log(`${rows.length} of ${checked} ${categories.join(' + ')} models declare transparency\n`);
for (const r of rows) {
  console.log(`$${r.price.toFixed(3).padStart(6)}  ${r.model.padEnd(52)} ${r.how}`);
}
