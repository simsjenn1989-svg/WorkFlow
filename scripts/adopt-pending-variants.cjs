/**
 * Give Approved designs that hold an unpicked variant their artwork.
 *
 *   node --use-env-proxy scripts/adopt-pending-variants.cjs     # from the project root
 *
 * Moving a card right used to write only a stage, so 24 designs read Approved while
 * holding nothing. Each would have failed at its first render or push. The app now adopts
 * on the way past Generated; this is for the ones already sitting there.
 *
 * Only touches a design that is Approved, has no artwork, and has exactly one variant.
 * Anything with a real choice to make is named and left alone.
 */
require('tsx/cjs');
const { readFileSync } = require('node:fs');

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
}

(async () => {
  const { db } = require('../lib/supabase.ts');
  const { adoptVariant } = require('../lib/adopt.ts');
  const { normaliseDesign } = require('../lib/printify/canvas.ts');

  const { data: designs } = await db()
    .from('designs')
    .select('id,title')
    .eq('stage', 'approved')
    .order('created_at');

  let adopted = 0;
  const left = [];

  for (const design of designs) {
    const { data: art } = await db()
      .from('design_artworks')
      .select('id')
      .eq('design_id', design.id)
      .limit(1);
    if ((art ?? []).length > 0) continue;

    const { data: variants } = await db()
      .from('design_variants')
      .select('id')
      .eq('design_id', design.id);

    if ((variants ?? []).length !== 1) {
      left.push(`${design.title.slice(0, 44)} (${(variants ?? []).length} variants)`);
      continue;
    }

    const result = await adoptVariant(design.id, variants[0].id);
    if ('error' in result) {
      left.push(`${design.title.slice(0, 44)} (${result.error})`);
      continue;
    }

    const sized = await normaliseDesign(design.id);
    adopted++;
    const how = sized
      .map((s) => (s.error ? `FAILED ${s.error}` : `${s.result.widthIn}x${s.result.heightIn}in`))
      .join(', ');
    console.log(String(adopted).padStart(3), design.title.slice(0, 44).padEnd(46), how);
  }

  console.log(`\nadopted ${adopted}`);
  if (left.length) console.log('left alone:\n  ' + left.join('\n  '));

  const { data: after } = await db().from('designs').select('id,stage');
  const { data: arts } = await db().from('design_artworks').select('design_id');
  const have = new Set(arts.map((a) => a.design_id));
  console.log(
    'approved with no artwork now:',
    after.filter((d) => d.stage === 'approved' && !have.has(d.id)).length,
  );
  process.exit(0);
})();
