// Node-only DB fetcher for the AI correctness harness. Runs the SAME
// functions/db_routes.js handlers the production `/api/db` endpoint runs, but
// against the local Postgres store — so a tool's numbers are verified against
// the exact route code prod serves (not a re-implementation). Wire it in a
// harness with `setDbFetcher(nodeDbFetcher)` right after the JSON `setFetcher`.
//
// NEVER import this from browser/tool code — it pulls in node-pg + the CJS
// functions bundle. Only *.harness.ts / *.test.ts entrypoints import it.
//
// ⚠ "THE SAME HANDLERS" IS TRUE OF THE CODE, NOT OF THE WIRE FORMAT. This returns the handler's
// `body` OBJECT in-process; production serialises it to JSON over HTTP. The two differ wherever a
// value has no JSON representation of its own — most often a Postgres `timestamptz`, which
// node-postgres hands back as a `Date` here and as an ISO STRING in prod. A tool that types such a
// field `string` compiles, works in production, and throws `x.slice is not a function` the moment
// the harness runs it — which is how `openCalls` shipped with six assertions that never executed.
//
// So a tool reading a timestamp must accept `string | Date` (see `Stamp` in ai/tools/fiscal.ts),
// and a hermetic test whose fixture uses strings does NOT cover the harness path. The same applies
// to `numeric` (string over the wire, string here) and `bigint`.

import { createRequire } from "node:module";
import {
  allRows,
  pinLocalDatabase,
  withReadOnlyTx,
} from "../../scripts/db/lib/pg";
import type { DbParams } from "./dataClient";
import type { DbRows } from "../../functions/db_table";

// This node fetcher exists ONLY for the AI harnesses, which verify tool numbers
// against the local docker Postgres. Pin the local URL so a cloud DATABASE_URL
// left in the shell (password-less → .pgpass cloud password) can't fail auth
// against local PG and break `npm run ai:test` in the deploy predeploy hook.
// Runs at import time, before any getPool() call (getPool is lazy).
pinLocalDatabase();

const require = createRequire(import.meta.url);
const { DB_ROUTES } = require("../../functions/db_routes.js") as {
  DB_ROUTES: Record<
    string,
    (
      dbRows: DbRows,
      q: Record<string, string>,
    ) => Promise<{ status?: number; body: unknown }>
  >;
};

/** Run one `/api/db/<route>` handler against local Postgres and return its
 *  `body` — the exact shape the browser fetch would receive. */
export const nodeDbFetcher = async (
  route: string,
  params: DbParams,
): Promise<unknown> => {
  const handler = DB_ROUTES[route];
  if (!handler) throw new Error(`unknown db route: ${route}`);
  const q: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") q[k] = String(v);
  }
  // Pin the table engine's rows + aggregate queries to one READ ONLY snapshot.
  const dbRows: DbRows = (sql, p) => allRows(sql, p);
  dbRows.tx = (cb) => withReadOnlyTx(cb);
  const { status = 200, body } = await handler(dbRows, q);
  if (status !== 200) throw new Error(`db route ${route} -> ${status}`);
  return body;
};
