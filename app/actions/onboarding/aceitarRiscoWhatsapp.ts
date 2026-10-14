"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { habilitarPerfilManagedInbound } from "@/lib/channels/politica-inbound-only";
import {
  aceiteDoRiscoWhatsappSchema,
  RISCO_WHATSAPP_VERSAO,
} from "@/lib/onboarding/risco-whatsapp";
import { createAdminClient } from "@/lib/supabase/admin";
import { OnboardingError, patchOnboardingState, requireOnboardingCtx } from "./_shared";

export type AceitarRiscoWhatsappResult =
  | { ok: true }
  | {
      ok: false;
      error: "auth_required" | "no_active_org" | "forbidden" | "invalid_input" | "db_error";
      details?: unknown;
    };

type AceitarRiscoWhatsappError = Extract<AceitarRiscoWhatsappResult, { ok: false }>["error"];

export async function aceitarRiscoWhatsapp(
  formData: FormData,
): Promise<AceitarRiscoWhatsappResult> {
  let ctx;
  try {
    ctx = await requireOnboardingCtx();
  } catch (err) {
    if (err instanceof OnboardingError) {
      return { ok: false, error: err.code as AceitarRiscoWhatsappError };
    }
    throw err;
  }
  if (ctx.role !== "admin") return { ok: false, error: "forbidden" };

  let input;
  try {
    input = aceiteDoRiscoWhatsappSchema.parse({
      accepted: formData.get("accepted") === "true",
      version: String(formData.get("version") ?? ""),
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return { ok: false, error: "invalid_input", details: err.flatten() };
    }
    throw err;
  }

  const acceptedAt = new Date().toISOString();
  try {
    const admin = createAdminClient();
    const { data: organization, error: readError } = await admin
      .from("organizations")
      .select("settings")
      .eq("id", ctx.orgId)
      .maybeSingle();
    if (readError || !organization) {
      return {
        ok: false,
        error: "db_error",
        details: readError?.message ?? "organization_not_found",
      };
    }
    const { error: profileError } = await admin
      .from("organizations")
      .update({ settings: habilitarPerfilManagedInbound(organization.settings) })
      .eq("id", ctx.orgId);
    if (profileError) return { ok: false, error: "db_error", details: profileError.message };

    await patchOnboardingState(ctx.orgId, {
      risco_whatsapp: { accepted_at: acceptedAt, version: input.version },
    });
  } catch (err) {
    if (err instanceof OnboardingError) {
      return { ok: false, error: "db_error", details: err.message };
    }
    throw err;
  }

  await audit({
    action: "onboarding.whatsapp_risk_accepted",
    actorUserId: ctx.userId,
    organizationId: ctx.orgId,
    resourceType: "organization",
    resourceId: ctx.orgId,
    metadata: { version: RISCO_WHATSAPP_VERSAO },
  });

  redirect("/onboarding");
}
