/**
 * Rebuild every design's print canvas.
 *
 *   node --use-env-proxy scripts/renormalise.cjs     # from the project root
 *
 * For when the sizing rules change — the trim threshold, the placement rules, or the
 * preset's print area — and the canvases already on disk were built by the old ones. Each
 * canvas is named by a hash of its bytes, so an unchanged one is left alone and a changed
 * one replaces its predecessor rather than orphaning it.
 */
require('tsx/cjs');
const { readFileSync } = require('node:fs');

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
}

(async () => {
  const { db } = require('../lib/supabase.ts');
  const { normaliseDesign } = require('../lib/printify/canvas.ts');

  const { data: artworks } = await db().from('design_artworks').select('design_id');
  const ids = [...new Set(artworks.map((a) => a.design_id))];
  console.log(`${ids.length} designs with artwork\n`);

  let done = 0;
  const failures = [];
  for (const id of ids) {
    const results = await normaliseDesign(id);
    for (const r of results) {
      if (r.error) {
        failures.push(`${id.slice(0, 8)} ${r.label}: ${r.error}`);
        continue;
      }
      done++;
      console.log(
        String(done).padStart(3),
        id.slice(0, 8),
        r.label.padEnd(6),
        `${r.result.widthIn}x${r.result.heightIn}in  top ${r.result.topIn}in`,
      );
    }
  }

  console.log(`\nrebuilt ${done}`);
  if (failures.length) console.log('failed:\n  ' + failures.join('\n  '));
  process.exit(0);
})();
