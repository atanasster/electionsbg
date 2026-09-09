import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { runQuery } = require("./sql_lib.js") as {
  runQuery: (
    pool: { connect: () => Promise<unknown> },
    sql: string,
    limit?: number,
  ) => Promise<{
    rows: Array<Record<string, unknown>>;
    rowCount: number;
    truncated: boolean;
  }>;
};

const poolFor = () => {
  const queries: string[] = [];
  const query = vi.fn(async (sql: string) => {
    queries.push(sql);
    if (sql.startsWith("FETCH"))
      return {
        rows: Array.from({ length: 2001 }, (_, i) => ({ n: i })),
        fields: [{ name: "n" }],
      };
    if (/^(?:--[\s\S]*\n)?EXPLAIN/i.test(sql))
      return { rows: [{ plan: "ok" }], fields: [{ name: "plan" }] };
    return { rows: [], fields: [] };
  });
  const client = { query, release: vi.fn() };
  return {
    pool: { connect: async () => client },
    queries,
    client,
  };
};

describe("production SQL execution", () => {
  it("uses the cursor cap for generated SQL with leading comments", async () => {
    const { pool, queries, client } = poolFor();
    const result = await runQuery(
      pool,
      "-- source: contracts; semantics follow\nSELECT * FROM contracts;",
      5000,
    );
    expect(queries.some((query) => query.startsWith("DECLARE _b"))).toBe(true);
    expect(queries).toContain("FETCH 2001 FROM _b");
    expect(result).toMatchObject({ rowCount: 2000, truncated: true });
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("does not treat a semicolon inside a value as a second statement", async () => {
    const { pool, queries } = poolFor();
    await runQuery(pool, "SELECT 'one;value' AS value;", 10);
    expect(queries.some((query) => query.startsWith("DECLARE _b"))).toBe(true);
  });

  it("keeps Explain out of the cursor path", async () => {
    const { pool, queries } = poolFor();
    await runQuery(pool, "-- plan\nEXPLAIN SELECT * FROM contracts;", 10);
    expect(queries.some((query) => query.startsWith("DECLARE _b"))).toBe(false);
    expect(queries.some((query) => query.includes("EXPLAIN SELECT"))).toBe(
      true,
    );
  });
});
