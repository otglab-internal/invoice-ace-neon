import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import type { Permissions } from "@/lib/permissions";
import LoginPage from "@/pages/LoginPage";
import DashboardPage from "@/pages/DashboardPage";
import CreateInvoicePage from "@/pages/CreateInvoicePage";
import ApprovalsPage from "@/pages/ApprovalsPage";
import SettingsPage from "@/pages/SettingsPage";
import TemplatesPage from "@/pages/TemplatesPage";
import GlobalConfigPage from "@/pages/GlobalConfigPage";
import AllStaffPage from "@/pages/AllStaffPage";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

/** Route guard that checks a specific permission flag. */
const PermissionRoute: React.FC<{ permissionKey: keyof Permissions; children: React.ReactNode }> = ({ permissionKey, children }) => {
  const { isAuthenticated, isLoading, permissions } = useAuth();
  if (isLoading) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!permissions[permissionKey]) return <Navigate to="/" replace />;
  return <>{children}</>;
};

const PublicRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return null;
  if (isAuthenticated) return <Navigate to="/" replace />;
  return <>{children}</>;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<PublicRoute><LoginPage environment="production" /></PublicRoute>} />
            <Route path="/sandbox-login" element={<PublicRoute><LoginPage environment="sandbox" /></PublicRoute>} />
            <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
            <Route path="/create-invoice" element={<PermissionRoute permissionKey="canCreateInvoice"><CreateInvoicePage /></PermissionRoute>} />
            <Route path="/templates" element={<PermissionRoute permissionKey="canManageTemplates"><TemplatesPage /></PermissionRoute>} />
            <Route path="/approvals" element={<PermissionRoute permissionKey="canAccessApprovals"><ApprovalsPage /></PermissionRoute>} />
            <Route path="/settings" element={<PermissionRoute permissionKey="canAccessSettings"><SettingsPage /></PermissionRoute>} />
            <Route path="/global-config" element={<PermissionRoute permissionKey="canAccessGlobalConfig"><GlobalConfigPage /></PermissionRoute>} />
            <Route path="/all-staff" element={<PermissionRoute permissionKey="canAccessAllStaff"><AllStaffPage /></PermissionRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
