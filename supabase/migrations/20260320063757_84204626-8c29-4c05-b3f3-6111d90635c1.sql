
CREATE POLICY "Allow anon inserts on user_approval_flags"
ON public.user_approval_flags FOR INSERT TO anon
WITH CHECK (true);

CREATE POLICY "Allow anon reads on user_approval_flags"
ON public.user_approval_flags FOR SELECT TO anon
USING (true);

CREATE POLICY "Allow anon updates on user_approval_flags"
ON public.user_approval_flags FOR UPDATE TO anon
USING (true) WITH CHECK (true);

CREATE POLICY "Allow anon deletes on user_approval_flags"
ON public.user_approval_flags FOR DELETE TO anon
USING (true);
