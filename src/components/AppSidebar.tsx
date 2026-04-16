import React from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { LayoutDashboard, FilePlus, CheckSquare, Settings, LogOut, FileText, LayoutTemplate, Wrench, Users, ScrollText, BookOpen } from "lucide-react";
import { useBranding } from "@/hooks/use-branding";

interface NavItem {
  to: string;
  label: string;
  icon: React.FC<{ className?: string }>;
  permissionKey: string | null;
}

const navItems: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, permissionKey: null },
  { to: "/create-invoice", label: "Create Invoice", icon: FilePlus, permissionKey: "canCreateInvoice" },
  { to: "/all-invoices", label: "All Invoices", icon: FileText, permissionKey: "canViewInvoices" },
  { to: "/templates", label: "Templates", icon: LayoutTemplate, permissionKey: "canManageTemplates" },
  { to: "/approvals", label: "Approvals", icon: CheckSquare, permissionKey: "canAccessApprovals" },
  { to: "/settings", label: "Settings", icon: Settings, permissionKey: "canAccessSettings" },
  { to: "/global-config", label: "Global Config", icon: Wrench, permissionKey: "canAccessGlobalConfig" },
  { to: "/all-staff", label: "All Staff", icon: Users, permissionKey: "canAccessAllStaff" },
  { to: "/logs", label: "Logs", icon: ScrollText, permissionKey: "canAccessApprovals" },
  { to: "/api-docs", label: "API Docs", icon: BookOpen, permissionKey: null },
];

interface AppSidebarProps {
  onNavigate?: () => void;
}

const AppSidebar: React.FC<AppSidebarProps> = ({ onNavigate }) => {
  const { user, logout, permissions } = useAuth();
  const navigate = useNavigate();
  const { logoUrl } = useBranding();

  const visibleNavItems = navItems.filter((item) => {
    if (!item.permissionKey) return true;
    return (permissions as any)[item.permissionKey] === true;
  });

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <aside className="flex flex-col h-full bg-sidebar">
      <div className="p-5 border-b border-sidebar-border">
        <div className="flex items-center gap-2 min-w-0">
          {logoUrl ? (
            <img src={logoUrl} alt="Logo" className="h-8 w-8 shrink-0 object-contain" />
          ) : (
            <FileText className="w-6 h-6 shrink-0 text-sidebar-primary" />
          )}
          <span className="font-display font-bold text-lg text-sidebar-foreground whitespace-nowrap truncate">Invoice Center</span>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {visibleNavItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-sidebar-accent text-sidebar-foreground"
                  : "text-sidebar-muted hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              }`
            }
          >
            <item.icon className="w-4 h-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="p-4 border-t border-sidebar-border">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-sidebar-accent flex items-center justify-center text-xs font-bold text-sidebar-foreground">
            {user?.firstName?.[0]}{user?.lastName?.[0]}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-sidebar-foreground truncate">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="text-xs text-sidebar-muted capitalize">{user?.role}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 text-sm text-sidebar-muted hover:text-sidebar-foreground transition-colors w-full px-2 py-1.5"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
};

export default AppSidebar;
