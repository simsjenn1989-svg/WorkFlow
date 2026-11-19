-- Custom fonts, kept rather than re-uploaded.
--
-- The original tool loaded a font file into the page and warned that it "need[s] re-loading
-- each time you open the app". Storing the file means a brand font is uploaded once and is
-- there in every later session.

create table fonts (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  -- The CSS family name the canvas draws with, unique per font so two uploads cannot clash.
  family     text not null unique,
  file_path  text not null,
  created_at timestamptz not null default now()
);

alter table fonts enable row level security;
