
-- Drop all anon policies on global_config
DROP POLICY IF EXISTS "Allow anon deletes on global_config" ON global_config;
DROP POLICY IF EXISTS "Allow anon inserts on global_config" ON global_config;
DROP POLICY IF EXISTS "Allow anon reads on global_config" ON global_config;
DROP POLICY IF EXISTS "Allow anon updates on global_config" ON global_config;

-- Drop all anon policies on invoice_logs
DROP POLICY IF EXISTS "Allow anon inserts on invoice_logs" ON invoice_logs;
DROP POLICY IF EXISTS "Allow anon reads on invoice_logs" ON invoice_logs;

-- Drop all anon policies on invoice_templates
DROP POLICY IF EXISTS "Allow anon deletes on invoice_templates" ON invoice_templates;
DROP POLICY IF EXISTS "Allow anon inserts on invoice_templates" ON invoice_templates;
DROP POLICY IF EXISTS "Allow anon updates on invoice_templates" ON invoice_templates;
DROP POLICY IF EXISTS "Allow public read of templates" ON invoice_templates;

-- Drop all anon policies on invoices
DROP POLICY IF EXISTS "Allow anon inserts on invoices" ON invoices;
DROP POLICY IF EXISTS "Allow anon reads on invoices" ON invoices;
DROP POLICY IF EXISTS "Allow anon updates on invoices" ON invoices;

-- Drop all anon policies on staff_centre_assignments
DROP POLICY IF EXISTS "Allow anon deletes on staff_centre_assignments" ON staff_centre_assignments;
DROP POLICY IF EXISTS "Allow anon inserts on staff_centre_assignments" ON staff_centre_assignments;
DROP POLICY IF EXISTS "Allow anon reads on staff_centre_assignments" ON staff_centre_assignments;
DROP POLICY IF EXISTS "Allow anon updates on staff_centre_assignments" ON staff_centre_assignments;

-- Drop all anon policies on user_approval_flags
DROP POLICY IF EXISTS "Allow anon deletes on user_approval_flags" ON user_approval_flags;
DROP POLICY IF EXISTS "Allow anon inserts on user_approval_flags" ON user_approval_flags;
DROP POLICY IF EXISTS "Allow anon reads on user_approval_flags" ON user_approval_flags;
DROP POLICY IF EXISTS "Allow anon updates on user_approval_flags" ON user_approval_flags;
