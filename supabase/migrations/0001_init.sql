-- WorkFlow initial schema.
-- The full data model from docs/SPEC.md §9 is created here in one migration so that later
-- phases add behaviour, not tables. Tables are grouped by the phase that first uses them.
--
-- Access model: single operator. RLS is ON with no anon/authenticated policies, so the
-- anon key can read nothing. All access goes through the server using the service role key.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- enums

create type design_stage as enum (
  'idea',          -- a prompt exists
  'generated',     -- variants returned, none chosen
  'approved',      -- a keeper was picked
  'print_ready',   -- background removed, upscaled to the blueprint print size
  'mockups_done',  -- rendered onto mockup templates
  'assets_done',   -- pins composed, video generated
  'pushed',        -- draft product created in Printify
  'polished',      -- title/description/tags written
  'published',     -- live. Set by a human, never by the app
  'rejected',
  'archived'
);

create type job_status as enum ('queued','running','done','failed','cancelled');
create type mockup_source as enum ('photo','psd');
create type sales_platform as enum ('etsy','tiktok');

-- ---------------------------------------------------------------- phase 1

create table collections (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  theme       text,
  notes       text,
  created_at  timestamptz not null default now()
);

create table prompts (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  body          text not null,
  slots         text[] not null default '{}',
  target_model  text,
  notes         text,
  created_at    timestamptz not null default now()
);

create table designs (
  id               uuid primary key default gen_random_uuid(),
  collection_id    uuid references collections(id) on delete set null,
  prompt_id        uuid references prompts(id) on delete set null,
  stage            design_stage not null default 'idea',
  title            text not null,
  tags             text[] not null default '{}',
  source_model     text,
  source_params    jsonb,
  seed             text,
  raw_image_path   text,
  print_ready_path text,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  stage_changed_at timestamptz not null default now()
);

create index designs_stage_idx      on designs(stage);
create index designs_collection_idx on designs(collection_id);
create index designs_tags_idx       on designs using gin(tags);
create index designs_created_idx    on designs(created_at desc);

-- Stage history, so "how long has this sat here" and "what happened to it" are answerable.
create table stage_events (
  id          uuid primary key default gen_random_uuid(),
  design_id   uuid not null references designs(id) on delete cascade,
  from_stage  design_stage,
  to_stage    design_stage not null,
  note        text,
  created_at  timestamptz not null default now()
);

create index stage_events_design_idx on stage_events(design_id, created_at desc);

-- ---------------------------------------------------------------- phase 2

create table design_variants (
  id          uuid primary key default gen_random_uuid(),
  design_id   uuid not null references designs(id) on delete cascade,
  image_path  text not null,
  model       text,
  params      jsonb,
  chosen      boolean not null default false,
  cost_cents  integer not null default 0,
  created_at  timestamptz not null default now()
);

create index design_variants_design_idx on design_variants(design_id);

-- ---------------------------------------------------------------- phase 3 / 4

create table products (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  blueprint_id       integer,
  print_provider_id  integer,
  variants           jsonb not null default '[]',
  placement          jsonb not null default '{}',
  pricing            jsonb not null default '{}',
  created_at         timestamptz not null default now()
);

create table mockup_templates (
  id                  uuid primary key default gen_random_uuid(),
  product_id          uuid references products(id) on delete set null,
  name                text not null,
  source_type         mockup_source not null,
  source_path         text not null,
  print_area          jsonb not null default '{}',   -- {corners:[...]} or {mesh:{...}}
  shadow_map_path     text,
  highlight_map_path  text,
  mask_path           text,
  garment_color       text,
  tags                text[] not null default '{}',  -- angle, scene, colorway
  active              boolean not null default true,
  created_at          timestamptz not null default now()
);

create table export_presets (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  width           integer not null,
  height          integer not null,
  format          text not null default 'jpeg',
  quality         integer not null default 90,
  naming_pattern  text not null default '{collection}_{design}_{product}_{angle}_{index}',
  created_at      timestamptz not null default now()
);

create table renders (
  id                   uuid primary key default gen_random_uuid(),
  design_id            uuid not null references designs(id) on delete cascade,
  mockup_template_id   uuid not null references mockup_templates(id) on delete cascade,
  export_preset_id     uuid references export_presets(id) on delete set null,
  output_path          text,
  status               job_status not null default 'queued',
  created_at           timestamptz not null default now()
);

