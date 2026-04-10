CREATE TABLE public.activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'system',
  performed_by TEXT NOT NULL DEFAULT '',
  performed_by_name TEXT NOT NULL DEFAULT '',
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  org_id TEXT NOT NULL DEFAULT '',
  environment TEXT NOT NULL DEFAULT 'production',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated reads on activity_logs"
  ON public.activity_logs FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated inserts on activity_logs"
  ON public.activity_logs FOR INSERT TO authenticated WITH CHECK (true);