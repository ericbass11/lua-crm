/**
 * Handler do event_log para o Cliente Oculto (Fase 2/3), consumido pelo
 * event-log-drain (1x/min):
 *   - mystery_shopper.reply_received → gera/envia a próxima fala do oculto
 *   - mystery_shopper.completed      → gera o laudo + transcrição e entrega (Fase 3)
 */
import type { EventHandler, EventRow, HandlerResult } from "@/lib/event-log/dispatcher";
import { respondToCampaign } from "@/lib/mystery/engine";
import { generateAndDeliverReport } from "@/lib/mystery/report";

export const mysteryResponderHandler: EventHandler = {
  key: "mystery-shopper-responder",
  events: ["mystery_shopper.reply_received"],
  async handle(row: EventRow): Promise<HandlerResult> {
    const campaignId = (row.payload?.campaign_id as string | undefined) ?? row.entity_id ?? null;
    if (!campaignId) {
      return { consumer_key: this.key, status: "skipped", detail: "no_campaign_id" };
    }
    try {
      await respondToCampaign(row.organization_id, campaignId);
      return { consumer_key: this.key, status: "ok" };
    } catch (err) {
      return {
        consumer_key: this.key,
        status: "error",
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

export const mysteryReportHandler: EventHandler = {
  key: "mystery-shopper-report",
  events: ["mystery_shopper.completed"],
  async handle(row: EventRow): Promise<HandlerResult> {
    const campaignId = (row.payload?.campaign_id as string | undefined) ?? row.entity_id ?? null;
    if (!campaignId) {
      return { consumer_key: this.key, status: "skipped", detail: "no_campaign_id" };
    }
    try {
      await generateAndDeliverReport(row.organization_id, campaignId);
      return { consumer_key: this.key, status: "ok" };
    } catch (err) {
      return {
        consumer_key: this.key,
        status: "error",
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
