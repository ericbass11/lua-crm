/**
 * POST /api/v1/conversations/[id]/clear-history — apaga TODAS as mensagens da
 * conversa no CRM (admin). Zera preview/contadores; a conversa em si e os
 * registros de auditoria/execuções de IA são preservados (FKs de
 * ai_agent_runs/ai_invocations são ON DELETE SET NULL).
 *
 * Uso típico: recomeçar uma conversa de teste — a IA relê as últimas N
 * mensagens da conversa como contexto, então limpar o histórico zera também a
 * "memória" dela naquela thread. NÃO afeta o histórico no celular do cliente.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;

  // `requireRole()` é o ÚNICO lugar que aplica o gate de MFA (`mfaEmDivida`).
  // A comparação manual de ROLE_RANK que vivia aqui decidia 403 sem passar por
  // ele — uma sessão `aal1` de admin com TOTP cadastrado atravessava esta rota
  // sem provar o segundo fator. Achado do `lint:role-rank` (upstream v1.16.1).
  const authz = await requireRole("admin", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const { user: authUser, org: activeOrg } = authz;

  const admin = createAdminClient();

  // Confere que a conversa pertence à org ativa antes de qualquer delete.
  const { data: conv } = await admin
    .from("conversations")
    .select("id, organization_id")
    .eq("id", id)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();
  if (!conv) return fail("not_found", "Conversa não encontrada.", 404, { requestId });

  const { data: deleted, error: delErr } = await admin
    .from("messages")
    .delete()
    .eq("conversation_id", id)
    .eq("organization_id", activeOrg.orgId)
    .select("id");
  if (delErr) {
    return fail("internal_error", "Erro ao apagar mensagens.", 500, { requestId });
  }
  const deletedCount = deleted?.length ?? 0;

  // Recomeço de verdade: além das mensagens, zera silêncio de bot (handoff),
  // atribuição e status — a conversa volta ao estado de "nunca conversamos".
  await admin
    .from("conversations")
    .update({
      last_message_preview: null,
      unread_count_for_assignee: 0,
      bot_silenced_until: null,
      last_handoff_at: null,
      assigned_to_user_id: null,
      assigned_at: null,
      status: "open",
      status_changed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("organization_id", activeOrg.orgId);

  await audit({
    action: "conversation.history_cleared",
    actorUserId: authUser.id,
    organizationId: activeOrg.orgId,
    resourceType: "conversation",
    resourceId: id,
    requestId,
    metadata: { messages_deleted: deletedCount },
  });

  return ok({ cleared: true, messages_deleted: deletedCount }, { requestId });
}
