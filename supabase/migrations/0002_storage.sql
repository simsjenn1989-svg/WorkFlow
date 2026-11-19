-- Private storage for every image the app handles. Nothing is public; the server issues
-- short-lived signed URLs when the browser needs to display a file.
insert into storage.buckets (id, name, public)
values ('workflow', 'workflow', false)
on conflict (id) do nothing;

-- Path convention inside the bucket:
--   designs/{design_id}/raw.{ext}
--   designs/{design_id}/print-ready.png
--   designs/{design_id}/variants/{variant_id}.{ext}
--   mockups/{template_id}/source.{ext}
--   mockups/{template_id}/shadow.png | highlight.png | mask.png
--   renders/{render_id}.{ext}
--   pins/{pin_id}.{ext}
--   videos/{video_id}.mp4
