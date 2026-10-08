import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sql } from "./psql-transporte";

const baseline = readFileSync("supabase/baseline.sql", "utf8");
const guard = baseline.match(
  /DO \$pipeline_initial_scope\$[\s\S]*?END \$pipeline_initial_scope\$;/,
)?.[0];
if (!guard) throw new Error("Canonical pipeline introduction guard missing");
// Run the actual guard against transaction-owned fixture relations, never app rows.
const fixtureGuard = guard.replaceAll("public.", "pipeline_guard_fixture.");
const fixture = `begin;
  create schema pipeline_guard_fixture;
  create table pipeline_guard_fixture.ai_agent_versions(id uuid, agent_id uuid);
  create table pipeline_guard_fixture.crm_leads(id uuid,pipeline_id uuid);
  create table pipeline_guard_fixture.crm_lead_activities(lead_id uuid,actor_agent_id uuid);
  insert into pipeline_guard_fixture.ai_agent_versions values
    ('11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111'),
    ('22222222-2222-4222-8222-222222222222','22222222-2222-4222-8222-222222222222');
  insert into pipeline_guard_fixture.crm_leads values
    ('33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444');
  insert into pipeline_guard_fixture.crm_lead_activities values
    ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111');`;

function proofs(script: string): string[] {
  return sql(script)
    .split("\n")
    .filter((line) => line.startsWith("PROOF="));
}

describe("canonical pipeline backfill preserves explicitly closed permissions", () => {
  it("does not broaden existing empty scopes even with historical activity", () => {
    expect(
      proofs(`${fixture}
      alter table pipeline_guard_fixture.ai_agent_versions add column pipeline_ids uuid[] not null default '{}';
      ${fixtureGuard}
      select 'PROOF=' || count(*) from pipeline_guard_fixture.ai_agent_versions where pipeline_ids='{}';
      rollback;`),
    ).toEqual(["PROOF=2"]);
  });

  it("initializes historical scope once, then preserves an explicit closure on reapplication", () => {
    expect(
      proofs(`${fixture}
      ${fixtureGuard}
      select 'PROOF=' || count(*) from pipeline_guard_fixture.ai_agent_versions
        where pipeline_ids=array['44444444-4444-4444-8444-444444444444'::uuid];
      select 'PROOF=' || count(*) from pipeline_guard_fixture.ai_agent_versions where pipeline_ids='{}';
      update pipeline_guard_fixture.ai_agent_versions set pipeline_ids='{}';
      ${fixtureGuard}
      select 'PROOF=' || count(*) from pipeline_guard_fixture.ai_agent_versions where pipeline_ids='{}';
      rollback;`),
    ).toEqual(["PROOF=1", "PROOF=1", "PROOF=2"]);
  });
});
