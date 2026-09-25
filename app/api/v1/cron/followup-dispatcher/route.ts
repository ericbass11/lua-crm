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
import { autorizaCron } from "@/lib/auth/cron-auth";
import { runFollowupDispatcher } from "@/lib/followup/dispatcher";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  if (!autorizaCron(req)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const stats = await runFollowupDispatcher();
  return ok(stats, { requestId });
}
