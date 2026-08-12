// Build person_browse_table (schema: 120_person_browse.sql) — the matview behind the
// `persons` registry resource and the /persons browser.
//
// Reads the DB only; it fetches nothing and parses nothing. Plan:
// docs/plans/persons-browser-v1.md.
//
// ORDER — this runs LAST, and the reason is not cosmetic. The matview folds SIX upstream
// datasets, four of which db:refresh loads AFTER db:resolve:persons:
//
//   db:resolve:persons                  person / person_role      (the identity core)
//   db:load:declarations:pg -- --resolve person_wealth_year        (net worth, delta) AND
//                                        declaration.person_id     (has_declaration)
//   db:load:official-candidate-links:pg  official_candidate_link   (the ≤192 non-MP photos)
//   db:load:judicial-bodies:pg           judicial_body             (court name + oblast hop)
//   db:load:place-dim:pg                 place_dim                 (every place LABEL)
//   db:load:pg                           contracts                 (public_money_eur)
//
// Refreshing any earlier yields a table that is GREEN and WRONG — no photos, stale wealth,
// and NULL place labels. That last one is the failure CLAUDE.md documents for /person: an
// empty dimension does not error, it publishes blanks, and here it also empties the place
// FILTER, which reads to a user as "there are no such people". person_browse.data.test.ts
// asserts a non-NULL place_label for every row carrying a place_code rather than trusting
// this ordering to hold.
//
// `--resolve` IS PHASE 2, AND IT IS THE ONE THAT BIT US. Loading declarations without it
// leaves `declaration.person_id` NULL on every row: the table is present and full, so a
// row-count preflight passes, and `has_declaration` publishes FALSE for all 56,801 people —
// the "с декларация" filter matches nobody while net worth still renders from
// person_wealth_year, so the page looks like it works. JOIN_KEYS below now catches it.
//
// TWO REFRESH TRIGGERS, not one. The person layer is the obvious one. The other is a
// CONTRACTS reload — the procurement watch skill reloads that corpus independently, and
// public_money_eur is computed from it, so a contracts refresh without this one lets the
// money column drift away from /procurement/contracts with nothing failing.
//
// Run: `npm run db:load:persons-browse:pg` (local) / `:cloud` (Cloud SQL proxy).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { exec, allRows, withTx, end } from "./lib/pg";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
// Applied in order, in one transaction with the build below. 148 first: 120's matview body
// selects from `person_company_bridge_a` (the Bridge-A definition it used to carry inline),
// and a matview body is resolved at CREATE time, so the reverse order fails with 42P01. 148
// additionally needs `company_politicians` — which 120 already reads, so this adds no new
// precondition to this loader.
const SCHEMA_FILES = [
  path.join(ROOT, "scripts/db/schema/pg/148_person_company_basis.sql"),
  path.join(ROOT, "scripts/db/schema/pg/120_person_browse.sql"),
];

/** Tables the matview folds. Absent OR EMPTY, the build still succeeds and publishes
 *  blanks — an empty mp_profile costs every photo, an empty contracts costs the whole
 *  money column, and an empty company_politicians flips every 'declared' TR link to
 *  'name_match', changing what the page claims about named people. None of that errors,
 *  so both conditions are checked up front and named. */
const INPUTS = [
  "person",
  "person_role",
  "person_source",
  "place_dim",
  "judicial_body",
  "mp_profile",
  "official_candidate_link",
  "person_wealth_year",
  "declaration",
  "contracts",
  "company_politicians",
  "magistrate_company",
] as const;

/** JOIN KEYS that a LINKING step fills, and that are wholly NULL until it runs.
 *
 *  Presence and row count are not enough, and this list exists because that gap shipped:
 *  Cloud SQL had all 47,983 `declaration` rows with `person_id` NULL on every one, because
 *  the resolve pass had never run there. The table was present and non-empty, so the
 *  preflight passed — and `has_declaration` published FALSE for all 56,801 people, so the
 *  "с декларация" filter matched nobody and its KPI read 0%. Net worth still rendered (it
 *  comes from person_wealth_year), which is what made the failure look like a working page.
 *
 *  The rule: a column here is one whose TOTAL nullness means an upstream step was skipped,
 *  never a legitimate data state. Columns that are legitimately sparse (contract EIKs,
 *  photo URLs) do NOT belong — a false alarm here would train an operator to ignore it. */
const JOIN_KEYS: { table: string; column: string; fix: string }[] = [
  {
    table: "declaration",
    column: "person_id",
    fix: "db:load:declarations:pg -- --resolve (phase 2 links declarations to the person layer)",
  },
  {
    table: "judicial_body",
    column: "place_code",
    fix: "db:load:judicial-bodies:pg (without it every magistrate loses their oblast)",
  },
  {
    table: "place_dim",
    column: "oblast_code",
    fix: "db:load:place-dim:pg (without it no row resolves an oblast)",
  },
  {
    table: "company_politicians",
    column: "eik",
    fix: "db:load:declarations:pg (bridge A; without it every TR link reads as name-matched)",
  },
];

/** The operator-facing message for a preflight failure, as a pure function so the wording
 *  — the only thing that tells someone WHICH loader they skipped — is unit-testable
 *  without a database. Returns null when every input is present, non-empty, and carries a
 *  populated join key. */
