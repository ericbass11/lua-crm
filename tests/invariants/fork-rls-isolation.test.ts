/**
 * ISOLAMENTO E PAPEL NAS TABELAS QUE SÓ EXISTEM NESTA INSTALAÇÃO (fork LUA CRM).
 *
 * Mesmo padrão de `rls-isolation.test.ts` — `set role authenticated` + JWT
 * simulado + contagem de linhas da OUTRA organização —, mas para as seis
 * tabelas que o upstream não tem e que, por isso, a varredura
 * `rls-completude-varredura.test.ts` encontrou sem prova comportamental:
 *
 *   calendar_integrations, followup_settings, notification_settings,
 *   tag_definitions, mystery_shopper_campaigns, mystery_shopper_messages
 *
 * Fica em arquivo próprio (e não em `TABLES` daquele teste) por dois motivos:
 * (1) o seed dessas tabelas é da fork — misturá-lo ao arquivo do upstream
 * cria conflito a cada sincronização; (2) além do isolamento, aqui se prova o
 * GATE DE PAPEL que a migration 0918 pôs nas policies: `agent` lê e não
 * escreve, `manager` escreve. O controle positivo por papel não caberia em
 * `rls-isolation.test.ts`, cujo usuário semeado é `agent` — o mesmo motivo
 * pelo qual `webhook_lead_captures` vive em arquivo próprio.
 *
 * Cada asserção tem controle positivo: sem ele, uma policy que negue TUDO
 * passa no teste de "não vê a outra org" e derruba a tela em produção.
 */
import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error(
    "TEST_DB_CONTAINER not set — run this suite via `pnpm test:db` (scripts/test-db.sh)",
  );
}
const containerName: string = container;

