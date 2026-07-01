// Shared contract row-source for the generators — reads from Postgres (the
// single source of truth). Returns rows mapped to Contract, UNSORTED: each
// generator applies its own sort (most sort by rowSort; contract_lists /
// month_shards sort differently). Closes the pool so the caller's process
// exits cleanly once it's done its synchronous work.
//
// This is the ONE engine-specific seam: the builders (build*FromRows) and the
// verification net are engine-agnostic. See docs/plans/postgres-migration-v1.md.

import { allRows, end } from "./pg";
import { rowToContract } from "./procurement_schema";
import type { Contract } from "../../procurement/types";

export const readContractsFromPg = async (): Promise<Contract[]> => {
  let rows: Array<Record<string, string | number | null>>;
  try {
    rows = await allRows<Record<string, string | number | null>>(
      "SELECT * FROM contracts",
    );
  } catch (e) {
    await end().catch(() => {});
    throw new Error(
      `Cannot read contracts from Postgres (${(e as Error).message}). ` +
        "Run `npm run db:pg:up` then `npm run db:load:pg`.",
    );
  }
  await end();
  return rows.map((r) => rowToContract(r));
};
