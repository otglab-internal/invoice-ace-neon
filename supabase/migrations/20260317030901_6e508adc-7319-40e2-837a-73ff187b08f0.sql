CREATE POLICY "Allow anon inserts on invoice_templates"
ON public.invoice_templates
FOR INSERT
TO anon
WITH CHECK (true);

CREATE POLICY "Allow anon updates on invoice_templates"
ON public.invoice_templates
FOR UPDATE
TO anon
USING (true);

CREATE POLICY "Allow anon deletes on invoice_templates"
ON public.invoice_templates
FOR DELETE
TO anon
USING (true);