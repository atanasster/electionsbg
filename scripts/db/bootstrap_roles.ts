// Create the `app_readonly` role on the local docker Postgres, so a fresh clone can
// complete `npm run db:refresh`.
//
// WHY THIS EXISTS. `roles_readonly.sql` is the only thing in the repo that creates the
// role, and until now nothing invoked it — it was a documented one-time MANUAL step. But
// roles are CLUSTER-wide, so on a virgin `pgdata` volume (a new machine, or any
// `docker compose down -v`) the role is absent, and 34 migrations grant to it BARE.
// `exec()` sends a migration as ONE implicit transaction, so the first of those raises
// 42704 and rolls its whole file back: measured, `db:refresh` dies at step 6 in
// `db:load:pg` applying `017_company_relationships.sql`. It is invisible on any machine
// that ever ran the file by hand, which is every machine this repo has been developed on.
//
// Plan: docs/plans/grant-role-guard-sweep-v1.md (Tier 0). The per-file guards in that
// plan's later tiers are defense-in-depth UNDERNEATH this: they stop one file taking the
// rest down, and they do NOT make the role exist. Shipping them without this step would
// turn a loud step-6 failure into a quiet 42501 on every /api/db endpoint.
//
// REFUSES rather than degrades, on three checks — see `resolveTarget`.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  connectionUrl,
  allRows,
  end,
  isServingDatabase,
  withClient,
  redactUrl,
  LOCAL_DATABASE_URL,
} from "./lib/pg";

const SCHEMA = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "schema/pg/roles_readonly.sql",
);

/** Opt-in for a target that is not the docker-compose Postgres. See `resolveTarget`. */
const NON_LOCAL_FLAG = "--yes-non-local";

/** `sql` with `--` line comments and block comments removed, so a grant that is merely
 *  DISCUSSED in prose cannot be mistaken for the live statement. `roles_readonly.sql`
 *  opens with a 16-line prose header about what it grants, so this is the likely case,
 *  not the exotic one. */
export const stripSqlComments = (sql: string): string =>
  sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

/** Fold an identifier the way Postgres does: unquoted folds to lower case, quoted is
 *  verbatim (with `""` unescaped). */
const foldIdentifier = (raw: string, quoted: boolean): string =>
  quoted ? raw.replace(/""/g, '"') : raw.toLowerCase();

/**
 * The database `roles_readonly.sql` grants CONNECT on, read OUT OF THE FILE rather than
 * restated here.
 *
 * That file hardcodes `GRANT CONNECT ON DATABASE electionsbg`, which coincidentally
 * matches every URL in this repo — so a second hardcoded copy would look correct forever
 * and silently stop matching the day either side is renamed. The failure it guards is not
 * hypothetical: run against a database with a different name and the CONNECT grant either
 * errors (no such database) or, worse, succeeds against a database you are not connected
 * to, granting a role access somewhere nobody looked.
 *
 * Returns null on AMBIGUITY as well as on absence — two different grants mean the file
 * targets two databases and this step can only verify one of them, so refusing is the only
 * honest answer. Taking the first match instead is what lets a commented-out or
 * prose-mentioned name outvote the live statement.
 */
export const grantedDatabase = (sql: string): string | null => {
  const re =
    /GRANT\s+CONNECT\s+ON\s+DATABASE\s+(?:"((?:[^"]|"")+)"|([A-Za-z_-￿][A-Za-z0-9_$-￿]*))/gi;
  const names = [...stripSqlComments(sql).matchAll(re)].map((m) =>
    foldIdentifier(m[1] ?? m[2], m[1] !== undefined),
  );
  const distinct = [...new Set(names)];
  return distinct.length === 1 ? distinct[0] : null;
};

/** The database component of a postgres:// URL, or null if it names none. */
export const databaseOf = (url: string): string | null => {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, "")) || null;
  } catch {
    return null;
  }
};

