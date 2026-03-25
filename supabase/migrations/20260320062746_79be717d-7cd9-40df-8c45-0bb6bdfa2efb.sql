
ALTER TABLE public.staff_centre_assignments
  ADD COLUMN centre_locations text[] NOT NULL DEFAULT '{}'::text[];

UPDATE public.staff_centre_assignments
  SET centre_locations = CASE
    WHEN centre_location IS NOT NULL AND centre_location != '' THEN ARRAY[centre_location]
    ELSE '{}'::text[]
  END;

ALTER TABLE public.staff_centre_assignments
  DROP COLUMN centre_location;
