CREATE POLICY "Allow anon inserts on invoices"
ON public.invoices
FOR INSERT
TO anon
WITH CHECK (true);