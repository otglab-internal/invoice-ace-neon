
CREATE TABLE public.invoice_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE CASCADE NOT NULL,
  action_type text NOT NULL,
  source text NOT NULL DEFAULT 'ui',
  performed_by text NOT NULL DEFAULT '',
  performed_by_name text NOT NULL DEFAULT '',
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.invoice_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon reads on invoice_logs" ON public.invoice_logs FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon inserts on invoice_logs" ON public.invoice_logs FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow authenticated reads on invoice_logs" ON public.invoice_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated inserts on invoice_logs" ON public.invoice_logs FOR INSERT TO authenticated WITH CHECK (true);
