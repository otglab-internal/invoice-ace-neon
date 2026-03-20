CREATE POLICY "Allow anon updates on invoices"
ON public.invoices
FOR UPDATE
TO anon
USING (true)
WITH CHECK (true);