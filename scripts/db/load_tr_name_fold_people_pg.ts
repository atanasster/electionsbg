// Load tr_name_fold_people (migration 148) from the committed
// data/person/tr_name_fold_people.tsv. Plan: docs/plans/tr-attribution-basis-v1.md §2.4.
//
//   npm run db:load:tr-name-fold-people:pg          (local)
//   npm run db:load:tr-name-fold-people:pg:cloud    (Cloud SQL proxy)
//
// WHAT THIS TABLE DECIDES. It is how many DISTINCT people the Commerce Registry itself records
// under a name fold, and `resolve_persons` reads it to decide whether a public figure may be
// given the companies registered to their name. A fold answering "1" mints; "2 or more" and
// "never observed" both refuse.
//
// SO THE INPUT IS COMMITTED, NOT CRAWLED. `npm run tr:count-people` mints the TSV from the
// gitignored 15 GB TR feed on a machine that has one; everyone else — a fresh clone, CI, Cloud
// SQL — loads the same file. That is the point: a guard that is present on one database and
// absent on another publishes MORE on the machine without it, which is the "green locally,
// different on prod" class this repo keeps paying for.
//
// ORDER: before db:resolve:persons. refresh_coverage.test.ts holds it; run first and the table
// is empty, so every fold reads as unmeasured and Bridge B mints nothing at all.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec, withTx, allRows, vacuumAfterReload, end } from "./lib/pg";
import { copyRows } from "./lib/copy";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const SCHEMA = path.join(
  ROOT,
  "scripts/db/schema/pg/148_person_company_basis.sql",
);
const SRC = path.join(ROOT, "data/person/tr_name_fold_people.tsv");

/** Rows parsed from the artifact, and the malformed lines rejected.
 *
 *  Exported for the unit test: the parser is the only place a bad line can become a wrong
 *  COUNT rather than an error, and a wrong count of 1 is the value that fails OPEN. */
export const parseTsv = (
  text: string,
): { rows: [string, number][]; bad: string[] } => {
  const rows: [string, number][] = [];
  const bad: string[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    const tab = line.indexOf("\t");
    // indexOf, not split: a fold containing a tab would silently become a 3-column row, and
    // `Number(cols[1])` would then read the wrong field. Here it lands in `bad` instead.
    if (tab <= 0) {
      bad.push(line);
      continue;
    }
    const fold = line.slice(0, tab);
    const rest = line.slice(tab + 1);
    const n = Number(rest);
    if (!/^[1-9]\d*$/.test(rest) || !Number.isSafeInteger(n)) {
      bad.push(line);
      continue;
    }
    rows.push([fold, n]);
  }
  return { rows, bad };
};

const main = async (): Promise<void> => {
  await exec(fs.readFileSync(SCHEMA, "utf8"));

  if (!fs.existsSync(SRC)) {
    // Absent-safe, like the other committed-artifact loaders: applying the DDL and stopping
    // leaves an EMPTY table, which the resolver reads as "every fold unmeasured" and refuses
    // to mint on — the safe direction. It still exits non-zero, because on a normal checkout
    // this file IS committed, so its absence means something is wrong.
    console.error(
      `missing ${path.relative(ROOT, SRC)} — it is committed, so this is not a fresh-clone ` +
        `state. Mint it with \`npm run tr:count-people\` (needs raw_data/tr/daily).`,
    );
    process.exitCode = 1;
    return;
  }

  const { rows, bad } = parseTsv(fs.readFileSync(SRC, "utf8"));
  if (bad.length)
    throw new Error(
      `${bad.length} malformed line(s) in ${path.relative(ROOT, SRC)} — refusing to load a ` +
        `partially-parsed guard table. First: ${JSON.stringify(bad[0])}`,
    );
  if (!rows.length)
    throw new Error(`${path.relative(ROOT, SRC)} parsed to zero rows`);

  // ⚠️ GUARD THE SHARED COUNT, NOT JUST THE ROW COUNT. The row count is the wrong number to
  // watch here and the distinction is the whole safety argument: an UNDER-count does not
  // remove folds, it moves them from `people_n > 1` to `people_n = 1`. A damaged upstream pass
  // can hold all 456,398 rows while taking the shared set from 23,174 to nearly zero — the row
  // guard passes, the counter's own writeRefusal() passes, and step 6's Bridge B then mints on
  // ~23k folds that hold two people each, which is the exact defect this table exists to stop.
  // So both numbers are checked, and both BEFORE the write.
  const [before] = await allRows<{ n: string; shared: string }>(
    `SELECT count(*) n, count(*) FILTER (WHERE people_n > 1) shared
       FROM tr_name_fold_people`,
  );
  const prev = Number(before.n);
  const prevShared = Number(before.shared);
  const nextShared = rows.filter(([, n]) => n > 1).length;
  const FLOOR = 0.95;
  if (prev && rows.length < prev * FLOOR)
    throw new Error(
      `refusing to shrink tr_name_fold_people from ${prev.toLocaleString()} to ` +
        `${rows.length.toLocaleString()} rows. Re-mint with ` +
        `\`npm run tr:count-people\` before loading.`,
    );
  if (prevShared && nextShared < prevShared * FLOOR)
    throw new Error(
      `refusing to load: folds shared by 2+ registry people fall from ` +
        `${prevShared.toLocaleString()} to ${nextShared.toLocaleString()} while the row count ` +
        `holds. That is an UNDER-COUNT, which fails OPEN — every fold that stops reading ">1" ` +
        `starts reading "one person", and Bridge B mints a namesake's companies onto a named ` +
        `public figure. Re-mint with \`npm run tr:count-people\` and check its summary line.`,
    );

  // TRUNCATE + COPY in ONE transaction. The table is read by db:resolve:persons, never by a
  // serving path, so the AccessExclusiveLock costs a concurrent resolve and nothing a user
  // can see — and an aborted load rolls back to the previous vintage rather than leaving the
  // guard half-loaded, which is the state that would silently start minting.
  const n = await withTx(async (c) => {
    await c.query("TRUNCATE tr_name_fold_people");
    return copyRows(c, "tr_name_fold_people", ["name_fold", "people_n"], rows);
  });

  // TRUNCATE mints a new relfilenode with an EMPTY visibility map, and every page is then
  // written by a transaction that has not committed — so nothing is marked all-visible and
  // Postgres can never plan an index-only scan on this table again. Run standalone the
  // insert-threshold autovacuum usually repairs it; inside db:refresh the NEXT step
  // (db:resolve:persons) holds a long snapshot, so the autovacuum marks nothing and never
  // revisits. Outside the transaction: VACUUM cannot run in one.
  await vacuumAfterReload("tr_name_fold_people");

  const [shared] = await allRows<{ n: string }>(
    "SELECT count(*) n FROM tr_name_fold_people WHERE people_n > 1",
  );
  console.log(
    `tr_name_fold_people: ${n.toLocaleString()} folds ` +
      `(${Number(shared.n).toLocaleString()} shared by 2+ registry people)`,
  );
};

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => end());
