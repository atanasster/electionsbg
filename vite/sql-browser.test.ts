import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { runSqlBrowserQuery } from "./sql-browser";

const require = createRequire(import.meta.url);
const { runQuery: runProductionQuery } = require("../functions/sql_lib.js") as {
  runQuery: (
    pool: { connect: () => Promise<unknown> },
    sql: string,
    limit?: number,
  ) => Promise<unknown>;
};

const clientFixture = () => {
  const calls: Array<[string, unknown[] | undefined]> = [];
  const client = {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      calls.push([sql, values]);
      if (sql.startsWith("FETCH"))
        return {
          rows: [{ value: 1 }, { value: 2 }, { value: 3 }],
          fields: [{ name: "value" }],
        };
      if (/EXPLAIN/.test(sql))
        return { rows: [{ plan: "ok" }], fields: [{ name: "plan" }] };
      return { rows: [], fields: [] };
    }),
    release: vi.fn(),
  };
  return { client, calls };
};

describe("development and production SQL execution parity", () => {
  it.each([
    ["-- recipe\nSELECT 1 AS value;", 2],
    ["SELECT 'semi;colon' AS value;", 2],
    ["EXPLAIN SELECT 1;", 20],
  ] as const)("uses identical execution for %s", async (sql, limit) => {
    const development = clientFixture();
    const production = clientFixture();
    const [devResult, prodResult] = await Promise.all([
      runSqlBrowserQuery(development.client, sql, limit),
      runProductionQuery(
        { connect: async () => production.client },
        sql,
        limit,
      ),
    ]);
    const devStable = { ...(devResult as object), elapsedMs: 0 };
    const prodStable = { ...(prodResult as object), elapsedMs: 0 };
    expect(devStable).toEqual(prodStable);
    expect(development.calls).toEqual(production.calls);
    expect(production.client.release).toHaveBeenCalledOnce();
  });

  it("rolls back both hosts after a query error", async () => {
    const development = clientFixture();
    const production = clientFixture();
    development.client.query.mockImplementation(async (sql: string) => {
      development.calls.push([sql, undefined]);
      if (sql.startsWith("DECLARE")) throw new Error("boom");
      return { rows: [], fields: [] };
    });
    production.client.query.mockImplementation(async (sql: string) => {
      production.calls.push([sql, undefined]);
      if (sql.startsWith("DECLARE")) throw new Error("boom");
      return { rows: [], fields: [] };
    });
    await expect(
      runSqlBrowserQuery(development.client, "SELECT 1", 10),
    ).rejects.toThrow("boom");
    await expect(
      runProductionQuery(
        { connect: async () => production.client },
        "SELECT 1",
        10,
      ),
    ).rejects.toThrow("boom");
    expect(development.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(production.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });
});
