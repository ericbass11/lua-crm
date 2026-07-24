"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { audit } from "@/lib/audit";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { startCampaign } from "@/lib/mystery/engine";

// Local (não exportado): arquivo "use server" só pode exportar funções async.
const startCampaignSchema = z.object({
  shopper_session_id: z.string().uuid(),
  target_number: z.string().trim().min(6).max(30),
  target_name: z.string().trim().max(120).optional(),
  recipient_number: z.string().trim().min(6).max(30),
  persona_name: z.string().trim().min(2).max(80),
  persona_goal: z.string().trim().min(3).max(120),
  persona_backstory: z.string().trim().max(500).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(2).optional(),
});
type StartCampaignFormInput = z.infer<typeof startCampaignSchema>;

export type StartCampaignActionResult =
  | { ok: true; campaignId: string }
  | { ok: false; error: string };

export async function startMysteryCampaign(
  input: StartCampaignFormInput,
): Promise<StartCampaignActionResult> {
  const parsed = startCampaignSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "validation_failed" };
  }

  const authUser = await loadAuthUser();
  if (!authUser) return { ok: false, error: "unauthenticated" };
  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return { ok: false, error: "forbidden_tenant" };
  if (!authUser.is_platform_admin && ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    return { ok: false, error: "forbidden_role" };
  }

  const res = await startCampaign({
    organizationId: activeOrg.orgId,
    shopperSessionId: parsed.data.shopper_session_id,
    targetNumber: parsed.data.target_number,
    targetName: parsed.data.target_name,
    recipientNumber: parsed.data.recipient_number,
    persona: {
      name: parsed.data.persona_name,
      goal: parsed.data.persona_goal,
      backstory: parsed.data.persona_backstory,
    },
    city: parsed.data.city,
    state: parsed.data.state,
    createdBy: authUser.id,
  });

  if (!res.ok || !res.campaignId) {
    return { ok: false, error: res.error ?? "start_failed" };
  }

  const hdrs = await headers();
  await audit({
    action: "mystery_shopper.started",
    actorUserId: authUser.id,
    organizationId: activeOrg.orgId,
    resourceType: "mystery_shopper_campaign",
    resourceId: res.campaignId,
    requestId: hdrs.get("x-request-id"),
    metadata: { target: parsed.data.target_number, persona: parsed.data.persona_name },
  });

  revalidatePath("/app/mystery");
  return { ok: true, campaignId: res.campaignId };
}
