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
      {/*
        `min-w-0` é o que permite a coluna de conteúdo ENCOLHER. Um flex item
        nasce com `min-width: auto`, ou seja, nunca fica menor que o conteúdo —
        então qualquer bloco largo (uma fila de abas, uma tabela) empurrava a
        PÁGINA INTEIRA para o lado em vez de rolar dentro da própria caixa, e o
        conteúdo sumia sem nada indicando que existia.

        Medido em 390x844 no detalhe do agente, que tem seis abas: a página
        estourava 476px na horizontal; com esta classe, 212px — o que sobra é o
        cabeçalho, presente também em telas que não têm abas (a lista de agentes
        estoura 236px). Isolado ancestral por ancestral: é este o que decide.
      */}
      <div className={cn("flex min-h-screen min-w-0 flex-1 flex-col transition-[margin] duration-200", sidebarCollapsed ? "ml-16" : "ml-60")}>
        <TopBar />
        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
