-- Batch rendering.
--
-- A run is a set of design x mockup pairs. Each pair is one row, so a failure is isolated to
-- the pair that caused it rather than taking the batch down, and a part-finished run can be
-- resumed instead of restarted.

alter table renders
  add column if not exists batch_id    uuid,
  add column if not exists error       text,
  add column if not exists finished_at timestamptz;

create index if not exists renders_batch_idx on renders(batch_id, status);

-- Re-running a design onto the same mockup replaces the earlier render rather than piling
-- up near-identical files.
create unique index if not exists renders_design_mockup_idx
  on renders(design_id, mockup_template_id);
