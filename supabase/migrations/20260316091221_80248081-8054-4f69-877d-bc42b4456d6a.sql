
-- Add requires_approval flag to templates
ALTER TABLE public.invoice_templates ADD COLUMN requires_approval BOOLEAN NOT NULL DEFAULT false;

-- User approval flags (keyed by external system_id)
CREATE TABLE public.user_approval_flags (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  system_id TEXT NOT NULL UNIQUE,
  user_name TEXT NOT NULL DEFAULT '',
  requires_approval BOOLEAN NOT NULL DEFAULT false,
  flagged_by TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.user_approval_flags ENABLE ROW LEVEL SECURITY;

-- Permissive policies (auth is handled externally)
CREATE POLICY "Allow all authenticated reads on user_approval_flags"
  ON public.user_approval_flags FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow all authenticated inserts on user_approval_flags"
  ON public.user_approval_flags FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow all authenticated updates on user_approval_flags"
  ON public.user_approval_flags FOR UPDATE TO authenticated USING (true);

-- Invoices table for tracking submissions
CREATE TABLE public.invoices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_number TEXT,
  contact_name TEXT NOT NULL,
  invoice_date TEXT NOT NULL,
  line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  template_id UUID REFERENCES public.invoice_templates(id) ON DELETE SET NULL,
  submitted_by_system_id TEXT NOT NULL,
  submitted_by_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending_approval',
  requires_approval BOOLEAN NOT NULL DEFAULT false,
  approval_note TEXT,
  approved_by TEXT,
  approved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all authenticated reads on invoices"
  ON public.invoices FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow all authenticated inserts on invoices"
  ON public.invoices FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow all authenticated updates on invoices"
  ON public.invoices FOR UPDATE TO authenticated USING (true);
