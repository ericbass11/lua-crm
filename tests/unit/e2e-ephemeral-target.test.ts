import { describe, expect, it } from "vitest";
import {
  projectApiConfig,
  verifyEphemeralTarget,
  verifyFixtureEnvironment,
} from "../e2e/helpers/ephemeral-runtime";

function evidence(): Parameters<typeof verifyEphemeralTarget>[0] {
  const base = {
    State: { Running: true },
    Config: { Labels: { "com.supabase.cli.project": "lua-crm", "deskcomm.purpose": "e2e" } },
    NetworkSettings: {
      Networks: { isolated: { IPAddress: "172.20.0.2", Aliases: ["supabase_db_lua-crm"] } },
    },
  };
  return {
    project: "lua-crm",
    apiPort: 54321,
    supabaseUrl: "http://127.0.0.1:54321",
    appSupabaseUrl: "http://localhost:54321",
    databaseId: "db",
    ci: false,
    containers: [
      { ...base, Id: "db", Name: "/supabase_db_lua-crm" },
      {
        ...base,
        Id: "gateway",
        Name: "/supabase_kong_lua-crm",
        NetworkSettings: {
          ...base.NetworkSettings,
          Ports: { "8000/tcp": [{ HostIp: "127.0.0.1", HostPort: "54321" }] },
        },
      },
      {
        ...base,
        Id: "rest",
        Name: "/supabase_rest_lua-crm",
        Config: {
          ...base.Config,
          Env: ["PGRST_DB_URI=postgresql://placeholder@supabase_db_lua-crm:5432/postgres"],
        },
      },
    ],
  };
}
describe("E2E API target bound to actual ephemeral database", () => {
  it("refuses divergent runner credentials before accessing a fixture", () => {
    const file =
      "NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321\nSUPABASE_SERVICE_ROLE_KEY=ephemeral";
    expect(() =>
      verifyFixtureEnvironment(file, {
        NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
        SUPABASE_SERVICE_ROLE_KEY: "personal",
      }),
    ).toThrow(/credentials differ/);
    expect(() =>
      verifyFixtureEnvironment(file, {
        NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
        SUPABASE_SERVICE_ROLE_KEY: "ephemeral",
      }),
    ).not.toThrow();
  });
  it("parses this project API section without taking a DB port", () =>
    expect(projectApiConfig('project_id="lua-crm"\n[api]\nport=54321\n[db]\nport=54322')).toEqual({
      project: "lua-crm",
      apiPort: 54321,
    }));
  it("accepts correlated gateway, REST, DB and effective app config", () =>
    expect(() => verifyEphemeralTarget(evidence())).not.toThrow());
  it("refuses personal API while a valid ephemeral DB exists", () => {
    const e = evidence();
    e.supabaseUrl = "http://127.0.0.1:55321";
    expect(() => verifyEphemeralTarget(e)).toThrow(/port/);
  });
  it("refuses an app pointing to personal API", () => {
    const e = evidence();
    e.appSupabaseUrl = "http://localhost:55321";
    expect(() => verifyEphemeralTarget(e)).toThrow(/port/);
  });
  it("refuses gateway actual port mismatch", () => {
    const e = evidence();
    e.containers[1]!.NetworkSettings.Ports!["8000/tcp"]![0]!.HostPort = "55321";
    expect(() => verifyEphemeralTarget(e)).toThrow(/association/);
  });
  it("refuses disconnected DB network", () => {
    const e = evidence();
    e.containers[0]!.NetworkSettings.Networks = { other: { IPAddress: "172.21.0.2", Aliases: [] } };
    expect(() => verifyEphemeralTarget(e)).toThrow(/network/);
  });
  it("refuses REST pointing to a personal database", () => {
    const e = evidence();
    e.containers[2]!.Config.Env = [
      "PGRST_DB_URI=postgresql://placeholder@personal-db:5432/postgres",
    ];
    expect(() => verifyEphemeralTarget(e)).toThrow(/another database/);
  });
  it("allows direct bootstrap only through the verified database published port", () => {
    const e = evidence();
    e.directDatabaseUrl = "postgresql://postgres:synthetic@127.0.0.1:54322/postgres";
    e.containers[0]!.NetworkSettings.Ports = {
      "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54322" }],
    };
    expect(() => verifyEphemeralTarget(e)).not.toThrow();
    e.directDatabaseUrl = "postgresql://postgres:synthetic@127.0.0.1:55322/postgres";
    expect(() => verifyEphemeralTarget(e)).toThrow(/Direct PostgreSQL/);
    e.directDatabaseUrl = "postgresql://postgres:synthetic@127.0.0.1:54322/postgres?host=personal";
    expect(() => verifyEphemeralTarget(e)).toThrow(/Direct PostgreSQL/);
  });
  it("rejects cross-family and ambiguous localhost PostgreSQL endpoints", () => {
    const e = evidence();
    const db = e.containers[0]!;
    db.NetworkSettings.Ports = {
      "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54322" }],
    };
    e.directDatabaseUrl = "postgresql://postgres:synthetic@[::1]:54322/postgres";
    expect(() => verifyEphemeralTarget(e)).toThrow(/Direct PostgreSQL/);
    e.directDatabaseUrl = "postgresql://postgres:synthetic@localhost:54322/postgres";
    expect(() => verifyEphemeralTarget(e)).toThrow(/Direct PostgreSQL/);
    db.NetworkSettings.Ports["5432/tcp"]![0]!.HostIp = "::1";
    e.directDatabaseUrl = "postgresql://postgres:synthetic@[::1]:54322/postgres";
    expect(() => verifyEphemeralTarget(e)).not.toThrow();
    e.directDatabaseUrl = "postgresql://postgres:synthetic@127.0.0.1:54322/postgres";
    expect(() => verifyEphemeralTarget(e)).toThrow(/Direct PostgreSQL/);
  });
  it("refuses missing or divergent direct bootstrap credentials", () => {
    const file = "NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321\n" +
      "SUPABASE_SERVICE_ROLE_KEY=ephemeral\nSUPABASE_DB_URL=ephemeral-db";
    const env = { NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
      SUPABASE_SERVICE_ROLE_KEY: "ephemeral", SUPABASE_DB_URL: "personal-db" };
    expect(() => verifyFixtureEnvironment(file, env, true)).toThrow(/credentials differ/);
    expect(() => verifyFixtureEnvironment(file, { ...env, SUPABASE_DB_URL: undefined }, true))
      .toThrow(/credentials differ/);
  });
});
