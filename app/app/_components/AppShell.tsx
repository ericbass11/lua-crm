"use client";
import type { ReactNode } from "react";
import { Sidebar } from "@/components/shell/Sidebar";
import { TopBar } from "@/components/shell/TopBar";
import { cn } from "@/lib/utils";

interface AppShellProps {
  sidebarCollapsed: boolean;
  children: ReactNode;
}

export function AppShell({ sidebarCollapsed, children }: AppShellProps) {
  return (
    // h-dvh + overflow-hidden: a janela nunca rola; o scroll vive DENTRO do
    // <main> (páginas normais) ou dos painéis internos (inbox). Responsivo a
    // qualquer altura de tela, sem barra de rolagem na página.
    <div className="flex h-dvh w-full overflow-hidden bg-background">
      <Sidebar collapsed={sidebarCollapsed} />
      <div className={cn("flex h-dvh min-w-0 flex-1 flex-col transition-[margin] duration-200", sidebarCollapsed ? "ml-16" : "ml-60")}>
        <TopBar />
        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
