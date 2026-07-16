/**
 * GET /api/v1/pipelines/[id] — pipeline da org ativa (id, name, vocabulary,
 * settings). Usado pelo modal do lead para renderizar os campos estratégicos
 * declarados (settings.fields). Qualquer membro da org.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";

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

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crm_pipelines")
    .select("id, name, slug, vocabulary, settings")
    .eq("id", id)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();
  if (error) return fail("internal_error", "Erro ao carregar pipeline.", 500, { requestId });
  if (!data) return fail("not_found", "Pipeline não encontrado.", 404, { requestId });
  return ok(data, { requestId });
}
