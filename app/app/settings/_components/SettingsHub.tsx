"use client";
import Link from "next/link";
import { useState } from "react";

import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePermission } from "@/hooks/auth/AuthProvider";

type Gate = "admin" | "manager" | "lgpd" | "none";

interface Item {
  href: string;
  title: string;
  description: string;
  gate: Gate;
}

interface Group {
  key: string;
  label: string;
  items: Item[];
}

// Agrupamentos lógicos das configurações. "Credenciais de IA" e "LGPD" foram
// trazidos da barra lateral para cá (grupos IA & Automação e Conformidade).
const GROUPS: Group[] = [
  {
    key: "conta",
    label: "Conta",
    items: [
      { href: "/app/settings/profile", title: "Perfil", description: "Nome, idioma, fuso, avatar.", gate: "none" },
      { href: "/app/settings/security", title: "Segurança", description: "MFA, códigos de recuperação, sessões.", gate: "none" },
      { href: "/app/settings/notifications", title: "Notificações", description: "Canais e categorias.", gate: "none" },
    ],
  },
  {
    key: "organizacao",
    label: "Organização",
    items: [
      { href: "/app/settings/tenant", title: "Dados da organização", description: "Empresa, retenção, DPO.", gate: "admin" },
      { href: "/app/settings/tenant/pipelines", title: "Pipelines", description: "Vocabulário, campos, critérios de IA por etapa.", gate: "admin" },
      { href: "/app/settings/tags", title: "Tags de conversa", description: "Catálogo de tags que a IA aplica.", gate: "manager" },
      { href: "/app/settings/billing", title: "Billing", description: "Planos e cobrança.", gate: "none" },
    ],
  },
  {
    key: "ia",
    label: "IA & Automação",
    items: [
      { href: "/app/ai/credentials", title: "Credenciais de IA", description: "Chaves BYO por provedor (Anthropic, OpenAI, Google).", gate: "manager" },
      { href: "/app/ai/knowledge/sources", title: "Base de conhecimento", description: "Documentos/FAQ que a IA usa para responder (RAG).", gate: "manager" },
      { href: "/app/settings/followup", title: "Follow-up automático", description: "Sequência de reengajamento por inatividade.", gate: "admin" },
    ],
  },
  {
    key: "canais",
    label: "Canais & Integrações",
    items: [
      { href: "/app/connections", title: "Conexões WhatsApp", description: "Saúde, reconexão e novos números.", gate: "admin" },
      { href: "/app/settings/integrations", title: "Google Calendar", description: "Agenda para a IA marcar calls.", gate: "admin" },
    ],
  },
  {
    key: "conformidade",
    label: "Conformidade & Segurança",
    items: [
      { href: "/app/lgpd/requests", title: "LGPD", description: "Solicitações de dados, anonimização, exportação.", gate: "lgpd" },
      { href: "/app/settings/api-tokens", title: "API Tokens", description: "Tokens server-to-server.", gate: "admin" },
      { href: "/app/audit", title: "Audit Log", description: "Histórico de ações.", gate: "manager" },
    ],
  },
];

export function SettingsHub() {
  const [tab, setTab] = useState<string>("conta");
  const isAdmin = usePermission("settings.write");
  const isManager = usePermission("audit.view");
  const canLgpd = usePermission("lgpd.execute_redact");

  const allowed = (gate: Gate) =>
    gate === "none" ? true : gate === "admin" ? isAdmin : gate === "manager" ? isManager : canLgpd;

  // Só mostra grupos que têm ao menos um item visível para o papel do usuário.
  const visibleGroups = GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => allowed(i.gate)),
  })).filter((g) => g.items.length > 0);

  return (
    <Tabs value={tab} onValueChange={setTab} className="flex flex-col gap-5">
      <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
        {visibleGroups.map((g) => (
          <TabsTrigger key={g.key} value={g.key} className="text-sm">
            {g.label}
          </TabsTrigger>
        ))}
      </TabsList>

      {visibleGroups
        .filter((g) => g.key === tab)
        .map((g) => (
          <div key={g.key} className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {g.items.map((item) => (
              <Link key={item.href} href={item.href} className="block">
                <Card className="h-full p-5 transition-colors hover:border-border-strong hover:shadow-md">
                  <h2 className="text-sm font-bold tracking-tight">{item.title}</h2>
                  <p className="mt-1.5 text-xs text-text-muted">{item.description}</p>
                </Card>
              </Link>
            ))}
          </div>
        ))}
    </Tabs>
  );
}
