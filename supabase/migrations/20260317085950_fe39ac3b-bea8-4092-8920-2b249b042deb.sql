CREATE TABLE public.global_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  value text NOT NULL DEFAULT '',
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.global_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon reads on global_config" ON public.global_config FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon inserts on global_config" ON public.global_config FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow anon updates on global_config" ON public.global_config FOR UPDATE TO anon USING (true);
CREATE POLICY "Allow anon deletes on global_config" ON public.global_config FOR DELETE TO anon USING (true);

INSERT INTO public.global_config (key, value) VALUES
  ('connection_string_production', ''),
  ('connection_string_sandbox', ''),
  ('logo_url', '');