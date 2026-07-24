"use server";

import { revalidatePath } from "next/cache";

import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { generateInsight, askReports } from "@/lib/mystery/insight";

type AdminGate = { ok: true; orgId: string } | { ok: false; error: string };

async function requireAdmin(): Promise<AdminGate> {
  const authUser = await loadAuthUser();
  if (!authUser) return { ok: false, error: "unauthenticated" };
  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return { ok: false, error: "forbidden_tenant" };
  if (!authUser.is_platform_admin && ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    return { ok: false, error: "forbidden_role" };
  }
  return { ok: true, orgId: activeOrg.orgId };
}

export type InsightResult = { ok: true; insight: string } | { ok: false; error: string };

export async function regenerateMysteryInsight(campaignId: string): Promise<InsightResult> {
  if (!campaignId) return { ok: false, error: "invalid_request" };
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, error: auth.error };
  const insight = await generateInsight(auth.orgId, campaignId);
  if (!insight) return { ok: false, error: "insight_failed" };
  revalidatePath("/app/mystery");
  return { ok: true, insight };
}

export type AskResult = { ok: true; answer: string } | { ok: false; error: string };

export async function askMysteryReports(question: string): Promise<AskResult> {
  const q = (question ?? "").trim();
  if (q.length < 3) return { ok: false, error: "pergunta muito curta" };
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, error: auth.error };
  const answer = await askReports(auth.orgId, q);
  return { ok: true, answer };
}
