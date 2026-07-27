import { redirect } from "next/navigation";

import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";

import { MysteryClient, type CampaignItem, type ProspectItem, type ShopperSessionItem } from "./_client";

export const dynamic = "force-dynamic";

export default async function MysteryPage() {
  const user = await loadAuthUser();
  if (!user) redirect("/login");
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        Você não tem nenhuma organização ativa.
      </div>
    );
  }

  const isAdmin = user.is_platform_admin || ROLE_RANK[activeOrg.role] >= ROLE_RANK.admin;
  if (!isAdmin) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-text-muted">
        O módulo Cliente Oculto é restrito a administradores.
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: sessions }, { data: campaigns }] = await Promise.all([
    supabase
      .from("channel_sessions")
      .select("id, display_name, phone_number, status")
      .eq("organization_id", activeOrg.orgId)
      .eq("purpose", "mystery_shopper")
      .order("created_at", { ascending: true }),
    supabase
      .from("mystery_shopper_campaigns")
      .select("id, target_number, target_name, recipient_number, status, outcome, started_at, ended_at, message_count, report_storage_path, transcript_storage_path, stage, city, state, metrics, insight")
      .eq("organization_id", activeOrg.orgId)
      .order("started_at", { ascending: false })
      .limit(200),
  ]);

  const shopperSessions: ShopperSessionItem[] = (sessions ?? []).map((s) => ({
    id: s.id,
    label: s.display_name || s.phone_number || "Número do oculto",
    status: s.status,
  }));

  const rows = campaigns ?? [];
  // Operacional: só auditorias ainda em andamento (o histórico vive no funil).
  const campaignItems: CampaignItem[] = rows
    .filter((c) => c.status === "running")
    .map((c) => ({
      id: c.id,
      targetNumber: c.target_number,
      targetName: c.target_name,
      recipientNumber: c.recipient_number,
      status: c.status,
      outcome: c.outcome,
      startedAt: c.started_at,
      endedAt: c.ended_at,
      messageCount: c.message_count,
      hasReport: !!c.report_storage_path,
      hasTranscript: !!c.transcript_storage_path,
    }));

  // Funil de prospecção: empresas já auditadas (stage != null).
  const prospects: ProspectItem[] = rows
    .filter((c) => !!c.stage)
    .map((c) => {
      const m = (c.metrics ?? {}) as { economy_percent?: number; avg_target_response_seconds?: number };
      return {
        id: c.id,
        targetName: c.target_name,
        targetNumber: c.target_number,
        city: c.city,
        state: c.state,
        stage: c.stage as string,
        outcome: c.outcome,
        economyPercent: typeof m.economy_percent === "number" ? m.economy_percent : null,
        avgResponseSeconds:
          typeof m.avg_target_response_seconds === "number" ? m.avg_target_response_seconds : null,
        endedAt: c.ended_at,
        hasReport: !!c.report_storage_path,
        hasTranscript: !!c.transcript_storage_path,
        insight: (c.insight as string | null) ?? null,
      };
    });

  return <MysteryClient sessions={shopperSessions} campaigns={campaignItems} prospects={prospects} />;
}
