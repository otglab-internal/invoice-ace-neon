import { getOrgId } from "@/lib/runtime-config";

/**
 * Returns the current tenant's org_id and environment for filtering all DB queries.
 * Environment comes from localStorage (set during login).
 */
export function getTenantFilter() {
  const org_id = getOrgId();
  const environment = localStorage.getItem("auth_environment") || "production";
  return { org_id, environment };
}

/**
 * Returns just org_id for tables that don't need environment scoping (e.g. global_config).
 */
export function getOrgFilter() {
  return { org_id: getOrgId() };
}
