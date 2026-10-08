import { describe, expect, it } from "vitest";
import { sql } from "./psql-transporte";

describe("DID routing is worker-only", () => {
  it("denies both public-facing roles and preserves the worker grant", () => {
    expect(
      sql(`select has_function_privilege('anon', 'public.fn_resolve_inbound_number(text)', 'EXECUTE'),
      has_function_privilege('authenticated', 'public.fn_resolve_inbound_number(text)', 'EXECUTE'),
      has_function_privilege('service_role', 'public.fn_resolve_inbound_number(text)', 'EXECUTE');`),
    ).toBe("f|f|t");
  });

  it.each(["anon", "authenticated"])(
    "%s cannot enumerate numbers through SECURITY DEFINER",
    (role) => {
      expect(() =>
        sql(
          `set role ${role}; select * from public.fn_resolve_inbound_number('nonexistent-security-fixture');`,
        ),
      ).toThrow(/permission denied for function fn_resolve_inbound_number/);
    },
  );

  it("the worker can still call the resolver and a nonexistent number has no route", () => {
    expect(
      sql(
        `set role service_role; select count(*) from public.fn_resolve_inbound_number('nonexistent-security-fixture');`,
      ),
    ).toBe("SET\n0");
  });

  it("pins the definer lookup path without changing its routing characteristics", () => {
    expect(
      sql(`select prosecdef, provolatile, proconfig @> array['search_path=public, pg_temp']
      from pg_proc where oid='public.fn_resolve_inbound_number(text)'::regprocedure;`),
    ).toBe("t|s|t");
  });
});
