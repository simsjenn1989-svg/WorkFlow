-- A mockup can carry more than one print area.
--
-- A photo showing the front and the back of the garment side by side needs two, each with
-- its own artwork — that is how a front-and-back product gets one listing image. The
-- original single `print_area` could not express it.
--
-- Each area also carries its own measurements. When one photograph holds two shots, the
-- halves are lit differently, so a single baseline for the whole image is wrong for both.

alter table mockup_templates
  add column if not exists print_areas jsonb not null default '[]';

-- Carry any single area already marked into the new shape.
update mockup_templates
set print_areas = jsonb_build_array(
      jsonb_build_object(
        'id', gen_random_uuid()::text,
        'label', 'front',
        'corners', print_area -> 'corners',
        'garmentHex', garment_color,
        'baseLuma', base_luma
      )
    )
where jsonb_array_length(print_areas) = 0
  and print_area ? 'corners';

alter table mockup_templates
  drop column if exists print_area,
  drop column if exists garment_color,
  drop column if exists base_luma;