/** The docker-compose Postgres this step is designed for, compared on HOST and PORT.
 *
 *  The database NAME cannot do this job: every database in this repo is `electionsbg`, so a
 *  name check alone passes a staging clone of production, a second local cluster, or a
 *  colleague's remote host. `isServingUrl` only allowlists the standard Cloud SQL proxy
 *  (127.0.0.1:5434), so it does not catch those either — this is the check that does. */
export const isLocalCompose = (url: string): boolean => {
  try {
    const u = new URL(url);
    const l = new URL(LOCAL_DATABASE_URL);
    return u.hostname === l.hostname && u.port === l.port;
  } catch {
    return false;
  }
};

/** Postgres errors carry code/detail/hint that `.message` alone drops — and this file
 *  exists to diagnose broken cold starts, where those three fields ARE the diagnosis. */
const formatPgError = (e: unknown): string => {
  const err = e as Error & { code?: string; detail?: string; hint?: string };
  return [
    err.code ? `[${err.code}] ${err.message}` : err.message,
    err.detail && `detail: ${err.detail}`,
    err.hint && `hint: ${err.hint}`,
  ]
    .filter(Boolean)
    .join("\n  ");
};

/** Connection failures that MORE WAITING can fix. Anything else is a misconfiguration, and
 *  retrying it for 30 s before printing "is the container up?" sends the operator to fix the
 *  one thing that is not broken. */
const RETRYABLE = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "57P03", // cannot_connect_now — server starting up
]);

/**
 * Wait for Postgres to accept connections.
 *
 * `db:pg:up` is a bare `docker compose up -d`, which returns as soon as the container is
 * STARTED — not when the server is ready — and the compose healthcheck is not waited on.
 * Today nothing notices, because several shard-only steps run before the first connection.
 * This step runs immediately after `db:pg:up`, so it is the first thing to dial, and on a
 * cold container that is a race it would lose.
 *
 * Probes directly rather than through `dbReachable()`: that helper collapses EVERY failure
 * to `false` by design, so a wrong password (28P01) or a missing database (3D000) is
 * indistinguishable from "not up yet" — and this step, being first, is the most likely place
 * in the whole chain for a stale cloud `DATABASE_URL` to surface (see lib/pg.ts's note on
 * that recurring hazard). Non-retryable codes fail immediately with their SQLSTATE.
 *
 * (`docker compose up -d --wait` would also solve the race, at the cost of changing a target
 * several other scripts call. Kept local to this step deliberately.)
 */
export const waitForPostgres = async (
  attempts = 30,
  delayMs = 1000,
  probe: () => Promise<unknown> = () => allRows("SELECT 1"),
): Promise<void> => {
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      await probe();
      return;
    } catch (e) {
      last = e;
      const code = (e as { code?: string }).code;
      if (code && !RETRYABLE.has(code))
        throw new Error(
          `Postgres refused the connection at ${redactUrl(connectionUrl())}:\n  ` +
            formatPgError(e),
        );
    }
    if (i === 1)
      console.log("roles: waiting for Postgres to accept connections…");
    // No sleep after the final attempt — it delays the error by a full interval and buys
    // nothing.
    if (i < attempts) await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(
    `Postgres did not accept a connection after ${attempts} attempts ` +
      `(~${Math.round((attempts * delayMs) / 1000)}s) at ${redactUrl(connectionUrl())}. ` +
      `Is the container up? \`npm run db:pg:up\`\n  Last error: ${formatPgError(last)}`,
  );
};

/**
 * All three refusals, with their reasons. Pure, and run before any network I/O, so a
 * misdirected invocation costs nothing and prod is rejected first.
 *
 * 1. NOT the serving database. Creating a LOGIN role is a privileged, audited action there,
 *    and `roles_readonly.sql`'s own header calls it a one-time step run by hand through the
 *    Auth Proxy with a password set out of band. A bootstrap that quietly did that on prod
 *    would be a worse defect than the one this file fixes.
 * 2. The docker-compose host:port, unless `--yes-non-local` is passed. Check 1 is an
 *    ALLOWLIST for one proxy address, so a staging proxy on another port is "not serving" by
 *    it — and the name check below cannot tell a staging clone from local, because both are
 *    called `electionsbg`. This is the check that actually identifies the server.
 * 3. The connected database is the one the file grants CONNECT on. Narrower than 2, and it
 *    guards a different thing: the SQL file being renamed out from under the URL.
 */
