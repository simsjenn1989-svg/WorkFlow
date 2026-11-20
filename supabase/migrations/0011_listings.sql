-- Phase 7: writing the listing.
--
-- A pushed draft carries the design's raw title and whatever was in its notes. This is the
-- step that turns it into a listing, and the shape of these tables comes from measuring the
-- shop's own live products rather than from an idea of what a listing should look like.
--
-- What the measurement found, across 9 of 10 Comfort Colors listings in the TikTok shop:
--
--   Title        107-120 characters, four comma-separated chunks, the last one always
--                "Oversized Comfort Colors Gift".
--   Tags         exactly 13 — about seven specific to the design, then a fixed tail of
--                Comfort Colors / Oversized Tee / Unisex / Gift for Her / Gift for Him /
--                T-shirts. Longest tag measured 21 characters, so Etsy's 20-character limit
--                is being respected (with one slip, which this now catches).
--   Description  three short written paragraphs, then three blocks that are byte-identical
--                in every listing: "Why it slaps", "Care (yes, even chaos does laundry)" and
--                a size chart.
--
-- That last line is the important one. Those blocks are not creative writing, they are
-- product facts, and a model asked to reproduce them would eventually get a spec wrong. So
-- the style record holds them verbatim and the model is only asked for the parts that
-- actually vary.

create table listing_styles (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,

  -- The shop this voice belongs to. A Kindle-case shop and a slogan-tee shop do not write
  -- the same way, and the account has five shops.
  shop_id           text,

  -- Always the last comma-separated chunk of the title.
  title_suffix      text not null default '',
  -- How many chunks the model writes before that suffix.
  title_chunks      integer not null default 3,

  -- Tags appended to every listing, after the ones written for the design.
  tail_tags         text[] not null default '{}',

  -- Etsy's limits, which are the tightest of the channels in use: 140-character titles and
  -- 13 tags of at most 20 characters. Stored rather than hardcoded so a channel with
  -- different rules can have its own style.
  tag_count         integer not null default 13,
  tag_char_limit    integer not null default 20,
  title_char_limit  integer not null default 140,

  -- The fixed description blocks, in order:
  --   [{ "heading": "Why it slaps",
  --      "lines": [{ "text": "Printed on the front and back", "requires": "both-sides" },
  --                { "text": "100% ring-spun US cotton, pre-shrunk" }] }]
  -- `requires` lets a line appear only when it is true of the product — the front-and-back
  -- bullet is in the shop's two-sided listings and absent from the one-sided ones.
  blocks            jsonb not null default '[]'::jsonb,

  -- Free-text standing instruction, the equivalent of the starred headlines in the pin tool.
  voice_note        text,

  -- Send a few of the shop's real listings as style examples with every request.
  learn_from_shop   boolean not null default true,

  is_default        boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index listing_styles_default_idx
  on listing_styles((is_default)) where is_default;

-- listings was created in 0001 as a placeholder and never written to. The columns it already
-- has are the right ones; these are what writing to it actually needs.
alter table listings
  -- The model's structured answer, kept so the title and description can be re-composed
  -- after a style change without paying for the copy again.
  add column if not exists parts      jsonb,
  add column if not exists style_id   uuid references listing_styles(id) on delete set null,
  add column if not exists model      text,
  -- Written onto the Printify draft, as opposed to merely generated here.
  add column if not exists applied_at timestamptz,
  add column if not exists error      text;

-- `platform` goes. It was a two-value enum (etsy, tiktok) written before the account turned
-- out to have five shops across three channels, and it is redundant either way: a listing
-- belongs to a draft, a draft belongs to a shop, and the shop is what decides the channel.
-- Keeping it would mean a second place for that fact to be wrong.
alter table listings drop column if exists platform;

-- One listing per draft. Re-polishing replaces it rather than stacking up versions of the
-- same product's copy.
create unique index if not exists listings_product_idx on listings(printify_product_id);

alter table listing_styles enable row level security;

grant all privileges on table listing_styles to service_role;
revoke all on table listing_styles from anon, authenticated;
