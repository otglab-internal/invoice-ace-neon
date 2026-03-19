/**
 * Role-based permissions for the application.
 *
 * Local roles:
 *   - sales:       Can create invoices and view only their own invoices.
 *   - centre:      Can view invoices from sales users under them and approve if needed.
 *                   (Hierarchy definition is TBD — scaffolding only.)
 *   - management:  Can view and approve all invoices.
 *
 * System roles (existing):
 *   - admin:       Full access to everything including settings and global config.
 *   - accountant:  Same access as admin for approval/settings pages.
 */

export type AppRole = "sales" | "centre" | "management" | "admin";

/** Normalise whatever the backend returns into a known role string. */
export function normalizeRole(raw: string | undefined | null): AppRole {
  const lower = (raw ?? "").trim().toLowerCase();
  if (lower === "admin") return "admin";
  if (lower === "accountant") return "accountant";
  if (lower === "management") return "management";
  if (lower === "centre" || lower === "center") return "centre";
  return "sales"; // default / fallback
}

export interface Permissions {
  /** Can create new invoices */
  canCreateInvoice: boolean;
  /** Can only see their own invoices (sales) */
  viewOwnInvoicesOnly: boolean;
  /** Can see invoices from subordinates (centre — scoped by hierarchy TBD) */
  canViewSubordinateInvoices: boolean;
  /** Can see ALL invoices regardless of who submitted */
  canViewAllInvoices: boolean;
  /** Can approve / reject invoices */
  canApproveInvoices: boolean;
  /** Approval is scoped to subordinates only (centre — hierarchy TBD) */
  approveSubordinatesOnly: boolean;
  /** Can access the Approvals page */
  canAccessApprovals: boolean;
  /** Can access Settings page */
  canAccessSettings: boolean;
  /** Can access Global Config page */
  canAccessGlobalConfig: boolean;
  /** Can manage templates */
  canManageTemplates: boolean;
  /** Treat as system-level admin (admin | accountant) */
  isSystemAdmin: boolean;
}

export function getPermissions(role: AppRole): Permissions {
  switch (role) {
    case "sales":
      return {
        canCreateInvoice: true,
        viewOwnInvoicesOnly: true,
        canViewSubordinateInvoices: false,
        canViewAllInvoices: false,
        canApproveInvoices: false,
        approveSubordinatesOnly: false,
        canAccessApprovals: false,
        canAccessSettings: false,
        canAccessGlobalConfig: false,
        canManageTemplates: false,
        isSystemAdmin: false,
      };

    case "centre":
      return {
        canCreateInvoice: false,
        viewOwnInvoicesOnly: false,
        canViewSubordinateInvoices: true,
        canViewAllInvoices: false,
        canApproveInvoices: true,
        approveSubordinatesOnly: true, // scoped — hierarchy TBD
        canAccessApprovals: true,
        canAccessSettings: false,
        canAccessGlobalConfig: false,
        canManageTemplates: false,
        isSystemAdmin: false,
      };

    case "management":
      return {
        canCreateInvoice: false,
        viewOwnInvoicesOnly: false,
        canViewSubordinateInvoices: false,
        canViewAllInvoices: true,
        canApproveInvoices: true,
        approveSubordinatesOnly: false,
        canAccessApprovals: true,
        canAccessSettings: false,
        canAccessGlobalConfig: false,
        canManageTemplates: false,
        isSystemAdmin: false,
      };

    case "accountant":
      return {
        canCreateInvoice: true,
        viewOwnInvoicesOnly: false,
        canViewSubordinateInvoices: false,
        canViewAllInvoices: true,
        canApproveInvoices: true,
        approveSubordinatesOnly: false,
        canAccessApprovals: true,
        canAccessSettings: true,
        canAccessGlobalConfig: false,
        canManageTemplates: true,
        isSystemAdmin: true,
      };

    case "admin":
      return {
        canCreateInvoice: true,
        viewOwnInvoicesOnly: false,
        canViewSubordinateInvoices: false,
        canViewAllInvoices: true,
        canApproveInvoices: true,
        approveSubordinatesOnly: false,
        canAccessApprovals: true,
        canAccessSettings: true,
        canAccessGlobalConfig: true,
        canManageTemplates: true,
        isSystemAdmin: true,
      };
  }
}