export const preflightError = (
  present: readonly string[],
  empty: readonly string[],
  unlinked: readonly { table: string; column: string; fix: string }[] = [],
): string | null => {
  const missing = INPUTS.filter((t) => !present.includes(t));
  if (!missing.length && !empty.length && !unlinked.length) return null;
  const parts: string[] = [];
  if (missing.length) parts.push(`missing: ${missing.join(", ")}`);
  if (empty.length) parts.push(`empty: ${empty.join(", ")}`);
  for (const u of unlinked)
    parts.push(`${u.table}.${u.column} is NULL on every row — run ${u.fix}`);
  return (
    `person_browse_table would publish blanks — ${parts.join("; ")}. ` +
    `Run the loaders that fill them first (see the ORDER block at the top of ` +
    `scripts/db/load_persons_browse_pg.ts); db:refresh sequences them locally, the ` +
    `cloud side needs each :cloud script run by hand.`
  );
};

const preflight = async (): Promise<void> => {
  const rows = await allRows<{ relname: string }>(
    `SELECT c.relname FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
       AND c.relkind IN ('r', 'm', 'v')`,
    [[...INPUTS]],
  );
  const present = rows.map((r) => r.relname);

  // Emptiness, for the tables that ARE there. Identifiers come from the INPUTS literal
  // above, never from input, so the interpolation is safe.
  let empty: string[] = [];
  if (present.length) {
    const counts = await allRows<{ relname: string; n: string }>(
      present
        .map((t) => `SELECT '${t}' AS relname, count(*)::text AS n FROM ${t}`)
        .join(" UNION ALL "),
    );
    empty = counts.filter((r) => r.n === "0").map((r) => r.relname);
  }

  // Join keys, for the tables that are present AND non-empty (an absent or empty table is
  // already reported above; probing it again would just repeat the same failure).
  const probeable = JOIN_KEYS.filter(
    (k) => present.includes(k.table) && !empty.includes(k.table),
  );
  let unlinked: typeof JOIN_KEYS = [];
  if (probeable.length) {
    const linked = await allRows<{ k: string; n: string }>(
      probeable
        .map(
          (k) =>
            `SELECT '${k.table}.${k.column}' AS k, count(${k.column})::text AS n FROM ${k.table}`,
        )
        .join(" UNION ALL "),
    );
    const zero = new Set(linked.filter((r) => r.n === "0").map((r) => r.k));
    unlinked = probeable.filter((k) => zero.has(`${k.table}.${k.column}`));
  }

  const err = preflightError(present, empty, unlinked);
  if (err) throw new Error(err);
};

const main = async (): Promise<void> => {
  await preflight();

  // Apply AND validate inside ONE transaction. The schema file DROPs and recreates the
  // matview (a plain REFRESH is not enough on a first run and not correct after a column
  // change), and validating after a separate commit would mean the blank-label table is
  // already live and being served by the time the guard throws — the loader would publish
  // the exact state it exists to prevent, then tell the operator to go fix it. Rolling
  // back leaves the previous good table in place instead.
  await withTx(async (c) => {
    await c.query("SELECT similarity('', '')"); // pg_trgm preload, as exec() does
    for (const f of SCHEMA_FILES) await c.query(readFileSync(f, "utf8"));

    const {
      rows: [s],
    } = await c.query<{ unlabelled: string }>(
      `SELECT count(*) FILTER (WHERE place_code IS NOT NULL AND place_label IS NULL)
                AS unlabelled
         FROM person_browse_table`,
    );
    // The silent failure, surfaced. A placed row with no label means place_dim /
    // judicial_body were empty when this ran — the table builds, the page renders, and
    // the place column is simply blank (and its filter offers nothing).
    if (Number(s.unlabelled) > 0)
      throw new Error(
        `person_browse_table: ${s.unlabelled} row(s) carry a place_code but no ` +
          `place_label — place_dim (117) and/or judicial_body (116) were empty. Run ` +
          `db:load:place-dim:pg and db:load:judicial-bodies:pg, then re-run this loader. ` +
          `(Nothing was published: this build was rolled back.)`,
      );
  });

  // Stats, immediately. A freshly built matview has none, and person-serving queries pick
  // bad plans in that window — resolve_persons.ts ANALYZEs person/person_role for exactly
  // this reason, having measured person_connections at 2.5s instead of 0.25s on stale
  // stats. Cheap here, invisible-but-expensive if skipped.
  await exec("ANALYZE person_browse_table");

  const [stats] = await allRows<{
    rows: string;
    placed: string;
    with_party: string;
    with_money: string;
    with_photo: string;
  }>(
    `SELECT count(*)                                                       AS rows,
            count(*) FILTER (WHERE place_code IS NOT NULL)                 AS placed,
            count(*) FILTER (WHERE party_primary IS NOT NULL)              AS with_party,
            count(*) FILTER (WHERE public_money_eur IS NOT NULL)           AS with_money,
            count(*) FILTER (WHERE photo_url IS NOT NULL)                  AS with_photo
       FROM person_browse_table`,
  );

  console.log(
    `person_browse_table: ${stats.rows} persons ` +
      `(${stats.placed} placed, ${stats.with_party} with a party, ` +
      `${stats.with_money} with ЗОП money, ${stats.with_photo} with a photo)`,
  );
};

// Guarded so a test can import from this module without the loader firing — main() applies
// DDL against whatever DATABASE_URL is set, including a Cloud SQL proxy target left in the
// shell (see pinLocalDatabase in lib/pg.ts).
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(end);
}
