ALTER TABLE staff_centre_assignments DROP CONSTRAINT staff_centre_assignments_system_id_key;
ALTER TABLE staff_centre_assignments ADD CONSTRAINT staff_centre_assignments_tenant_unique UNIQUE (system_id, org_id, environment);

DELETE FROM staff_centre_assignments WHERE id = '41adfa40-cc9f-4e87-8cec-4ccee90668a2';