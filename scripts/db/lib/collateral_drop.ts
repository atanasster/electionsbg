// The collateral-drop guard: which relations did a DDL apply DELETE and not put back?
//
// A migration that opens with `DROP … CASCADE` takes every dependent owned by OTHER
// migrations. Whoever applies it recreates only the files they named, so the rest are
// simply gone — and nothing fails, nothing logs, and no row count moves, because the
// counts that would have moved belong to relations that no longer exist. Measured twice on
// production: 2026-08-15 (a hand-run `apply_functions.ts 090_person_wealth.sql`) and
// 2026-08-19 (an aborted `db:load:declarations:pg:cloud -- --resolve`), each leaving
// /persons, /officials/assets, /mp-assets and /declarations/crypto answering 500.
//
// The check is a POST-CONDITION rather than a dependency parse: snapshot the public
// relations either side of the apply and report any that vanished. It is blind to HOW one
// went — CASCADE, a bare DROP, a rename — so a new migration cannot outgrow it.
//
// A retirement is not a defect. A vanished relation is reported only when some schema file
// still CREATEs it, so deleting a tombstoned matview's CREATE (025 / 031) retires it from
// the guard in the same edit, with no allowlist to keep in step.
//
// It lives here because there are TWO appliers of the same files and they must not disagree
// about what counts as a loss: `apply_functions.ts` (the hand-run hatch) and
// `load_declarations_pg.ts --resolve` (the path CLAUDE.md tells operators to use against
// Cloud SQL). The second had no guard at all until 2026-08-19.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows } from "./pg";

const SCHEMA_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../schema/pg",
);

/** Every relation a reader can lose: tables, views, matviews, partitioned tables. */
export const relationSnapshot = async (): Promise<Set<string>> =>
  new Set(
    (
      await allRows<{ relname: string }>(
        `SELECT c.relname
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relkind IN ('r', 'p', 'v', 'm')`,
      )
    ).map((r) => r.relname),
  );

/** Which schema file CREATEs `name`, if any still does. A relation no file creates has been
 *  retired on purpose (a tombstone DROP), and its disappearance is the intended outcome. */
export const creatorFile = (name: string): string | undefined =>
  fs
    .readdirSync(SCHEMA_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .find((f) =>
      new RegExp(
        `CREATE\\s+(?:UNLOGGED\\s+)?(?:MATERIALIZED\\s+VIEW|VIEW|TABLE)\\s+` +
          `(?:IF\\s+NOT\\s+EXISTS\\s+)?${name}\\b`,
        "i",
      ).test(fs.readFileSync(path.join(SCHEMA_DIR, f), "utf8")),
    );

export type CollateralDrop = { rel: string; owner: string };

/** Relations present in `before` that are gone now AND that some schema file still creates. */
export const collateralDrops = async (
  before: Set<string>,
): Promise<CollateralDrop[]> => {
  const after = await relationSnapshot();
  return [...before]
    .filter((r) => !after.has(r))
    .map((r) => ({ rel: r, owner: creatorFile(r) }))
    .filter((x): x is CollateralDrop => Boolean(x.owner));
};

/** Print the loss and the exact command that rebuilds it. Returns how many were lost, so a
 *  caller can decide between exiting non-zero and re-throwing the original failure.
 *
 *  `target` is a REDACTED url — the caller owns that, because the two appliers redact
 *  differently and a password in a log is not something a shared helper should guess at. */
export const reportCollateralDrops = (
  lost: CollateralDrop[],
  target: string,
): number => {
  if (lost.length === 0) return 0;
  const owners = [...new Set(lost.map((l) => l.owner))].sort();
  console.error(
    `\nCOLLATERAL DROP — ${lost.length} relation(s) this apply deleted and did not recreate:`,
  );
  for (const { rel, owner } of lost)
    console.error(`  ${rel}  (created by ${owner})`);
  console.error(
    `\nA DROP … CASCADE in one of the applied files took them. They are GONE from ` +
      `${target} and every route reading them answers 500 until they are rebuilt:\n\n` +
      `  DATABASE_URL=${target} npx tsx scripts/db/apply_functions.ts ${owners.join(" ")}\n\n` +
      `Check that order against each file's dependencies before running it, and add the ` +
      `owning files to the ORIGINAL command so the next apply is whole.`,
  );
  return lost.length;
};
