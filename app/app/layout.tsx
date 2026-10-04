"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { RoleProvider } from "@/components/app/RoleContext";
import { LifecycleProvider } from "@/components/app/LifecycleStore";
import { QRProvider } from "@/components/app/QRStore";
import { CertProvider } from "@/components/app/blockchain/CertificateStore";
import { RouteGuard } from "@/components/app/RouteGuard";
import { LangProvider } from "@/components/i18n/LangProvider";
import { AppSidebar } from "@/components/app/AppSidebar";
import { AppTopbar } from "@/components/app/AppTopbar";
import { PreviewBanner } from "@/components/app/PreviewBanner";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  return (
    <LangProvider>
    <RoleProvider>
      <LifecycleProvider>
        <QRProvider>
        <CertProvider>
        <div className="h-screen flex overflow-hidden bg-surface-ground">
        {/* Desktop sidebar */}
        <aside className="hidden lg:block w-72 shrink-0">
          <AppSidebar />
        </aside>

        {/* Mobile drawer */}
        {mobileOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
            <div className="absolute left-0 top-0 bottom-0 w-72">
              <AppSidebar onNavigate={() => setMobileOpen(false)} />
            </div>
          </div>
        )}

        {/* Main column */}
        <div className="flex-1 flex flex-col min-w-0">
          <PreviewBanner />
          <AppTopbar onMenu={() => setMobileOpen(true)} />
          <main className="flex-1 overflow-y-auto app-scroll">
            <div key={pathname} className="screen-enter"><RouteGuard>{children}</RouteGuard></div>
          </main>
        </div>
        </div>
        </CertProvider>
        </QRProvider>
      </LifecycleProvider>
    </RoleProvider>
    </LangProvider>
  );
}
