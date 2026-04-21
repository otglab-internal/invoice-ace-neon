ALTER TABLE public.invoices
ADD COLUMN IF NOT EXISTS receipt_pdf_url TEXT;