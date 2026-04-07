
-- Add PDF URL column to invoices
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS invoice_pdf_url text DEFAULT NULL;

-- Create storage bucket for invoice PDFs
INSERT INTO storage.buckets (id, name, public)
VALUES ('invoice-pdfs', 'invoice-pdfs', true)
ON CONFLICT (id) DO NOTHING;

-- Public read access for invoice PDFs
CREATE POLICY "Public can view invoice PDFs"
ON storage.objects FOR SELECT
USING (bucket_id = 'invoice-pdfs');

-- Service role (edge functions) can upload PDFs
CREATE POLICY "Service role can upload invoice PDFs"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'invoice-pdfs');
