/**
 * Role-based permissions for the application.
 *
 * Roles:
 *   - sales:       Base role. No inherent invoice permissions — needs "requester" tag.
 *   - centre:      No inherent invoice permissions — needs "requester" or "approver" tag.
 *                   Approver tag scopes approval to their centre location.
 *   - management:  No inherent invoice permissions — needs "requester" or "approver" tag.
 *                   Approver tag gives global approval access.
 *   - admin:       Access to settings, global config, templates, all staff.
 *                   Still needs requester/approver tags for invoice capabilities.
 *
 * Tags (assigned on All Staff page):
 *   - requester:   Can create invoices and view their own invoices.
 *   - approver:    Can approve invoices (scoped by centre for centre role, global for management/admin).
 */

export type AppRole = "sales" | "centre" | "management" | "admin";
export type StaffTag = "requester" | "approver";

/** Normalise whatever the backend returns into a known role string. */
export function normalizeRole(raw: string | undefined | null): AppRole {
  const lower = (raw ?? "").trim().toLowerCase();
  if (lower === "admin") return "admin";
  if (lower === "management") return "management";
  if (lower === "centre" || lower === "center") return "centre";
  return "sales";
}

export interface Permissions {
  /** Can create new invoices (requires "requester" tag) */
  canCreateInvoice: boolean;
  /** Can view invoice history on dashboard (requires requester or approver tag) */
  canViewInvoices: boolean;
  /** Can only see their own invoices (requester without global view) */
  viewOwnInvoicesOnly: boolean;
  /** Can see ALL invoices regardless of who submitted */
  canViewAllInvoices: boolean;
  /** Can approve / reject invoices (requires "approver" tag) */
  canApproveInvoices: boolean;
  /** Approval is scoped to their centre only (centre role with approver tag) */
  approveSubordinatesOnly: boolean;
  /** Can access the Approvals page */
  canAccessApprovals: boolean;
  /** Can access Settings page */
  canAccessSettings: boolean;
  /** Can access Global Config page */
  canAccessGlobalConfig: boolean;
  /** Can manage templates */
  canManageTemplates: boolean;
  /** Can access the All Staff page */
  canAccessAllStaff: boolean;
  /** Treat as system-level admin */
  isSystemAdmin: boolean;
}

export function getPermissions(role: AppRole, tags: StaffTag[] = []): Permissions {
  const hasTag = (t: StaffTag) => tags.includes(t);
  const isRequester = hasTag("requester");
  const isApprover = hasTag("approver");

  const isAdmin = role === "admin";

  return {
    canCreateInvoice: isRequester,
    canViewInvoices: isRequester || isApprover,
    viewOwnInvoicesOnly: isRequester && !isApprover && role !== "management" && !isAdmin,
    canViewAllInvoices: isApprover && (role === "management" || isAdmin),
    canApproveInvoices: isApprover,
    approveSubordinatesOnly: isApprover && role === "centre",
    canAccessApprovals: isApprover,
    canAccessSettings: isAdmin,
    canAccessGlobalConfig: isAdmin,
    canManageTemplates: isAdmin,
    canAccessAllStaff: isAdmin || role === "management",
    isSystemAdmin: isAdmin,
  };
}