create index renders_design_idx on renders(design_id);

-- ---------------------------------------------------------------- phase 5 (pins)

create table pin_templates (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  canvas       jsonb not null default '{}',  -- {w,h}
  slots        jsonb not null default '[]',  -- image slots
  text_blocks  jsonb not null default '[]',  -- headline/sub/cta/footer styling
  created_at   timestamptz not null default now()
);

create table pins (
  id                uuid primary key default gen_random_uuid(),
  design_id         uuid not null references designs(id) on delete cascade,
  pin_template_id   uuid references pin_templates(id) on delete set null,
  source_render_id  uuid references renders(id) on delete set null,
  headline          text,
  subtitle          text,
  cta               text,
  footer            text,
  title             text,          -- Pinterest search title, stays live
  description       text,          -- Pinterest description, stays live
  link              text,
  output_path       text,
  created_at        timestamptz not null default now()
);

create index pins_design_idx on pins(design_id);

-- Headlines you starred, fed back as few-shot style examples. Ported from the legacy
-- tool's localStorage list so it survives a cache clear.
create table style_examples (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null default 'headline',
  text        text not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- phase 6 (video)

create table shot_templates (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  prompt        text not null,
  model         text not null,
  duration_s    integer not null default 6,
  aspect_ratio  text not null default '9:16',
  created_at    timestamptz not null default now()
);

create table videos (
  id                uuid primary key default gen_random_uuid(),
  design_id         uuid not null references designs(id) on delete cascade,
  source_render_id  uuid references renders(id) on delete set null,
  shot_template_id  uuid references shot_templates(id) on delete set null,
  model             text,
  output_path       text,
  duration_s        integer,
  cost_cents        integer not null default 0,
  status            job_status not null default 'queued',
  created_at        timestamptz not null default now()
);

create index videos_design_idx on videos(design_id);

-- ---------------------------------------------------------------- phase 4 (printify)

create table printify_products (
  id            uuid primary key default gen_random_uuid(),
  design_id     uuid not null references designs(id) on delete cascade,
  product_id    text not null,
  shop_id       text,
  blueprint_id  integer,
  status        text,
  pushed_at     timestamptz,
  published_at  timestamptz,
  created_at    timestamptz not null default now()
);

create index printify_products_design_idx on printify_products(design_id);

create table listings (
  id                    uuid primary key default gen_random_uuid(),
  printify_product_id   uuid not null references printify_products(id) on delete cascade,
  platform              sales_platform not null,
  title                 text,
  description           text,
  tags                  text[] not null default '{}',
  polished_at           timestamptz,
  created_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------- jobs & cost

create table jobs (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null,
  payload      jsonb not null default '{}',
  status       job_status not null default 'queued',
  cost_cents   integer not null default 0,
  error        text,
  created_at   timestamptz not null default now(),
  finished_at  timestamptz
);

create index jobs_status_idx on jobs(status, created_at);

create table cost_ledger (
  id            uuid primary key default gen_random_uuid(),
  design_id     uuid references designs(id) on delete set null,
  job_id        uuid references jobs(id) on delete set null,
  provider      text not null,
  model         text,
  amount_cents  integer not null,
  created_at    timestamptz not null default now()
);

create index cost_ledger_created_idx on cost_ledger(created_at desc);

-- ---------------------------------------------------------------- triggers

create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger designs_touch before update on designs
  for each row execute function touch_updated_at();

-- Record every stage change, and keep stage_changed_at honest.
create or replace function log_stage_change() returns trigger
language plpgsql as $$
begin
  if new.stage is distinct from old.stage then
    new.stage_changed_at := now();
    insert into stage_events (design_id, from_stage, to_stage)
    values (new.id, old.stage, new.stage);
  end if;
  return new;
end $$;

create trigger designs_log_stage before update on designs
  for each row execute function log_stage_change();

-- ---------------------------------------------------------------- RLS

do $$
declare t text;
begin
  foreach t in array array[
    'collections','prompts','designs','stage_events','design_variants','products',
    'mockup_templates','export_presets','renders','pin_templates','pins','style_examples',
    'shot_templates','videos','printify_products','listings','jobs','cost_ledger'
  ] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
