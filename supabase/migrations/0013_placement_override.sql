-- A per-design nudge on top of the preset's rules.
--
-- Placement is computed from the trimmed art's real dimensions (see lib/printify/geometry.ts)
-- so that every design's top edge lands the same distance below the collar. That is right
-- almost always, and occasionally one design wants moving. This holds the exception.
--
-- Per artwork rather than per design: a front and a back are placed independently, and a
-- nudge to one should not move the other. Null means "use the computed placement", which is
-- different from a stored copy of the computed value — a stored copy would silently stop
-- following the rules if the preset's caps ever changed.
alter table design_artworks
  add column if not exists placement jsonb;

comment on column design_artworks.placement is
  'Optional {x,y,scale,angle} override. Null means use the geometry computed from the trimmed art.';
