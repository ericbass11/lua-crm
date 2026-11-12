import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedGov, GOV_ORG, GOV_SESSION } from "./gov-helpers";

// Exclusivamente o Postgres efêmero do harness; nunca usa configuração de produção.
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/postgres`,
  max: 3,
});
beforeAll(() => seedGov());
afterAll(() => pool.end());

async function fixture() {
  const contact = randomUUID(),
    conversation = randomUUID();
  await pool.query("insert into contacts(id,organization_id,name) values($1,$2,'Conflito local')", [
    contact,
    GOV_ORG,
  ]);
  await pool.query(
    "insert into conversations(id,organization_id,contact_id,channel_session_id,status) values($1,$2,$3,$4,'open')",
    [conversation, GOV_ORG, contact, GOV_SESSION],
  );
  return { contact, conversation };
}
async function state(id: string) {
  return (await pool.query("select * from conversations where id=$1", [id])).rows[0];
}
async function transition(id: string, status: string, revision: number) {
  return (
    await pool.query("select * from fn_service_status($1,$2,$3,$4)", [
      GOV_ORG,
      id,
      status,
      revision,
    ])
  ).rows[0];
}

describe("fn_service_status — conflito de negócio sem serialização", () => {
  it("revisão obsoleta devolve PT409 e preserva integralmente a conversa", async () => {
    const { conversation } = await fixture();
    const before = await state(conversation);
    await expect(
      transition(conversation, "closed", Number(before.service_revision) + 1),
    ).rejects.toMatchObject({ code: "PT409", message: "service_stale" });
    expect(await state(conversation)).toEqual(before);
  });

  it.each(["closed", "archived"])(
    "%s mantém revisão e permite reabrir com a revisão atual",
    async (status) => {
      const { conversation } = await fixture();
      const before = await state(conversation);
      const closed = await transition(conversation, status, Number(before.service_revision));
      expect(closed.status).toBe(status);
      expect(Number(closed.service_revision)).toBe(Number(before.service_revision) + 1);
      expect(closed.service_closed_at).toBeInstanceOf(Date);
      const reopened = await transition(conversation, "open", Number(closed.service_revision));
      expect(reopened.status).toBe("open");
      expect(Number(reopened.service_revision)).toBe(Number(closed.service_revision) + 1);
      expect(reopened.current_demanda_id).toBeNull();
    },
  );

  it("organização forjada permanece P0002 sem modificar conversa de outro tenant", async () => {
    const { conversation } = await fixture();
    const before = await state(conversation);
    await expect(
      pool.query("select fn_service_status($1,$2,'closed',null)", [randomUUID(), conversation]),
    ).rejects.toMatchObject({ code: "P0002", message: "service_not_found" });
    expect(await state(conversation)).toEqual(before);
  });

  it("contato alterado enquanto aguarda mutex devolve PT409 sem fechar o atendimento", async () => {
    const { contact, conversation } = await fixture();
    const replacement = randomUUID();
    await pool.query(
      "insert into contacts(id,organization_id,name) values($1,$2,'Outro contato')",
      [replacement, GOV_ORG],
    );
    const blocker = await pool.connect();
    const caller = await pool.connect();
    let pending: Promise<unknown> | undefined;
    await blocker.query("begin");
    try {
      await blocker.query("select fn_service_lock($1,$2)", [GOV_ORG, contact]);
      const pid = (await caller.query("select pg_backend_pid() pid")).rows[0].pid;
      // Capture a rejeição imediatamente para nunca gerar unhandled rejection.
      pending = caller
        .query("select fn_service_status($1,$2,'closed',null)", [GOV_ORG, conversation])
        .then(
          () => null,
          (error: unknown) => error,
        );
      await expect
        .poll(
          async () =>
            (await pool.query("select wait_event from pg_stat_activity where pid=$1", [pid]))
              .rows[0]?.wait_event,
          { timeout: 5000 },
        )
        .toBe("advisory");
      await blocker.query("update conversations set contact_id=$1 where id=$2", [
        replacement,
        conversation,
      ]);
      const before = (
        await blocker.query("select * from conversations where id=$1", [conversation])
      ).rows[0];
      await blocker.query("commit");
      expect(await pending).toMatchObject({ code: "PT409", message: "service_contact_changed" });
      expect(await state(conversation)).toEqual(before);
    } finally {
      await blocker.query("rollback");
      if (pending) await pending;
      blocker.release();
      caller.release();
    }
  });

  it("anon e authenticated continuam sem execução, service_role mantém execução", async () => {
    const grants = (
      await pool.query(`select
      has_function_privilege('anon','public.fn_service_status(uuid,uuid,text,bigint)','execute') as anon,
      has_function_privilege('authenticated','public.fn_service_status(uuid,uuid,text,bigint)','execute') as authenticated,
      has_function_privilege('service_role','public.fn_service_status(uuid,uuid,text,bigint)','execute') as service_role`)
    ).rows[0];
    expect(grants).toEqual({ anon: false, authenticated: false, service_role: true });
  });

  it("reaplicar migration preserva identidade, ACL, owner, assinatura e atributos da função", async () => {
    const files = readdirSync("supabase/migrations").filter((name) => name.includes("_0926_"));
    expect(files).toHaveLength(1);
    const migration = readFileSync(`supabase/migrations/${files[0]}`, "utf8");
    const client = await pool.connect();
    const catalog = async () =>
      (
        await client.query(`select oid,proowner,proacl,prosecdef,proconfig,
      prorettype,proargtypes::text,proargnames,pronargdefaults,provolatile
      from pg_proc where oid='public.fn_service_status(uuid,uuid,text,bigint)'::regprocedure`)
      ).rows[0];
    await client.query("begin");
    try {
      // Um grant legítimo fora do padrão também deve sobreviver a CREATE OR REPLACE.
      await client.query("create role service_status_local_probe nologin");
      await client.query(
        "grant execute on function public.fn_service_status(uuid,uuid,text,bigint) to service_status_local_probe",
      );
      const before = await catalog();
      await client.query(migration);
      await client.query(migration);
      expect(await catalog()).toEqual(before);
    } finally {
      await client.query("rollback");
      client.release();
    }
  });
});
