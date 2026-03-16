CREATE POLICY "Allow public read of templates"
ON public.invoice_templates
FOR SELECT
TO anon
USING (true);