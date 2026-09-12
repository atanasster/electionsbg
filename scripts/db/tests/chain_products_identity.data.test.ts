import { afterAll, expect, it } from "vitest";
import { createRequire } from "node:module";
import { end, pinLocalDatabase, withClient } from "../lib/pg";

const { DB_ROUTES } = createRequire(import.meta.url)(
  "../../../functions/db_routes.js",
);
pinLocalDatabase();
afterAll(end);

it.skipIf(process.env.DB_VERIFY !== "1")(
  "chain identity guard follows current source evidence and heals after correction",
  async () => {
    await withClient(async (client) => {
      await client.query("BEGIN");
      try {
        // Temporary fixtures shadow the live relations; no persistent data changes.
        await client.query(`CREATE TEMP TABLE price_chains(eik text, name text, last_seen date);
        CREATE TEMP TABLE price_stores(eik text, label_norm text, last_seen date);
        CREATE TEMP TABLE price_payloads(kind text, key text, payload jsonb);
        INSERT INTO price_chains VALUES ('130007884', 'Билла', '2026-09-11'), ('203105528', 'Нове Фарм', '2026-09-11');
        INSERT INTO price_stores VALUES ('130007884', 'НОВЕ 5 СОФИЯ', '2026-09-11'), ('203105528', 'НОВЕ 5 СОФИЯ', '2026-09-11');
        INSERT INTO price_payloads SELECT 'chain-products', eik, '{"products":[{"title":"НАКЛОФЕН","price":2.03}],"asOf":"2026-09-11"}'::jsonb FROM price_chains;`);
        const read = async (key: string) =>
          (
            await DB_ROUTES["price-payload"](
              async (sql: string, params: unknown[]) =>
                (await client.query(sql, params)).rows,
              { kind: "chain-products", key },
            )
          ).body;
        expect(await read("130007884")).toMatchObject({
          chain: "Билла",
          products: [],
          sourceConflict: "chain-store-mismatch",
        });
        expect((await read("203105528")).products).toHaveLength(1);
        // Advancing the dimension must not expose the old incorrect payload.
        await client.query(
          "UPDATE price_chains SET last_seen='2026-09-12' WHERE eik='130007884'",
        );
        expect((await read("130007884")).sourceConflict).toBe(
          "chain-store-mismatch",
        );
        await client.query(
          `UPDATE price_payloads SET payload='{"products":[{"title":"Хляб","price":1.29}],"asOf":"2026-09-12"}'::jsonb WHERE key='130007884'`,
        );
        expect((await read("130007884")).sourceConflict).toBeNull();
        await client.query(
          "INSERT INTO price_stores VALUES ('130007884','НОВЕЛА','2026-09-12')",
        );
        expect((await read("130007884")).sourceConflict).toBeNull();
        await client.query(
          "INSERT INTO price_stores VALUES ('130007884','НОВЕ 5','2026-09-12')",
        );
        expect((await read("130007884")).products).toEqual([]);
      } finally {
        await client.query("ROLLBACK");
      }
    });
  },
);
