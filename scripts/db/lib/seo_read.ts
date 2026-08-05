// The shared envelope every build-time SEO enumerator runs its query inside.
//
// The prerender builder and the sitemap enumerator both need to read Postgres at
// BUILD time to know which pages of a PG-served family exist. Neither may take
// the build down: a machine without Docker must emit "no such pages" and a
// sitemap without their <loc>s, not a stack trace. So every one of these readers
// wants the same envelope — one short-lived pool, one query, warn-and-[] on any
// failure — and only the SQL and the row-mapper are actually family-specific.
//
// Written twice before this (seo_settlements.ts, then seo_courts.ts), which
// meant each robustness fix had to be applied and kept applied in both. It is
// one function now.

import { Pool } from "pg";
import { connectionUrl } from "./pg";

/**
 * Run one build-time query and return its rows.
 *
 * **Never throws.** Any failure — unreachable server, unapplied migration,
 * renamed column — is warned about and degrades to `[]`, so the caller omits its
 * page family rather than aborting `npm run build`.
 *
 * @param family  URL family for the log line, e.g. `"/court/*"`.
 * @param sql     The query. No parameters: these enumerate whole families.
 */
export const readSeoRows = async <R extends object>(
  family: string,
  sql: string,
): Promise<R[]> => {
  const pool = new Pool({
    connectionString: connectionUrl(),
    max: 2,
    // node-postgres defaults this to 0 — wait forever. A refused connection
    // fails fast, but one that is ACCEPTED and never completes the startup
    // handshake (a Cloud SQL proxy up in front of a stopped instance) would hang
    // the build instead of degrading, which is the one way the [] contract can
    // still not hold.
    connectionTimeoutMillis: 10_000,
  });
  // A Pool with no 'error' listener CRASHES the process on an idle-backend drop,
  // and an unhandled 'error' event is not caught by the try/catch below — the
  // last remaining path from a database hiccup to a failed build.
  pool.on("error", () => {});
  try {
    const { rows } = await pool.query<R>(sql);
    return rows;
  } catch (err) {
    // Surface the SQLSTATE. "Postgres unavailable" is one diagnosis, and this
    // catch also fires for 42P01 (migration never applied here) and 42703 (a
    // column renamed out from under the query) — different events with different
    // fixes. Naming only the first sends an operator whose server is plainly
    // running to look in the wrong place; see dbReachable()'s note in pg.ts.
    const e = err as { message?: string; code?: string };
    console.warn(
      `[seo] skipping ${family} pages — query failed` +
        `${e?.code ? ` [${e.code}]` : ""}: ${e?.message ?? String(err)}` +
        ` (Postgres unreachable, or the migration is not applied here)`,
    );
    return [];
  } finally {
    await pool.end().catch(() => {});
  }
};
