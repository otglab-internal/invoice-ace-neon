import React, { useState } from "react";
import AppSidebar from "@/components/AppSidebar";
import { useIsMobile } from "@/hooks/use-mobile";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

const AppLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  if (isMobile) {
    return (
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-40 flex items-center gap-3 border-b border-border bg-background px-4 py-3">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <button className="p-1.5 rounded-md hover:bg-accent">
                <Menu className="w-5 h-5" />
              </button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-60 bg-sidebar border-sidebar-border">
              <AppSidebar onNavigate={() => setOpen(false)} />
            </SheetContent>
          </Sheet>
          <span className="font-display font-bold text-lg">Invoice Center</span>
        </header>
        <main className="p-4 animate-fade-in">{children}</main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="fixed left-0 top-0 h-screen w-60 z-50">
        <AppSidebar />
      </div>
      <main className="ml-60 p-8 animate-fade-in">{children}</main>
    </div>
  );
};

export default AppLayout;