function sql(script: string, opts: { tolerateError?: boolean } = {}): string {
  try {
    return execFileSync(
      "docker",
      ["exec", "-i", containerName, "psql", "-U", "postgres", "-d", "postgres",
        "-v", "ON_ERROR_STOP=1", "-tA", "-f", "-"],
      { input: script, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
  } catch (err) {
    if (opts.tolerateError) {
      const e = err as { stderr?: string; stdout?: string };
      return `ERROR:${(e.stderr ?? "").trim()}\n${(e.stdout ?? "").trim()}`;
    }
    throw err;
  }
}

// UUIDs fixos: seed idempotente, e distintos dos de rls-isolation.test.ts.
const ORG_A = "f0a0aaaa-0000-4000-8000-00000000000a";
const ORG_B = "f0b0bbbb-0000-4000-8000-00000000000b";
const AGENT_A = "f0a0aaaa-1111-4000-8000-00000000000a";
const MANAGER_A = "f0a0aaaa-2222-4000-8000-00000000000a";
const AGENT_B = "f0b0bbbb-1111-4000-8000-00000000000b";
const SESS_A = "f0a0aaaa-3333-4000-8000-00000000000a";
const SESS_B = "f0b0bbbb-3333-4000-8000-00000000000b";
const CAMP_A = "f0a0aaaa-4444-4000-8000-00000000000a";
const CAMP_B = "f0b0bbbb-4444-4000-8000-00000000000b";

/** Executa como um usuário logado (mesmo mecanismo do PostgREST: role + claims). */
function asUser(userId: string, query: string, opts: { tolerateError?: boolean } = {}): string {
  return sql(
    `
    set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', false);
    ${query}
  `,
    opts,
  );
}

function countAs(userId: string, countQuery: string): number {
  const out = asUser(userId, countQuery);
  const last = out.split("\n").filter((l) => l.trim() !== "").at(-1) ?? "0";
  return Number(last);
}

function seedOrg(org: string, agent: string, sess: string, tag: string, manager?: string): string {
  // Sem PII real: e-mails e nomes sintéticos (LGPD).
  return `
    insert into auth.users (id, email) values ('${agent}', 'fork-rls-${tag}-agent@invariant.test')
      on conflict (id) do nothing;
    ${manager ? `insert into auth.users (id, email) values ('${manager}', 'fork-rls-${tag}-manager@invariant.test') on conflict (id) do nothing;` : ""}
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${org}', 'fork-rls-${tag}', 'Fork RLS ${tag}', 'Fork ${tag}')
      on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${agent}', '${org}', 'agent', now())
      on conflict do nothing;
    ${manager ? `insert into public.user_organizations (user_id, organization_id, role, accepted_at) values ('${manager}', '${org}', 'manager', now()) on conflict do nothing;` : ""}
    insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
      values ('${sess}', '${org}', 'fork-rls-${tag}', '\\x00'::bytea)
      on conflict (id) do nothing;
  `;
}

function seedTabelasDaFork(org: string, sess: string, camp: string, tag: string): string {
  return `
    insert into public.calendar_integrations (organization_id, service_account_email, sa_key_encrypted, sa_key_iv, sa_key_tag)
      values ('${org}', 'sa-${tag}@invariant.test', '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea)
      on conflict do nothing;
    insert into public.followup_settings (organization_id) values ('${org}') on conflict do nothing;
    insert into public.notification_settings (organization_id) values ('${org}') on conflict do nothing;
    insert into public.tag_definitions (organization_id, name) values ('${org}', 'tag-${tag}') on conflict do nothing;
    insert into public.mystery_shopper_campaigns (id, organization_id, shopper_session_id, target_number, recipient_number)
      values ('${camp}', '${org}', '${sess}', '+5511999990000', '+5511999990001')
      on conflict (id) do nothing;
    insert into public.mystery_shopper_messages (organization_id, campaign_id, direction)
      values ('${org}', '${camp}', 'shopper');
  `;
}

const TABELAS = [
  "calendar_integrations",
  "followup_settings",
  "notification_settings",
  "tag_definitions",
  "mystery_shopper_campaigns",
  "mystery_shopper_messages",
] as const;

beforeAll(() => {
  sql(
    seedOrg(ORG_A, AGENT_A, SESS_A, "a", MANAGER_A) +
      seedOrg(ORG_B, AGENT_B, SESS_B, "b") +
      seedTabelasDaFork(ORG_A, SESS_A, CAMP_A, "a") +
      seedTabelasDaFork(ORG_B, SESS_B, CAMP_B, "b"),
  );
});

describe("fork: isolamento entre organizações nas tabelas desta instalação", () => {
  it("seed sanity: as duas organizações realmente têm linhas (superusuário vê ambas)", () => {
    for (const t of TABELAS) {
      const total = Number(
        sql(`select count(distinct organization_id) from public.${t} where organization_id in ('${ORG_A}','${ORG_B}');`),
      );
      expect(total, `${t}: o seed não produziu linhas nas duas orgs`).toBe(2);
    }
  });

  for (const t of TABELAS) {
    it(`agent da org A lê 0 linhas da org B em ${t}`, () => {
      expect(countAs(AGENT_A, `select count(*) from public.${t} where organization_id = '${ORG_B}';`)).toBe(0);
    });
    it(`agent da org A ainda lê as próprias linhas em ${t} (controle positivo)`, () => {
      expect(
        countAs(AGENT_A, `select count(*) from public.${t} where organization_id = '${ORG_A}';`),
      ).toBeGreaterThanOrEqual(1);
    });
  }
});

describe("fork: o gate de papel da migration 0918 (agent lê, não escreve; manager escreve)", () => {
  it("agent NÃO cria tag na própria organização", () => {
    const out = asUser(
      AGENT_A,
      `insert into public.tag_definitions (organization_id, name) values ('${ORG_A}', 'tag-por-agent');`,
      { tolerateError: true },
    );
    expect(out, "a policy de escrita deveria barrar o agent").toMatch(/row-level security|ERROR/i);
    expect(Number(sql(`select count(*) from public.tag_definitions where name = 'tag-por-agent';`))).toBe(0);
  });

  it("agent NÃO altera a configuração de follow-up", () => {
    asUser(AGENT_A, `update public.followup_settings set enabled = true where organization_id = '${ORG_A}';`, {
      tolerateError: true,
    });
    // UPDATE barrado por RLS não erra: afeta 0 linhas. A prova é o estado.
    const enabled = sql(`select enabled from public.followup_settings where organization_id = '${ORG_A}';`);
    expect(enabled).toBe("f");
  });

  it("CONTROLE POSITIVO: manager cria tag na própria organização", () => {
    asUser(
      MANAGER_A,
      `insert into public.tag_definitions (organization_id, name) values ('${ORG_A}', 'tag-por-manager');`,
    );
    expect(Number(sql(`select count(*) from public.tag_definitions where name = 'tag-por-manager';`))).toBe(1);
  });

  it("CONTROLE POSITIVO: manager altera a configuração de follow-up", () => {
    asUser(MANAGER_A, `update public.followup_settings set enabled = true where organization_id = '${ORG_A}';`);
    expect(sql(`select enabled from public.followup_settings where organization_id = '${ORG_A}';`)).toBe("t");
  });

  it("manager NÃO escreve na OUTRA organização", () => {
    asUser(
      MANAGER_A,
      `insert into public.tag_definitions (organization_id, name) values ('${ORG_B}', 'tag-invasora');`,
      { tolerateError: true },
    );
    expect(Number(sql(`select count(*) from public.tag_definitions where name = 'tag-invasora';`))).toBe(0);
  });
});

describe("fork: nenhuma dessas tabelas é endereçável pela anon key", () => {
  it("has_table_privilege('anon', …, 'SELECT') é falso em todas", () => {
    const alcancaveis = sql(`
      select coalesce(string_agg(c.relname, ',' order by c.relname), '')
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r','v')
         and c.relname in (${[...TABELAS, "calendar_integrations_safe"].map((t) => `'${t}'`).join(",")})
         and has_table_privilege('anon', c.oid, 'SELECT');`);
    expect(alcancaveis).toBe("");
  });

  it("fn_audit_hash_chain() não é executável por authenticated nem anon", () => {
    const exec = sql(`
      select has_function_privilege('authenticated', 'public.fn_audit_hash_chain()', 'EXECUTE')::text
          || ',' || has_function_privilege('anon', 'public.fn_audit_hash_chain()', 'EXECUTE')::text;`);
    expect(exec).toBe("false,false");
  });
});