export const resolveTarget = (
  sql: string,
  argv: readonly string[] = process.argv,
): { url: string; database: string } => {
  const url = connectionUrl();
  if (isServingDatabase())
    throw new Error(
      `refusing to create roles on the SERVING database (${redactUrl(url)}).\n` +
        `  roles_readonly.sql is a deliberate one-time step there — apply it by hand ` +
        `through the Auth Proxy and set the role's password out of band. ` +
        `See docs/plans/postgres-migration-v1.md.`,
    );

  if (!isLocalCompose(url) && !argv.includes(NON_LOCAL_FLAG))
    throw new Error(
      `refusing to create roles on ${redactUrl(url)} — not the docker-compose Postgres ` +
        `(${redactUrl(LOCAL_DATABASE_URL)}).\n` +
        `  The database NAME cannot tell a staging clone from local: both are "electionsbg". ` +
        `Re-run with ${NON_LOCAL_FLAG} if you mean it.`,
    );

  const granted = grantedDatabase(sql);
  if (!granted)
    throw new Error(
      `found no single \`GRANT CONNECT ON DATABASE …\` in ${SCHEMA}.\n` +
        `  Either it was removed/renamed, or the file now grants CONNECT on more than one ` +
        `database — this step refuses rather than guessing which one it is bootstrapping.`,
    );

  const connected = databaseOf(url);
  if (connected !== granted)
    throw new Error(
      `connected to database "${connected}" but roles_readonly.sql grants CONNECT on ` +
        `"${granted}" (${redactUrl(url)}).\n` +
        `  Running it here would grant a role access to a database this process is not on. ` +
        `Point DATABASE_URL at "${granted}", or update the file.`,
    );

  return { url, database: granted };
};

const roleExists = async (): Promise<boolean> =>
  (
    await allRows<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') AS exists`,
    )
  )[0]?.exists === true;

export const run = async (): Promise<void> => {
  const sql = readFileSync(SCHEMA, "utf8");
  const { url, database } = resolveTarget(sql);

  await waitForPostgres();

  // Reported rather than skipped-on: the file is idempotent (CREATE ROLE sits behind
  // IF NOT EXISTS, every GRANT is re-runnable), and re-applying it also re-grants SELECT
  // on any table created since — which is the state a half-bootstrapped database is in.
  const before = await roleExists();

  // NOT `exec()`, and this is the whole point of the step rather than a style choice.
  // `exec()` preflights `SELECT similarity('', '')` to force-load pg_trgm, and pg_trgm is
  // created by 000_search_fns.sql — applied by `db:load:pg`, which is FOUR STEPS LATER in
  // db:refresh. On the virgin cluster this step exists for, that preflight raises 42883
  // before the role file is ever sent, so the bootstrap would fail on the only case it is
  // for, with an error naming neither the role nor the extension. Measured, then fixed.
  // `roles_readonly.sql` needs no extension, so a raw apply is also the correct scope.
  await withClient(async (c) => {
    await c.query(sql);
  });

  console.log(
    `roles: app_readonly ${before ? "already existed —" : "CREATED on"} ${database} ` +
      `(${redactUrl(url)}); privileges re-applied.`,
  );
};

// Guarded so a test can import the pure helpers above without firing the bootstrap: this
// module CREATES A ROLE against whatever DATABASE_URL is ambient. Same convention as
// load_place_dim_pg.ts / load_pg.ts / dump.ts.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run()
    .catch((e) => {
      console.error(`roles: ${formatPgError(e)}`);
      process.exitCode = 1;
    })
    .finally(() => end());
}
