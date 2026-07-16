/**
 * GET /api/v1/contacts/[id]/crm-context — dados de CRM do contato para o
 * painel do inbox (leads c/ campos+etapa, pedidos, atividades).
 *
 * Por quê via API: o cookie de auth é HttpOnly, então o supabase-js do browser
 * não autentica no PostgREST → RLS devolve vazio (o painel mostrava sempre
 * "Sem leads"). O servidor lê o cookie e filtra por org explicitamente.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";

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
  if (!activeOrg) return fail("forbidden_tenant", "Sem organização ativa.", 403, { requestId });

  const admin = createAdminClient();
  const orgId = activeOrg.orgId;

  const [leadsRes, ordersRes, actsRes] = await Promise.all([
    admin
      .from("crm_leads")
      .select("id, title, status, value_cents, currency, updated_at, custom_fields, crm_stages:stage_id(name)")
      .eq("organization_id", orgId)
      .eq("contact_id", id)
      .order("updated_at", { ascending: false })
      .limit(3),
    admin
      .from("orders")
      .select("id, external_id, status, total_cents, currency, created_at")
      .eq("organization_id", orgId)
      .eq("contact_id", id)
      .order("created_at", { ascending: false })
      .limit(3),
    admin
      .from("crm_lead_activities")
      .select("id, type, source_module, performed_at, payload")
      .eq("organization_id", orgId)
      .eq("contact_id", id)
      .order("performed_at", { ascending: false })
      .limit(5),
  ]);

  return ok(
    {
      leads: leadsRes.data ?? [],
      orders: ordersRes.data ?? [],
      activities: actsRes.data ?? [],
    },
    { requestId },
  );
}
