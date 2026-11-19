/**
 * Quality proof for the mockup renderer.
 *
 * Renders a design onto real garment photos at hand-estimated print areas and writes the
 * results somewhere they can be looked at. The point is to judge whether the output reads as
 * printed before any editor UI is built on top of it.
 *
 *   npx tsx scripts/render-proof.mts <designPng> <outDir> <mockup.jpg...>
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { renderMockup } from '../lib/render/compose';
import type { Quad } from '../lib/render/homography';

/**
 * Print areas as fractions of each image, estimated by eye from the photographs.
 * The editor replaces this by hand-marking; here it only has to be close enough to judge
 * the compositing.
 */
const AREAS: Record<string, { cx: number; cy: number; w: number; h: number; skew?: number }> = {
  '2.jpg': { cx: 0.5, cy: 0.56, w: 0.3, h: 0.3 },
  '3.jpg': { cx: 0.47, cy: 0.52, w: 0.3, h: 0.3, skew: 0.012 },
  '4.jpg': { cx: 0.45, cy: 0.52, w: 0.28, h: 0.28, skew: -0.01 },
};

function quadFor(name: string, w: number, h: number): Quad {
  const a = AREAS[name] ?? { cx: 0.5, cy: 0.5, w: 0.3, h: 0.3 };
  const halfW = (a.w * w) / 2;
  const halfH = (a.h * h) / 2;
  const cx = a.cx * w;
  const cy = a.cy * h;
  const skew = (a.skew ?? 0) * w;
  return [
    { x: cx - halfW + skew, y: cy - halfH },
    { x: cx + halfW + skew, y: cy - halfH },
    { x: cx + halfW - skew, y: cy + halfH },
    { x: cx - halfW - skew, y: cy + halfH },
  ];
}

const [, , designPath, outDir, ...mockups] = process.argv;
if (!designPath || !outDir || mockups.length === 0) {
  console.error('usage: render-proof.mts <designPng> <outDir> <mockup.jpg...>');
  process.exit(1);
}

await mkdir(outDir, { recursive: true });
const design = await readFile(designPath);

for (const file of mockups) {
  const name = path.basename(file);
  const mockup = await readFile(file);
  const meta = await sharp(mockup).metadata();
  const quad = quadFor(name, meta.width ?? 0, meta.height ?? 0);

  // Rendered twice: once as shipped, once flat, so the shading can be judged by comparison.
  const real = await renderMockup({ mockup, placements: [{ quad, design }], maxEdge: 1400 });
  const flat = await renderMockup({
    mockup,
    placements: [{ quad, design }],
    maxEdge: 1400,
    options: { shadingStrength: 0, textureStrength: 0, bleed: 0, inkOpacity: 1, featherPx: 0 },
  });

  await writeFile(path.join(outDir, `${name}-shaded.jpg`), real.jpeg);
  await writeFile(path.join(outDir, `${name}-flat.jpg`), flat.jpeg);

  const m = real.placements[0]!;
  console.log(`${name}: ${real.width}x${real.height}  garment ${m.garmentHex}  baseLuma ${m.baseLuma}`);
}
