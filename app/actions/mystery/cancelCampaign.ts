"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { audit } from "@/lib/audit";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";

export type CancelCampaignResult = { ok: true } | { ok: false; error: string };

export async function cancelMysteryCampaign(campaignId: string): Promise<CancelCampaignResult> {
  if (!campaignId || typeof campaignId !== "string") return { ok: false, error: "invalid_request" };

  const authUser = await loadAuthUser();
  if (!authUser) return { ok: false, error: "unauthenticated" };
  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return { ok: false, error: "forbidden_tenant" };
  if (!authUser.is_platform_admin && ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    return { ok: false, error: "forbidden_role" };
  }

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("mystery_shopper_campaigns")
    .update({ status: "cancelled", outcome: "cancelled_by_user", ended_at: new Date().toISOString() })
    .eq("id", campaignId)
    .eq("organization_id", activeOrg.orgId)
    .eq("status", "running")
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!updated) return { ok: false, error: "not_running" };

  const hdrs = await headers();
  await audit({
    action: "mystery_shopper.cancelled",
    actorUserId: authUser.id,
    organizationId: activeOrg.orgId,
    resourceType: "mystery_shopper_campaign",
    resourceId: campaignId,
    requestId: hdrs.get("x-request-id"),
  });

  revalidatePath("/app/mystery");
  return { ok: true };
}
