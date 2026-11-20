-- `printify_presets.placements` changes meaning.
--
-- It held fixed coordinates ({x, y, scale, angle}) applied to every design alike. Because y
-- is the image CENTRE, that placed a short wordmark and a tall badge at visibly different
-- heights on the chest. Position is now computed per design from the trimmed art
-- (lib/printify/geometry.ts), so what belongs here is the rules, not the answer:
--
--   { "front": { "enabled": true }, "back": { "enabled": false } }
--
-- with optional topDropIn / maxWidthIn / maxHeightIn per area.
--
-- The old coordinates are dropped rather than carried across: they were the thing being
-- replaced, and keeping them would leave a stored answer silently overriding the calculation.
update printify_presets
set placements = (
  select coalesce(jsonb_object_agg(key, jsonb_build_object('enabled', true)), '{}'::jsonb)
  from jsonb_each(placements)
),
updated_at = now()
where placements is not null and placements <> '{}'::jsonb;
