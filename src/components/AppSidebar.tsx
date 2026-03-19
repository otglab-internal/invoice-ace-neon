import React from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { LayoutDashboard, FilePlus, CheckSquare, Settings, LogOut, FileText, LayoutTemplate, Wrench } from "lucide-react";

interface NavItem {
  to: string;
  label: string;
  icon: React.FC<{ className?: string }>;
  /** Permission key that must be truthy, or null for always-visible */
  permissionKey: string | null;
}

const navItems: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, permissionKey: null },
  { to: "/create-invoice", label: "Create Invoice", icon: FilePlus, permissionKey: "canCreateInvoice" },
  { to: "/templates", label: "Templates", icon: LayoutTemplate, permissionKey: "canManageTemplates" },
  { to: "/approvals", label: "Approvals", icon: CheckSquare, permissionKey: "canAccessApprovals" },
  { to: "/settings", label: "Settings", icon: Settings, permissionKey: "canAccessSettings" },
  { to: "/global-config", label: "Global Config", icon: Wrench, permissionKey: "canAccessGlobalConfig" },
];

const AppSidebar: React.FC = () => {
  const { user, logout, permissions } = useAuth();
  const navigate = useNavigate();

  const visibleNavItems = navItems.filter((item) => {
    if (!item.permissionKey) return true;
    return (permissions as any)[item.permissionKey] === true;
  });

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <aside className="fixed left-0 top-0 h-screen w-60 bg-sidebar flex flex-col border-r border-sidebar-border z-50">
      <div className="p-5 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <FileText className="w-6 h-6 text-sidebar-primary" />
          <span className="font-display font-bold text-lg text-sidebar-foreground">Invoice Center</span>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {visibleNavItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
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
