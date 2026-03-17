CREATE POLICY "Allow anon reads on invoices"
ON public.invoices
FOR SELECT
TO anon
USING (true);