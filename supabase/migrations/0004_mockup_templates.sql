-- The renderer derives folds, weave and garment colour from the source photograph at render
-- time, so the precomputed shadow/highlight/mask maps the original schema reserved are never
-- written. Dropping them rather than leaving three columns that always hold null.
alter table mockup_templates
  drop column if exists shadow_map_path,
  drop column if exists highlight_map_path,
  drop column if exists mask_path;

-- Per-template render tuning: shadingStrength, textureStrength, bleed, inkOpacity, featherPx.
-- A washed charcoal tee and a near-black one want slightly different numbers, and that is a
-- property of the template, not of a single render.
alter table mockup_templates
  add column if not exists render_options jsonb not null default '{}';

-- Measured from inside the print area when the area is saved, so the renderer never has to
-- assume a garment is pure black.
alter table mockup_templates
  add column if not exists base_luma integer;

-- Mockups are photographs now; PSD support was dropped. The enum keeps its other value for
-- the moment rather than forcing a rewrite of a type still referenced by the column default.
alter table mockup_templates alter column source_type set default 'photo';
