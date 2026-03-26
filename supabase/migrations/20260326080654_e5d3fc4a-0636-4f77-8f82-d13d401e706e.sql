
-- Add org_id and environment to invoices
ALTER TABLE public.invoices ADD COLUMN org_id text NOT NULL DEFAULT '';
ALTER TABLE public.invoices ADD COLUMN environment text NOT NULL DEFAULT 'production';

-- Add org_id and environment to invoice_logs
ALTER TABLE public.invoice_logs ADD COLUMN org_id text NOT NULL DEFAULT '';
ALTER TABLE public.invoice_logs ADD COLUMN environment text NOT NULL DEFAULT 'production';

-- Add org_id and environment to invoice_templates
ALTER TABLE public.invoice_templates ADD COLUMN org_id text NOT NULL DEFAULT '';
ALTER TABLE public.invoice_templates ADD COLUMN environment text NOT NULL DEFAULT 'production';

-- Add org_id and environment to staff_centre_assignments
ALTER TABLE public.staff_centre_assignments ADD COLUMN org_id text NOT NULL DEFAULT '';
ALTER TABLE public.staff_centre_assignments ADD COLUMN environment text NOT NULL DEFAULT 'production';

-- Add org_id and environment to user_approval_flags
ALTER TABLE public.user_approval_flags ADD COLUMN org_id text NOT NULL DEFAULT '';
ALTER TABLE public.user_approval_flags ADD COLUMN environment text NOT NULL DEFAULT 'production';
