
-- Fix 1: Add authenticated-only RLS policies for global_config
CREATE POLICY "auth_read_config" ON public.global_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_config" ON public.global_config FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_config" ON public.global_config FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Fix 2: Add authenticated-only RLS policies for staff_centre_assignments
CREATE POLICY "auth_read_staff" ON public.staff_centre_assignments FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_staff" ON public.staff_centre_assignments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_staff" ON public.staff_centre_assignments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_delete_staff" ON public.staff_centre_assignments FOR DELETE TO authenticated USING (true);

-- Fix 3: Make invoice-pdfs bucket private
UPDATE storage.buckets SET public = false WHERE id = 'invoice-pdfs';

-- Fix 4: Drop overly permissive storage policies
DROP POLICY IF EXISTS "Public can view invoice PDFs" ON storage.objects;
DROP POLICY IF EXISTS "Service role can upload invoice PDFs" ON storage.objects;

-- Fix 5: Add proper storage policies - authenticated users can view, service role uploads via service key automatically
CREATE POLICY "Authenticated can view invoice PDFs" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'invoice-pdfs');
