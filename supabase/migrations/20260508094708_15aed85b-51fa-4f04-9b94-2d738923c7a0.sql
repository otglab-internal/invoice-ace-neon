
-- Lock down all tables: revoke direct client access. All legitimate access
-- happens via edge functions using the service role, which bypasses RLS.

-- invoices
DROP POLICY IF EXISTS "Allow all authenticated reads on invoices" ON public.invoices;
DROP POLICY IF EXISTS "Allow all authenticated inserts on invoices" ON public.invoices;
DROP POLICY IF EXISTS "Allow all authenticated updates on invoices" ON public.invoices;

-- staff_centre_assignments
DROP POLICY IF EXISTS "auth_read_staff" ON public.staff_centre_assignments;
DROP POLICY IF EXISTS "auth_insert_staff" ON public.staff_centre_assignments;
DROP POLICY IF EXISTS "auth_update_staff" ON public.staff_centre_assignments;
DROP POLICY IF EXISTS "auth_delete_staff" ON public.staff_centre_assignments;

-- user_approval_flags
DROP POLICY IF EXISTS "Allow all authenticated reads on user_approval_flags" ON public.user_approval_flags;
DROP POLICY IF EXISTS "Allow all authenticated inserts on user_approval_flags" ON public.user_approval_flags;
DROP POLICY IF EXISTS "Allow all authenticated updates on user_approval_flags" ON public.user_approval_flags;

-- global_config
DROP POLICY IF EXISTS "auth_read_config" ON public.global_config;
DROP POLICY IF EXISTS "auth_insert_config" ON public.global_config;
DROP POLICY IF EXISTS "auth_update_config" ON public.global_config;

-- invoice_templates
DROP POLICY IF EXISTS "Authenticated users can read templates" ON public.invoice_templates;
DROP POLICY IF EXISTS "Authenticated users can insert templates" ON public.invoice_templates;
DROP POLICY IF EXISTS "Creators can update their templates" ON public.invoice_templates;
DROP POLICY IF EXISTS "Creators can delete their templates" ON public.invoice_templates;

-- invoice_logs
DROP POLICY IF EXISTS "Allow authenticated reads on invoice_logs" ON public.invoice_logs;
DROP POLICY IF EXISTS "Allow authenticated inserts on invoice_logs" ON public.invoice_logs;

-- activity_logs
DROP POLICY IF EXISTS "Allow authenticated reads on activity_logs" ON public.activity_logs;
DROP POLICY IF EXISTS "Allow authenticated inserts on activity_logs" ON public.activity_logs;

-- Ensure RLS is still enabled (deny-by-default with no policies)
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_centre_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_approval_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.global_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- Lock down storage bucket invoice-pdfs (no client-side access; signed URLs / service role only)
DROP POLICY IF EXISTS "Authenticated can view invoice PDFs" ON storage.objects;
