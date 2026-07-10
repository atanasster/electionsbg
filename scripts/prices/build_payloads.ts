// Build the serving blobs into `price_payloads`, mirroring agri_payloads /
// fund_payloads: (kind, key) -> jsonb, an O(1) primary-key seek per fetch.
//
// The maths is build_index.ts, unchanged. Only the source (price_grid_days
// instead of the _cache JSON tree) and the sink (price_payloads instead of
// files) differ. Keeping one code path is what makes the parity harness mean
// something: if the payloads diverge from the shipped JSON, it is a real
// regression and not an artefact of a second implementation.
//
// kinds: index | ranking | chains | dict | place:<ekatte> | chains-muni:<obshtina>

import type { PoolClient } from "pg";
import { withClient, allRows } from "../db/lib/pg";
import { copyRows } from "../db/lib/copy";
import { buildPriceIndex, type Emit } from "./build_index";
import { loadGridsFromPg } from "./lib/grids_pg";

export const buildPayloads = async (): Promise<void> => {
  const grids = await loadGridsFromPg();
  if (!grids.length) {
    console.log(
      "[payloads] no grids in price_grid_days — run the ingest first",
    );
    return;
  }

  const rows: [string, string, string][] = [];
  const emit: Emit = (kind, key, obj) => {
    rows.push([kind, key, JSON.stringify(obj)]);
  };

  buildPriceIndex({ grids, emit });

  await withClient(async (c: PoolClient) => {
    await c.query("BEGIN");
    try {
      // A full rebuild every run: the payloads are derived, small, and must
      // never contain a stale place shard for a settlement that dropped out.
      await c.query("TRUNCATE price_payloads");
      await copyRows(c, "price_payloads", ["kind", "key", "payload"], rows);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
  });

  const [{ n, bytes }] = await allRows<{ n: string; bytes: string }>(
    "SELECT count(*) AS n, pg_size_pretty(sum(pg_column_size(payload))::bigint) AS bytes FROM price_payloads",
  );
  const kinds = await allRows<{ kind: string; n: string }>(
    "SELECT kind, count(*) AS n FROM price_payloads GROUP BY kind ORDER BY 1",
  );
  console.log(
    `[payloads] ${Number(n).toLocaleString()} blobs (${bytes}) — ` +
      kinds.map((k) => `${k.kind}:${k.n}`).join(" "),
  );
};

import { end as endPool } from "../db/lib/pg";

if (process.argv[1] && /build_payloads\.ts$/.test(process.argv[1])) {
  buildPayloads()
    .then(() => endPool())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
