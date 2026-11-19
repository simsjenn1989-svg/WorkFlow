-- A design becomes a product concept that can hold more than one artwork.
--
-- A tee with a big front graphic and different back text is one design, not two. Keeping
-- the art in a child table keyed by placement label lets batch rendering match artwork to
-- print area by name, and lets a design with no back art simply skip a back area rather
-- than printing the front twice.
--
-- The labels line up with how Printify describes placements, so phase 4 inherits this
-- rather than translating.

create table design_artworks (
  id               uuid primary key default gen_random_uuid(),
  design_id        uuid not null references designs(id) on delete cascade,
  label            text not null default 'front',
  image_path       text not null,
  print_ready_path text,
  source_model     text,
  source_params    jsonb,
  created_at       timestamptz not null default now(),
  -- One artwork per placement. Replacing the back art replaces the row.
  unique (design_id, label)
);

create index design_artworks_design_idx on design_artworks(design_id);

alter table design_artworks enable row level security;

-- Carry every existing design's single image across as its front artwork.
insert into design_artworks (design_id, label, image_path, print_ready_path, source_model, source_params)
select id, 'front', raw_image_path, print_ready_path, source_model, source_params
from designs
where raw_image_path is not null;

-- A generation is for one placement, so a variant remembers which.
alter table design_variants add column if not exists label text not null default 'front';

-- The art now lives in design_artworks; leaving these would be a second source of truth.
alter table designs
  drop column if exists raw_image_path,
  drop column if exists print_ready_path;
