import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const baseline = readFileSync("supabase/baseline.sql", "utf8");
const forward = readFileSync(
  "supabase/migrations/20261008123000_0925_pipeline_scope_backfill_only_on_introduction.sql",
  "utf8",
);
const historical = readFileSync(
  "supabase/migrations/20260807090000_0125_escopo_de_funil_do_agente.sql",
  "utf8",
);
const guard = /DO \$pipeline_initial_scope\$[\s\S]*?END \$pipeline_initial_scope\$;/;

describe("baseline update preserves an explicitly closed pipeline scope", () => {
  it("uses the forward guard at the original introduction, before the immutable trigger", () => {
    const start = baseline.indexOf("-- ---- escopo de funil do agente (migration 0125)");
    const end = baseline.indexOf("-- ---- o trigger de imutabilidade", start);
    const introduction = baseline.slice(start, end);
    expect(introduction.match(guard)?.[0]?.replaceAll("\r\n", "\n")).toBe(
      forward.match(guard)?.[0]?.replaceAll("\r\n", "\n"),
    );
    expect(introduction.match(guard)?.[0]).toBeTruthy();
    // No unconditional historical UPDATE may run before/after the guarded block.
    expect(introduction.replace(guard, "")).not.toMatch(/update\s+public\.ai_agent_versions/i);
    expect(introduction.replace(guard, "")).not.toMatch(
      /alter\s+table\s+public\.ai_agent_versions/i,
    );
  });

  it("documents the migration path without silently rewriting historical SQL", () => {
    expect(historical).toContain("add column if not exists pipeline_ids");
    expect(historical).not.toContain("pipeline_initial_scope");
    expect(forward).toContain("cannot undo any widening already committed");
  });
});
