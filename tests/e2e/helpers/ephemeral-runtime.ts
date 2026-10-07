import { execFileSync } from "node:child_process";
import * as fs from "node:fs";

type Container = {
  Id: string;
  Name: string;
  State: { Running: boolean };
  Config: { Labels?: Record<string, string>; Env?: string[] };
  NetworkSettings: {
    Ports?: Record<string, Array<{ HostIp: string; HostPort: string }> | null>;
    Networks: Record<string, { IPAddress?: string; Aliases?: string[] | null }>;
  };
};

export function projectApiConfig(config: string): { project: string; apiPort: number } {
  const project = /^project_id\s*=\s*"([^"]+)"/m.exec(config)?.[1];
  const api = config.split(/^\[api\]\s*$/m)[1]?.split(/^\[/m)[0];
  const apiPort = Number(/^port\s*=\s*(\d+)/m.exec(api ?? "")?.[1]);
  if (!project || !apiPort) throw new Error("Ephemeral project/API config missing.");
  return { project, apiPort };
}

export function verifyFixtureEnvironment(file: string, env: Record<string, string | undefined>): void {
  const values: Record<string, string> = {};
  for (const line of file.split("\n")) {
    const clean = line.trim();
    const index = clean.indexOf("=");
    if (index > 0 && !clean.startsWith("#")) values[clean.slice(0, index)] = clean.slice(index + 1);
  }
  for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if (!values[key] || values[key] !== env[key])
      throw new Error("Fixture credentials differ from the application E2E environment.");
  }
}

function localApi(value: string): URL {
  const url = new URL(value);
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.protocol !== "http:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Ephemeral API must be a plain loopback HTTP origin.");
  return url;
}

export function verifyEphemeralTarget(input: {
  project: string;
  apiPort: number;
  supabaseUrl: string;
  appSupabaseUrl: string;
  databaseId: string;
  containers: Container[];
  ci: boolean;
}): void {
  const api = localApi(input.supabaseUrl);
  const appApi = localApi(input.appSupabaseUrl);
  if (Number(api.port) !== input.apiPort || appApi.port !== api.port)
    throw new Error("API/app URL does not match the ephemeral project port.");
  const tagged = input.containers.filter(
    (c) => c.State.Running && c.Config.Labels?.["com.supabase.cli.project"] === input.project,
  );
  const db = tagged.find((c) => c.Id === input.databaseId);
  const gateways = tagged.filter(
    (c) =>
      c.Name === `/supabase_kong_${input.project}` &&
      c.NetworkSettings.Ports?.["8000/tcp"]?.some(
        (p) => p.HostPort === api.port && ["0.0.0.0", "::", "127.0.0.1", "::1"].includes(p.HostIp),
      ),
  );
  const rest = tagged.find((c) => c.Name === `/supabase_rest_${input.project}`);
  if (!db || gateways.length !== 1 || !rest)
    throw new Error("Ephemeral gateway/REST/database association missing.");
  const gateway = gateways[0]!;
  if (!input.ci && [db, gateway, rest].some((c) => c.Config.Labels?.["deskcomm.purpose"] !== "e2e"))
    throw new Error("Local API/database must all be labelled e2e.");
  const networks = Object.keys(db.NetworkSettings.Networks).filter(
    (n) => gateway.NetworkSettings.Networks[n] && rest.NetworkSettings.Networks[n],
  );
  if (!networks.length) throw new Error("Ephemeral gateway and database do not share a network.");
  const uri = rest.Config.Env?.find((v) => v.startsWith("PGRST_DB_URI="))?.slice(
    "PGRST_DB_URI=".length,
  );
  let host = "";
  try {
    host = uri ? new URL(uri).hostname : "";
  } catch {
    throw new Error("Ephemeral REST database config is invalid.");
  }
  const aliases = [
    db.Name.slice(1),
    ...networks.flatMap((n) => [
      db.NetworkSettings.Networks[n]!.IPAddress,
      ...(db.NetworkSettings.Networks[n]!.Aliases ?? []),
    ]),
  ];
  if (!host || !aliases.includes(host))
    throw new Error("Ephemeral REST points to another database.");
}

export async function assertEphemeralRuntime(appUrl: string, requireStub = false): Promise<void> {
  verifyFixtureEnvironment(fs.readFileSync(".env.e2e", "utf8"), process.env);
  const app = new URL(appUrl);
  localApi(app.origin);
  if (requireStub && process.env.INTERNAL_AGENT_RUN_STUB !== "true")
    throw new Error("Controlled provider is required.");
  for (const name of ["WAHA_API_BASE_URL", "WAHA_INTERNAL_BASE_URL"]) {
    const value = process.env[name];
    if (value) localApi(new URL(value).origin);
  }
  const { project, apiPort } = projectApiConfig(fs.readFileSync("supabase/config.toml", "utf8"));
  const ci = process.env.GITHUB_ACTIONS === "true" && !!process.env.RUNNER_TEMP;
  const database = ci ? `supabase_db_${project}` : process.env.E2E_EPHEMERAL_DB_CONTAINER;
  if (!database) throw new Error("Explicit ephemeral database required.");
  const inspect = (ids: string[]) =>
    JSON.parse(
      execFileSync("docker", ["inspect", ...ids], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    ) as Container[];
  const ids = execFileSync(
    "docker",
    ["ps", "-q", "--filter", `label=com.supabase.cli.project=${project}`],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  )
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!ids.length) throw new Error("Ephemeral project is not running.");
  const databaseId = inspect([database])[0]!.Id;
  const response = await fetch(new URL("/login", app), {
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Ephemeral application did not serve its runtime config.");
  const payload = /window\.__PUBLIC_ENV__=(\{[\s\S]*?\});<\/script>/.exec(
    await response.text(),
  )?.[1];
  if (!payload) throw new Error("Application runtime Supabase config missing.");
  const appSupabaseUrl = (JSON.parse(payload) as { NEXT_PUBLIC_SUPABASE_URL?: string })
    .NEXT_PUBLIC_SUPABASE_URL;
  if (!appSupabaseUrl) throw new Error("Application runtime Supabase URL missing.");
  verifyEphemeralTarget({
    project,
    apiPort,
    ci,
    databaseId,
    containers: inspect(ids),
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    appSupabaseUrl,
  });
}
