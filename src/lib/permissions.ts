/**
 * Role-based permissions for the application.
 *
 * Roles:
 *   - sales:       Base role. No inherent invoice permissions — needs "requester" tag.
 *   - centre:      No inherent invoice permissions — needs "requester" or "approver" tag.
 *                   Approver tag scopes approval to their centre location.
 *   - management:  No inherent invoice permissions — needs "requester" or "approver" tag.
 *                   Approver tag gives global approval access.
 *   - admin:       Full access to everything including settings and global config.
 *                   Always has requester + approver capabilities.
 *
 * Tags (assigned on All Staff page):
 *   - requester:   Can create invoices and view their own invoices.
 *   - approver:    Can approve invoices (scoped by centre for centre role, global for management).
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
  /** Can create new invoices (requires "requester" tag or admin) */
  canCreateInvoice: boolean;
  /** Can view invoice history on dashboard (requires requester or approver tag, or admin) */
  canViewInvoices: boolean;
  /** Can only see their own invoices (requester without global view) */
  viewOwnInvoicesOnly: boolean;
  /** Can see ALL invoices regardless of who submitted */
  canViewAllInvoices: boolean;
  /** Can approve / reject invoices (requires "approver" tag or admin) */
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

  if (role === "admin") {
    return {
      canCreateInvoice: true,
      canViewInvoices: true,
      viewOwnInvoicesOnly: false,
      canViewAllInvoices: true,
      canApproveInvoices: true,
      approveSubordinatesOnly: false,
      canAccessApprovals: true,
      canAccessSettings: true,
      canAccessGlobalConfig: true,
      canManageTemplates: true,
      canAccessAllStaff: true,
      isSystemAdmin: true,
    };
  }

  const isRequester = hasTag("requester");
  const isApprover = hasTag("approver");

  return {
    canCreateInvoice: isRequester,
    canViewInvoices: isRequester || isApprover,
    viewOwnInvoicesOnly: isRequester && !isApprover && role !== "management",
    canViewAllInvoices: isApprover && role === "management",
    canApproveInvoices: isApprover,
    approveSubordinatesOnly: isApprover && role === "centre",
    canAccessApprovals: isApprover,
    canAccessSettings: false,
    canAccessGlobalConfig: false,
    canManageTemplates: false,
    canAccessAllStaff: role === "management",
    isSystemAdmin: false,
  };
}
