ALTER TABLE invoices
  ADD COLUMN amendment_status text DEFAULT NULL,
  ADD COLUMN amendment_data jsonb DEFAULT NULL,
  ADD COLUMN amendment_requested_by text DEFAULT NULL,
  ADD COLUMN amendment_requested_by_name text DEFAULT NULL,
  ADD COLUMN amendment_requested_at timestamptz DEFAULT NULL,
  ADD COLUMN amendment_note text DEFAULT NULL;