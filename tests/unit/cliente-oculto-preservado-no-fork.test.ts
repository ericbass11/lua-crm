import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();
const ler = (arquivo: string): string => readFileSync(join(RAIZ, arquivo), "utf8");

const MIGRATIONS = [
  "supabase/migrations/20260722130000_0909_mystery_shopper.sql",
  "supabase/migrations/20260722160000_0910_mystery_reports_bucket.sql",
  "supabase/migrations/20260724130000_0911_mystery_target_chat_id.sql",
  "supabase/migrations/20260724150000_0912_mystery_multi_per_session.sql",
  "supabase/migrations/20260724170000_0913_mystery_crm.sql",
  "supabase/migrations/20260724190000_0914_mystery_insight.sql",
] as const;

describe("Cliente Oculto permanece conectado no fork LUA CRM", () => {
  it("mantém a rota de UI e sua porta na navegação", () => {
    const pagina = ler("app/app/mystery/page.tsx");
    const cliente = ler("app/app/mystery/_client.tsx");
    const navegacao = ler("lib/navigation/catalogo.ts");

    expect(pagina).toContain("export default async function MysteryPage");
    expect(pagina).toContain("<MysteryClient");
    expect(cliente).toContain('purpose: "mystery_shopper"');
    expect(navegacao).toContain('href: "/app/mystery"');
    expect(navegacao).toContain('label: "Cliente Oculto"');
  });

  it("mantém o purpose do canal no contrato de entrada e no motor", () => {
    expect(ler("lib/schemas/channels.ts")).toContain(
      'purpose: z.enum(["inbound", "mystery_shopper"]).optional()',
    );
    expect(ler("lib/mystery/engine.ts")).toContain(
      'session.purpose !== "mystery_shopper"',
    );
  });

  it("mantém eventos, handlers e registro no dreno", () => {
    const handler = ler("workers/mystery-shopper.handler.ts");
    const registro = ler("lib/event-log/register-handlers.ts");
    const engine = ler("lib/mystery/engine.ts");

    expect(handler).toContain("export const mysteryResponderHandler");
    expect(handler).toContain('events: ["mystery_shopper.reply_received"]');
    expect(handler).toContain("export const mysteryReportHandler");
    expect(handler).toContain('events: ["mystery_shopper.completed"]');
    expect(registro).toContain("registerHandler(mysteryResponderHandler)");
    expect(registro).toContain("registerHandler(mysteryReportHandler)");
    expect(engine).toContain('p_event_type: "mystery_shopper.completed"');
  });

  it("mantém o desvio do inbound e os envios pelo WAHA", () => {
    const ingest = ler("lib/waha/ingest.ts");
    const engine = ler("lib/mystery/engine.ts");
    const report = ler("lib/mystery/report.ts");

    expect(ingest).toContain('session.purpose === "mystery_shopper"');
    expect(ingest).toContain("handleMysteryShopperInbound");
    expect(ingest).toContain('p_event_type: "mystery_shopper.reply_received"');
    expect(engine).toContain("getWahaClient()");
    expect(engine).toContain("waha.checkExists(");
    expect(engine).toContain("waha.sendMessage(");
    expect(report).toContain("waha.sendFile({");
  });

  it("mantém o módulo no baseline e sua cadeia de migrations", () => {
    const baseline = ler("supabase/baseline.sql");

    expect(baseline).toContain("purpose in ('inbound', 'mystery_shopper')");
    expect(baseline).toContain("create table if not exists public.mystery_shopper_campaigns");
    expect(baseline).toContain("create table if not exists public.mystery_shopper_messages");
    expect(baseline).toContain("'mystery-reports', 'mystery-reports'");

    for (const migration of MIGRATIONS) {
      expect(existsSync(join(RAIZ, migration)), `${migration} sumiu do fork`).toBe(true);
    }

    expect(ler(MIGRATIONS[0])).toContain("purpose in ('inbound', 'mystery_shopper')");
    expect(ler(MIGRATIONS[1])).toContain("mystery-reports");
    expect(ler(MIGRATIONS[2])).toContain("target_chat_id");
    expect(ler(MIGRATIONS[3])).toContain("uniq_mystery_active_session_target");
    expect(ler(MIGRATIONS[4])).toContain("mystery_campaigns_stage_check");
    expect(ler(MIGRATIONS[5])).toContain("insight");
  });
});
