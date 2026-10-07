import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { STORAGE_KEY as PROVIDER_KEY } from "@/lib/theme";
import { STORAGE_KEY, THEME_INIT_SCRIPT } from "@/lib/theme-storage";

describe("tema salvo antes da hidratação", () => {
  it.each([
    ["dark", false, "dark"],
    ["light", true, "light"],
    ["system", true, "dark"],
    [null, false, "light"],
  ])("preserva %s com sistema escuro=%s", (stored, darkSystem, expected) => {
    let applied = "";
    const reads: string[] = [];
    runInNewContext(THEME_INIT_SCRIPT, {
      localStorage: {
        getItem: (key: string) => {
          reads.push(key);
          return key === PROVIDER_KEY ? stored : "light";
        },
      },
      window: { matchMedia: () => ({ matches: darkSystem }) },
      document: {
        documentElement: {
          setAttribute: (_key: string, value: string) => {
            applied = value;
          },
        },
      },
    });
    expect(reads).toEqual([STORAGE_KEY]);
    expect(STORAGE_KEY).toBe(PROVIDER_KEY);
    expect(applied).toBe(expected);
  });
});
