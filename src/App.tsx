import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import LoginPage from "@/pages/LoginPage";
import DashboardPage from "@/pages/DashboardPage";
import CreateInvoicePage from "@/pages/CreateInvoicePage";
import ApprovalsPage from "@/pages/ApprovalsPage";
import SettingsPage from "@/pages/SettingsPage";
import TemplatesPage from "@/pages/TemplatesPage";
import GlobalConfigPage from "@/pages/GlobalConfigPage";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

const AdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading, isAdmin } = useAuth();
  if (isLoading) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/" replace />;
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
            <Route path="/create-invoice" element={<ProtectedRoute><CreateInvoicePage /></ProtectedRoute>} />
            <Route path="/templates" element={<ProtectedRoute><TemplatesPage /></ProtectedRoute>} />
            <Route path="/approvals" element={<AdminRoute><ApprovalsPage /></AdminRoute>} />
            <Route path="/settings" element={<AdminRoute><SettingsPage /></AdminRoute>} />
            <Route path="/global-config" element={<AdminRoute><GlobalConfigPage /></AdminRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
