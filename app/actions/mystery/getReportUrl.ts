"use server";

import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type GetReportUrlResult = { ok: true; url: string } | { ok: false; error: string };

/** URL assinada (30 min) do laudo ou transcrição de uma campanha. Admin-only. */
export async function getMysteryReportUrl(
  campaignId: string,
  which: "report" | "transcript",
): Promise<GetReportUrlResult> {
  const authUser = await loadAuthUser();
  if (!authUser) return { ok: false, error: "unauthenticated" };
  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return { ok: false, error: "forbidden_tenant" };
  if (!authUser.is_platform_admin && ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    return { ok: false, error: "forbidden_role" };
  }

  const supabase = await createClient();
  const { data: campaign } = await supabase
    .from("mystery_shopper_campaigns")
    .select("report_storage_path, transcript_storage_path")
    .eq("id", campaignId)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();
  if (!campaign) return { ok: false, error: "not_found" };

  const path =
    which === "report"
      ? (campaign.report_storage_path as string | null)
      : (campaign.transcript_storage_path as string | null);
  if (!path) return { ok: false, error: "not_ready" };

  const admin = createAdminClient();
  const { data, error } = await admin.storage.from("mystery-reports").createSignedUrl(path, 30 * 60);
  if (error || !data?.signedUrl) return { ok: false, error: error?.message ?? "sign_failed" };
  return { ok: true, url: data.signedUrl };
}
