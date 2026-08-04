// Resolve every Commerce-Registry company's free-text seat to an EKATTE code
// and load the crosswalk (schema: 133_tr_company_place.sql) that backs the
// "фирми, регистрирани тук" tile on the settlement / municipality governance
// pages and /api/db/place-companies.
//
// INPUT is already in Postgres — this reads the DB and fetches nothing:
//   tr_companies.seat — "БЪЛГАРИЯ, с. Динково, 3921" on ~324k of 1.02M rows.
//
// RESOLUTION reuses EkatteResolver (scripts/procurement/resolve_ekatte.ts), the
// same one the procurement buyer-HQ pipeline uses: postal code first, then
// name+province, then a GLOBALLY UNIQUE name. An ambiguous name resolves to
// nothing rather than to a guess — placing a company in the wrong village is
// worse than not placing it, because the tile reads as a fact about that place.
//
// ORDER. Run after `db:load:tr:pg` (rebuilds BOTH tr_companies and
// company_politicians) and after any contracts / agri / funds reload — the
// table denormalizes company_public_money (127) and company_politicians (008)
// so the tile's top-N is an index scan rather than a whole-place sort (see the
// ranking note in 133). Both are therefore staleness inputs, not just the
// registry itself.
//
// Reload shape: UNLOGGED stage + MERGE (reference_stage_merge_reload), because
// the table is on a serving path — a TRUNCATE+rebuild would hold an
// AccessExclusiveLock for the whole load and 500 the tile at the pool's
// lock_timeout.
//
// Run: `npm run db:load:tr-company-place:pg` (local) / `:cloud` (Cloud SQL proxy).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec, allRows, withClient, withTx, end } from "./lib/pg";
import { copyRows } from "./lib/copy";
import {
  createStageTable,
  addStagePrimaryKey,
  mergeFromStage,
  type StageMergeSpec,
} from "./lib/stage_merge";
import { getResolver } from "../procurement/resolve_ekatte";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const SCHEMA = path.join(ROOT, "scripts/db/schema/pg/133_tr_company_place.sql");

const SPEC: StageMergeSpec = {
  table: "tr_company_place",
  source: "tr_company_place_stage",
  keys: ["uic"],
  cols: [
    "uic",
    "ekatte",
    "settlement",
    "obshtina",
    "municipality",
    "oblast",
    "is_village",
    "confidence",
    "name",
    "money_eur",
    "political_n",
  ],
};

/** Split a TR seat into the two fields the resolver wants. The feed is
 *  strikingly regular — "БЪЛГАРИЯ, <locality>, <postcode>" on 320,273 of
 *  324,359 seats, and the same minus the postcode on 4,059 more — so anything
 *  that does not fit that shape is left to the resolver's name arm rather than
 *  parsed harder. The locality keeps its "гр."/"с." marker: normName() inside
 *  the resolver strips it, and the marker is what disambiguates a town from a
 *  village of the same name in the postal arm. */
export const parseSeat = (
  seat: string,
): { locality: string; postalCode?: string } | null => {
  const parts = seat
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  // parts[0] is the country ("БЪЛГАРИЯ" on all but 10 rows).
  const locality = parts[1];
  if (!locality) return null;
  const tail = parts[2];
  const postalCode = tail && /^\d{4,5}$/.test(tail) ? tail : undefined;
  return { locality, postalCode };
};

export const loadTrCompanyPlacePg = async (): Promise<{
  rows: number;
  seated: number;
  unresolved: number;
}> => {
  await exec(readFileSync(SCHEMA, "utf8"));

  const companies = await allRows<{
    uic: string;
    name: string;
    seat: string | null;
  }>(
    `SELECT uic, name, seat FROM tr_companies WHERE seat IS NOT NULL AND seat <> ''`,
  );
  // The two denormalized ranking columns. Both tables are small (81k money
  // rows, ~500 political links) so this is two cheap full reads, not a join
  // per company.
  const money = new Map<string, number>();
  for (const r of await allRows<{ eik: string; public_money_eur: number }>(
    // No `> 0` filter: 127 can carry a NEGATIVE total (net of corrections —
    // one row today). Storing it verbatim keeps this table an exact mirror of
    // its source, which is what the drift gate checks; the tile's `moneyCount`
    // does the `> 0` filtering, so a negative still reads as "no public money".
    `SELECT eik, public_money_eur FROM company_public_money`,
  ))
    money.set(r.eik, r.public_money_eur);
  const political = new Map<string, number>();
  for (const r of await allRows<{ eik: string; n: string }>(
    `SELECT eik, count(*) AS n FROM company_politicians GROUP BY eik`,
  ))
    political.set(r.eik, Number(r.n));

  const resolver = getResolver();

  const rows: Array<
    [
      string,
      string,
      string | null,
      string | null,
      string | null,
      string | null,
      boolean | null,
      string,
      string,
      number,
      number,
    ]
  > = [];
  let unresolved = 0;
  for (const c of companies) {
    const addr = c.seat ? parseSeat(c.seat) : null;
    if (!addr) {
      unresolved++;
      continue;
    }
    const hit = resolver.resolve(addr);
    if (!hit.ekatte || !hit.matched) {
      unresolved++;
      continue;
    }
    rows.push([
      c.uic,
      hit.ekatte,
      hit.matched.name,
      hit.matched.obshtina_code,
      hit.matched.obshtina,
      hit.matched.province,
      hit.matched.is_village,
      hit.confidence,
      c.name,
      money.get(c.uic) ?? 0,
      political.get(c.uic) ?? 0,
    ]);
  }

  await withClient(async (c) => {
    await createStageTable(c, SPEC);
    await copyRows(c, SPEC.source, SPEC.cols, rows);
    await addStagePrimaryKey(c, SPEC);
  });
  await withTx(async (c) => {
    await mergeFromStage(c, SPEC);
  });
  await exec(`DROP TABLE IF EXISTS ${SPEC.source}`);

  return { rows: rows.length, seated: companies.length, unresolved };
};

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  loadTrCompanyPlacePg()
    .then(({ rows, seated, unresolved }) => {
      const pct = seated ? ((rows / seated) * 100).toFixed(1) : "0.0";
      console.log(
        `[tr-company-place] placed ${rows}/${seated} seated companies (${pct}%), ` +
          `${unresolved} unresolved (ambiguous or unparsable seat)`,
      );
      return end();
    })
    .catch(async (e) => {
      console.error(e);
      await end();
      process.exit(1);
    });
}
