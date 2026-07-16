/**
 * GET /api/v1/cron/followup-dispatcher
 *
 * Roda a sequência de follow-up automático por inatividade (ver
 * lib/followup/dispatcher.ts). Agendado 1/min pelo scheduler do compose.
 *
 * Auth: Bearer INTERNAL_CRON_SECRET (fallback INTERNAL_SECRET), fail-closed —
 * mesmo padrão dos demais crons.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { env } from "@/lib/env";
import { runFollowupDispatcher } from "@/lib/followup/dispatcher";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const accepted = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  if (accepted.length === 0 || !provided || !accepted.includes(provided)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const stats = await runFollowupDispatcher();
  return ok(stats, { requestId });
}
