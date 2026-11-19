-- Pin templates hold a whole style, matching the shape the original Pin Maker used.
--
-- The reserved canvas/slots/text_blocks columns described a layout engine that was never
-- built; the ported tool has five named layouts and one style object instead. Keeping the
-- unused columns would only invite guessing about which is authoritative.

alter table pin_templates
  add column if not exists style jsonb not null default '{}',
  drop column if exists canvas,
  drop column if exists slots,
  drop column if exists text_blocks;

-- A pin records the style and framing it was made with, so it can be reopened and changed
-- rather than rebuilt from memory.
alter table pins
  add column if not exists style   jsonb not null default '{}',
  add column if not exists content jsonb not null default '{}';

-- Templates are deliberately not seeded. They hold a whole look — size, layout, type and
-- colours — whereas the six built-in themes in the UI change colours only. Shipping
-- templates named after the themes put two identically-named buttons on the same screen
-- that did different things.
