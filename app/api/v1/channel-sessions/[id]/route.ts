/**
 * GET /api/v1/channel-sessions/[id] — health check AO VIVO de um canal.
 *
 * Consulta o status real no WAHA, grava `last_health_check_at` (+ sincroniza
 * `status`) no DB e devolve o estado atual. É a fonte de verdade quando o
 * usuário abre a Central de Conexões ou está aguardando o QR ser escaneado.
 *
 * Qualquer membro da org pode consultar. organization_id vem da sessão.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { isChannelStatus } from "@/lib/schemas/channels";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getWahaClient } from "@/lib/waha/client";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await params;

  const user = await loadAuthUser();
  if (!user) return fail("unauthenticated", "Auth required.", 401, { requestId });
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) return fail("forbidden_tenant", "Nenhuma organização ativa.", 403, { requestId });

  const supabase = await createClient();
  const { data: session } = await supabase
    .from("channel_sessions")
    .select("id, waha_session_name, display_name, phone_number, status")
    .eq("organization_id", activeOrg.orgId)
    .eq("id", id)
    .maybeSingle();
  if (!session) return fail("not_found", "Canal não encontrado.", 404, { requestId });

  const waha = getWahaClient();
  if (!waha) {
    // Sem WAHA ativo: devolve o que está no DB, sinalizando que não deu p/ checar ao vivo.
    return ok({ ...session, waha_configured: false }, { requestId });
  }

  let liveStatus = session.status as string;
  let phoneNumber = session.phone_number as string | null;
  try {
    const remote = (await waha.getSessionQr(session.waha_session_name)) as {
      status?: string;
      me?: { id?: string; pushName?: string };
    };
    if (remote.status) liveStatus = remote.status;
    // WAHA expõe o número (JID `<phone>@c.us`) quando a sessão está WORKING.
    const jid = remote.me?.id;
    if (jid && !phoneNumber) phoneNumber = jid.replace(/@.*/, "");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    // 404 no WAHA = sessão não iniciada lá → considera STOPPED.
    if (msg.includes("404")) liveStatus = "STOPPED";
    // outros erros: mantém o status do DB (não sobrescreve com ruído transitório).
  }

  // Sincroniza o DB: sempre carimba o health check; atualiza status/telefone só se válido.
  const patch: Record<string, unknown> = { last_health_check_at: new Date().toISOString() };
  if (isChannelStatus(liveStatus) && liveStatus !== session.status) {
    patch.status = liveStatus;
    patch.last_status_change_at = new Date().toISOString();
  }
  if (phoneNumber && phoneNumber !== session.phone_number) patch.phone_number = phoneNumber;
  await supabase.from("channel_sessions").update(patch).eq("organization_id", activeOrg.orgId).eq("id", id);

  return ok(
    {
      id: session.id,
      waha_session_name: session.waha_session_name,
      display_name: session.display_name,
      phone_number: phoneNumber,
      status: liveStatus,
      last_health_check_at: patch.last_health_check_at,
      waha_configured: true,
    },
    { requestId },
  );
}

/**
 * DELETE /api/v1/channel-sessions/[id] — exclui a conexão (admin).
 *
 * 1. Remove a sessão do WAHA (logout + delete no engine) — o número desconecta.
 * 2. Tenta apagar a linha no DB. Conversas/mensagens têm FK RESTRICT (histórico
 *    é sagrado — anti-pattern 7 do CLAUDE.md): se houver histórico, a linha
 *    fica como STOPPED e informamos que só desconectou.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await params;

  const user = await loadAuthUser();
  if (!user) return fail("unauthenticated", "Auth required.", 401, { requestId });
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) return fail("forbidden_tenant", "Nenhuma organização ativa.", 403, { requestId });
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    return fail("forbidden_role", "Permissão insuficiente. Requer role admin.", 403, { requestId });
  }

  const admin = createAdminClient();
  const { data: session } = await admin
    .from("channel_sessions")
    .select("id, waha_session_name, display_name, status")
    .eq("organization_id", activeOrg.orgId)
    .eq("id", id)
    .maybeSingle();
  if (!session) return fail("not_found", "Canal não encontrado.", 404, { requestId });

  // 1) Desconecta e remove do WAHA (tolerante a sessão inexistente).
  const waha = getWahaClient();
  if (waha) {
    try {
      await waha.deleteSession(session.waha_session_name as string);
    } catch (err) {
      return fail(
        "internal_error",
        `Falha ao remover a sessão do WhatsApp: ${err instanceof Error ? err.message : "erro"}`,
        502,
        { requestId },
      );
    }
  }

  // 2) Apaga a linha — ou preserva se houver histórico (FK RESTRICT).
  const { error: delErr } = await admin
    .from("channel_sessions")
    .delete()
    .eq("organization_id", activeOrg.orgId)
    .eq("id", id);

  let deleted = true;
  if (delErr) {
    if (delErr.code === "23503") {
      deleted = false;
      await admin
        .from("channel_sessions")
        .update({ status: "STOPPED", last_status_change_at: new Date().toISOString() })
        .eq("organization_id", activeOrg.orgId)
        .eq("id", id);
    } else {
      return fail("internal_error", "Erro ao excluir a conexão.", 500, { requestId });
    }
  }

  await audit({
    action: "channel.deleted",
    actorUserId: user.id,
    organizationId: activeOrg.orgId,
    resourceType: "channel_session",
    resourceId: id,
    requestId,
    metadata: { waha_session_name: session.waha_session_name, row_deleted: deleted },
  });

  return ok(
    {
      deleted,
      disconnected: true,
      message: deleted
        ? "Conexão excluída."
        : "Número desconectado do WhatsApp. O registro foi mantido como 'Parado' porque há conversas/mensagens vinculadas (o histórico é preservado).",
    },
    { requestId },
  );
}
