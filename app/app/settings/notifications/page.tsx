import { requireAuth } from "@/lib/auth/server";
import { HandoffWebhookCard } from "./_components/HandoffWebhookCard";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  await requireAuth();
  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Notificações</h1>
        <p className="text-sm text-muted-foreground">
          Alertas de atendimento humano por WhatsApp e webhook.
        </p>
      </header>

      <HandoffWebhookCard />
    </div>
  );
}
