-- Phase 6: UGC video from a mockup render.
--
-- `videos` and `shot_templates` were sketched in 0001 and never written to. The columns they
-- already have are right; these are what actually generating a clip needs.
--
-- The one that matters is `source_path`. The renders are landscape — measured at 2000x1500
-- and 2000x1600 — and TikTok wants 9:16. Most image-to-video models take their aspect ratio
-- from the frame they are given (Seedance 2.5 offers only `ratio: adaptive`; Wan 3.0 has no
-- ratio field at all), so the vertical frame is not a crop applied to the result, it is the
-- input that decides the result's shape. Keeping it means you can see exactly what was sent
-- for the money, and re-run the same framing without re-deciding it.

alter table videos
  -- Atlas is asynchronous: the request returns an id and the clip arrives later.
  add column if not exists prediction_id text,
  add column if not exists prompt        text,
  add column if not exists params        jsonb,
  -- The prepared vertical frame that was sent.
  add column if not exists source_path   text,
  add column if not exists frame_mode    text,
  add column if not exists error         text,
  add column if not exists finished_at   timestamptz;

create index if not exists videos_status_idx on videos(status, created_at desc);

-- A shot is a reusable recipe: the motion prompt, the model, how long, and whatever extra
-- fields that model publishes. Worth keeping because the prompt is the hard part and the
-- same one works across designs.
alter table shot_templates
  add column if not exists params     jsonb not null default '{}'::jsonb,
  add column if not exists frame_mode text not null default 'crop',
  add column if not exists is_default boolean not null default false;

-- Deliberately seeds no shots. A motion prompt that works is found by trying it, and a
-- seeded one would be a guess presented as a starting point.
