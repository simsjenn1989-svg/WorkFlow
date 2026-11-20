-- Phase 4: pushing a design to Printify as a draft.
--
-- Three tables, because three things have genuinely different lifetimes:
--
--   printify_presets   how a product is built (blueprint, provider, colour, sizes, prices).
--                      Edited rarely, reused by every push.
--   printify_uploads   Printify's own id for an artwork file we have already sent it.
--                      Printify keeps uploaded images indefinitely and addresses them by id,
--                      so re-pushing a design must not re-upload a 4000px PNG. Keyed by
--                      artwork, not by design, because a front and a back are separate files.
--   printify_products  one push: which design, which preset, what came back, what was skipped.
--
-- Nothing here publishes. A product created through the API is a draft until POST .../publish
-- is called, and the app never calls it — see docs/DECISIONS.md.

-- 0001 created a placeholder printify_products with a guessed shape, before any of
-- Printify's API had been measured. It was never written to (confirmed empty). The real
-- shape below differs enough — per-size prices, skipped placements, batch ids — that
-- replacing it is honest where a pile of alter statements would not be.
-- CASCADE here drops only the dependent foreign-key constraint on listings, not listings
-- itself; the constraint is re-added against the new table at the end of this migration.
drop table if exists printify_products cascade;

create table printify_presets (
  id                 uuid primary key default gen_random_uuid(),
  name               text    not null,

  -- Which Printify shop drafts land in. Stored as text: Printify's shop ids are numeric but
  -- large, and nothing here does arithmetic on them.
  shop_id            text    not null,
  shop_title         text,

  blueprint_id       integer not null,
  print_provider_id  integer not null,

  -- The colour this preset sells. One colour per preset keeps variant maths trivial and
  -- matches how the shop actually works today.
  colour             text    not null default 'Black',

  -- Enabled variants and their prices, in the order they should appear:
  --   [{ "variantId": 73196, "size": "S", "priceCents": 3699 }, ...]
  -- Prices differ per size, so they belong next to the variant and not in one column.
  variants           jsonb   not null default '[]'::jsonb,

  -- Placement defaults, keyed by artwork label, in Printify's own normalised units
  -- (x/y are the image centre, 0..1 across the print area; scale 1 fills its width):
  --   { "front": { "x": 0.5, "y": 0.5, "scale": 1, "angle": 0 }, ... }
  placements         jsonb   not null default '{}'::jsonb,

  -- The largest placeholder across the enabled variants, measured from the catalogue. Print
  -- art is prepared against this, so a later blueprint change can be spotted rather than
  -- silently producing undersized files.
  print_width_px     integer,
  print_height_px    integer,

  is_default         boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- At most one default preset, so the push screen never has to guess between two.
create unique index printify_presets_default_idx
  on printify_presets((is_default)) where is_default;

create table printify_uploads (
  artwork_id         uuid primary key references design_artworks(id) on delete cascade,
  -- Printify's image id, returned by POST /v1/uploads/images.json.
  printify_image_id  text    not null,
  file_name          text    not null,
  width              integer not null,
  height             integer not null,
  -- The exact stored file that was sent. If the print-ready file is regenerated this stops
  -- matching, which is how a stale upload is detected instead of being reused forever.
  source_path        text    not null,
  created_at         timestamptz not null default now()
);

create table printify_products (
  id                   uuid primary key default gen_random_uuid(),
  design_id            uuid not null references designs(id) on delete cascade,
  preset_id            uuid not null references printify_presets(id) on delete restrict,

  batch_id             uuid,
  status               text not null default 'queued'
                         check (status in ('queued','running','draft','failed')),

  -- Printify's product id, and the shop it lives in, so the listing can be linked to.
  printify_product_id  text,
  shop_id              text,

  title                text,
  -- Placements the preset wanted but the design had no artwork for. Recorded rather than
  -- substituted: a back area filled with the front graphic is a ruined product, and the
  -- user asked for these to be listed instead.
  skipped              text[] not null default '{}',

  error                text,
  created_at           timestamptz not null default now(),
  finished_at          timestamptz
);

create index printify_products_batch_idx on printify_products(batch_id, status);

-- Re-pushing a design with the same preset updates that draft rather than creating a second.
create unique index printify_products_design_preset_idx
  on printify_products(design_id, preset_id);

alter table printify_presets  enable row level security;
alter table printify_uploads  enable row level security;
alter table printify_products enable row level security;

-- 0003 set default privileges, but only for tables created by the same role. Granting
-- explicitly here is cheap and removes any doubt.
grant all privileges on table printify_presets, printify_uploads, printify_products
  to service_role;
revoke all on table printify_presets, printify_uploads, printify_products
  from anon, authenticated;

-- listings is still phase-6's placeholder (the Playground.ai polish step) and is empty, but
-- its link back to a pushed product is part of the schema's shape, so it is restored rather
-- than quietly lost with the table it pointed at.
alter table listings
  add constraint listings_printify_product_id_fkey
  foreign key (printify_product_id) references printify_products(id) on delete cascade;
