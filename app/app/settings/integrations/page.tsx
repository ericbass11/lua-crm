import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { GoogleCalendarClient, type CalendarIntegrationSafeRow } from "./_components/GoogleCalendarClient";

export const dynamic = "force-dynamic";

const SAFE_COLUMNS =
  "id, organization_id, provider, label, calendar_id, service_account_email, timezone, slot_minutes, business_hours, is_active, validated_at, validation_error, created_by, created_at, updated_at";

export default async function IntegrationsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) redirect("/403");

  const supabase = await createClient();
  const { data } = await supabase
    .from("calendar_integrations_safe")
    .select(SAFE_COLUMNS)
    .eq("organization_id", activeOrg.orgId)
    .order("created_at", { ascending: false });

  const integrations = (data ?? []) as unknown as CalendarIntegrationSafeRow[];

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Integrações</h1>
        <p className="text-sm text-muted-foreground">
          Conecte a agenda da empresa para os agentes de IA marcarem calls
          (ferramentas <code>crm_check_availability</code> e <code>crm_schedule_meeting</code>).
        </p>
      </header>
      <GoogleCalendarClient initialData={integrations} />
    </div>
  );
}
