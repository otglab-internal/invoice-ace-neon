## Migration Plan: Supabase → NeonDB (4 tenant databases)

All 6 tables move from the shared Supabase DB to the 4 NeonDB instances (OTG Prod, OTG SB, SK Prod, SK SB). The `org_id` and `environment` columns become unnecessary since each DB **is** a specific org+env.

### Step 1: Create a `data-proxy` edge function
A new edge function that handles all CRUD operations, routing to the correct NeonDB using the same `x-org-id` + `x-environment` header pattern as the `auth` function.

Actions: `query`, `insert`, `update`, `delete` — each accepting a `table` name and relevant params.

### Step 2: Add init-tables SQL for all 6 tables
Extend the `auth` function's `init-tables` action to create:
- `invoices`
- `invoice_templates`
- `invoice_logs`
- `staff_centre_assignments`
- `user_approval_flags`
- `global_config`

(Without `org_id`/`environment` columns since the DB itself provides isolation.)

### Step 3: Create `src/lib/neon-client.ts` helper
A frontend helper that wraps calls to the `data-proxy` edge function, providing a clean API like:
```ts
neonQuery('invoices', { filters: { status: 'approved' }, order: 'created_at' })
neonInsert('invoices', payload)
neonUpdate('invoices', { id }, updates)
```
It auto-attaches `x-org-id` and `x-environment` headers.

### Step 4: Rewrite all frontend pages
Replace every `supabase.from('table')` call with the neon-client helper:
- `DashboardPage.tsx` — invoice queries, global_config
- `CreateInvoicePage.tsx` — invoice insert, user_approval_flags, global_config
- `ApprovalsPage.tsx` — invoice queries/updates, invoice_logs
- `SettingsPage.tsx` — user_approval_flags, invoice_templates, staff_centre_assignments, global_config
- `TemplatesPage.tsx` — invoice_templates CRUD
- `LogsPage.tsx` — invoice_logs queries
- `GlobalConfigPage.tsx` — global_config CRUD
- `AllStaffPage.tsx` — staff_centre_assignments
- `AmendInvoiceDialog.tsx` — invoice updates, invoice_logs
- `AuthContext.tsx` — staff_centre_assignments
- `main.tsx` — global_config (favicon)

### Step 5: Run init-tables on all 4 NeonDB instances
Verify tables are created in each environment.

### What stays in Supabase
- Edge functions hosting (they just proxy to NeonDB)
- The Supabase client is still used to **invoke edge functions** — just not for direct DB queries
