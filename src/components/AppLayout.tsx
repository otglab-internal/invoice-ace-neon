import React from "react";
import AppSidebar from "@/components/AppSidebar";

const AppLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="min-h-screen bg-background">
      <AppSidebar />
      <main className="ml-60 p-8 animate-fade-in">
        {children}
      </main>
    </div>
  );
};

export default AppLayout;
