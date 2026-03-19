CREATE TABLE public.staff_centre_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id text NOT NULL,
  user_name text NOT NULL DEFAULT '',
  user_role text NOT NULL DEFAULT 'sales',
  centre_location text NOT NULL DEFAULT '',
  assigned_by text NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (system_id)
);

ALTER TABLE public.staff_centre_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon reads on staff_centre_assignments"
  ON public.staff_centre_assignments FOR SELECT TO anon USING (true);

CREATE POLICY "Allow anon inserts on staff_centre_assignments"
  ON public.staff_centre_assignments FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Allow anon updates on staff_centre_assignments"
  ON public.staff_centre_assignments FOR UPDATE TO anon USING (true);

CREATE POLICY "Allow anon deletes on staff_centre_assignments"
  ON public.staff_centre_assignments FOR DELETE TO anon USING (true);