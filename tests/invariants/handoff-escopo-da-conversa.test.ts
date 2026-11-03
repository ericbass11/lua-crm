import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { isLeadInHandoff } from "@/lib/agent-engine/agent/human-handoff";
import { GOV_AGENT_A, GOV_ORG, GOV_SESSION, seedGov, sql } from "./gov-helpers";

if (!process.env.TEST_DB_CONTAINER) throw new Error("Use pnpm test:db para o banco efêmero.");
const pool = new pg.Pool({
  connectionString: `postgres://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? "54329"}/postgres`,
  max: 2,
});
const CONTACT = "ca281000-0000-4000-8000-000000000001";
const OTHER_CONTACT = "ca281000-0000-4000-8000-000000000002";
const CURRENT = "ca281000-0000-4000-8000-000000000003";
const HISTORICAL = "ca281000-0000-4000-8000-000000000004";
const OTHER_SESSION = "ca281000-0000-4000-8000-000000000005";
const UNKNOWN = "ca281000-0000-4000-8000-000000000099";

beforeAll(() => {
  seedGov();
  sql(`
    insert into contacts (id, organization_id, display_name) values
      ('${CONTACT}', '${GOV_ORG}', 'Contato do escopo'), ('${OTHER_CONTACT}', '${GOV_ORG}', 'Outro contato');
    insert into channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
      values ('${OTHER_SESSION}', '${GOV_ORG}', 'handoff-scope-other-channel', '\\x00'::bytea);
    insert into conversations (id, organization_id, contact_id, channel_session_id, status) values
      ('${CURRENT}', '${GOV_ORG}', '${CONTACT}', '${GOV_SESSION}', 'open'),
      ('${HISTORICAL}', '${GOV_ORG}', '${CONTACT}', '${OTHER_SESSION}', 'open');
  `);
});
beforeEach(async () => {
  await pool.query("update contacts set force_human=false where organization_id=$1 and id=$2", [
    GOV_ORG,
    CONTACT,
  ]);
  await pool.query(
    `update conversations set bot_silenced_until=null, assigned_to_user_id=null,
    assignee_kind=null, status='open' where organization_id=$1 and id=any($2::uuid[])`,
    [GOV_ORG, [CURRENT, HISTORICAL]],
  );
});
afterAll(async () => pool.end());

describe("handoff consulta o SQL real por conversa e preserva o comando humano", () => {
  it.each(["claimed", "closed"])(
    "silêncio infinito em outra conversa %s não suspende a atual",
    async (status) => {
      await pool.query(
        `update conversations set status=$3, bot_silenced_until='infinity',
      assignee_kind='user', assigned_to_user_id=$4 where organization_id=$1 and id=$2`,
        [GOV_ORG, HISTORICAL, status, GOV_AGENT_A],
      );
      expect(await isLeadInHandoff(pool, GOV_ORG, CONTACT, CURRENT)).toBe(false);
    },
  );
  it("silêncio da conversa atual bloqueia; silêncio expirado libera", async () => {
    await pool.query(
      `update conversations set bot_silenced_until=now()+interval '1 hour' where organization_id=$1 and id=$2`,
      [GOV_ORG, CURRENT],
    );
    expect(await isLeadInHandoff(pool, GOV_ORG, CONTACT, CURRENT)).toBe(true);
    await pool.query(
      `update conversations set bot_silenced_until=now()-interval '1 hour' where organization_id=$1 and id=$2`,
      [GOV_ORG, CURRENT],
    );
    expect(await isLeadInHandoff(pool, GOV_ORG, CONTACT, CURRENT)).toBe(false);
  });
  it.each([null, "user"])(
    "atribuição atual não substitui a pausa explícita (tipo=%s)",
    async (kind) => {
      await pool.query(
        `update conversations set assignee_kind=$4, assigned_to_user_id=$3
      where organization_id=$1 and id=$2`,
        [GOV_ORG, CURRENT, GOV_AGENT_A, kind],
      );
      expect(await isLeadInHandoff(pool, GOV_ORG, CONTACT, CURRENT)).toBe(false);
      await pool.query(
        `update conversations set bot_silenced_until='infinity' where organization_id=$1 and id=$2`,
        [GOV_ORG, CURRENT],
      );
      expect(await isLeadInHandoff(pool, GOV_ORG, CONTACT, CURRENT)).toBe(true);
    },
  );
  it("o banco recusa tipo humano sem um dono coerente", async () => {
    await expect(
      pool.query(
        `update conversations set assignee_kind='user' where organization_id=$1 and id=$2`,
        [GOV_ORG, CURRENT],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "conversations_assignee_kind_coherence",
    });
    expect(await isLeadInHandoff(pool, GOV_ORG, CONTACT, CURRENT)).toBe(false);
  });
  it("force_human explícito no contato permanece global", async () => {
    await pool.query("update contacts set force_human=true where organization_id=$1 and id=$2", [
      GOV_ORG,
      CONTACT,
    ]);
    expect(await isLeadInHandoff(pool, GOV_ORG, CONTACT, CURRENT)).toBe(true);
    expect(await isLeadInHandoff(pool, GOV_ORG, CONTACT, HISTORICAL)).toBe(true);
  });
  it.each([
    [UNKNOWN, CONTACT, CURRENT],
    [GOV_ORG, OTHER_CONTACT, CURRENT],
    [GOV_ORG, CONTACT, UNKNOWN],
    [GOV_ORG, CONTACT, ""],
  ])(
    "alvo ausente ou divergente falha fechado (%s / %s / %s)",
    async (org, contact, conversation) => {
      expect(await isLeadInHandoff(pool, org, contact, conversation)).toBe(true);
    },
  );
});
