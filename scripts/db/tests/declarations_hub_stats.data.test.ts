// The /governance/declarations hub blob's declared bases (dashboard-hub skill §0, §8).
//
// THE FIRST VERSION OF THIS FILE LOCKED THE BUGS IN. It re-ran the generator's own SQL and
// compared it to the generator's own output, so it could only ever prove the file was
// freshly written; its "these figures are not row counts" block then asserted
// `mpAssetYears == count(*)` — pinning the wrong grain — and `cars > carOwners`, which is
// true whether cars is 621 or the 1,994 that counts each vehicle once per parliament.
//
// So every assertion below is written against something the GENERATOR DOES NOT USE: the
// destination screen's own filter, the partition structure, or the file the destination
// fetches. A gate that shares the generator's misunderstanding cannot catch it.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { allRows, dbReachable, end } from "../lib/pg";

const BLOB = "data/governance/declarations_hub_stats.json";
const COMPANIES_INDEX = "data/parliament/companies-index.json";

interface Blob {
  people: number;
  peopleWithDeclaration: number;
  officials: number;
  companies: number;
  companyMps: number;
  byNs: Record<
    string,
    { mpsWithAssets: number; cars: number; carOwners: number }
  >;
}

const load = (): Blob | null =>
  existsSync(BLOB) ? (JSON.parse(readFileSync(BLOB, "utf8")) as Blob) : null;

afterAll(async () => {
  await end();
});

test("the two MP registries are partitioned by ns — a whole-table count is never a figure", async (t) => {
  if (!(await dbReachable())) return t.skip();
  const blob = load();
  if (!blob) return t.skip();

  const [row] = await allRows<Record<string, string>>(`
    SELECT (SELECT count(*) FROM mp_cars_table)                       AS cars_all_partitions,
           (SELECT count(*) FROM mp_cars_table WHERE ns = 'all')      AS cars_registry,
           (SELECT count(DISTINCT ns) FROM mp_cars_table)             AS car_partitions,
           (SELECT count(*) FROM mp_assets_rankings_table)            AS asset_all_partitions,
           (SELECT count(DISTINCT mp_id) FROM mp_assets_rankings_table
             WHERE ns = 'all')                                        AS asset_registry`);

  // The structural fact the first draft missed. If this ever stops holding, the partitioning
  // changed and every figure below needs re-deriving — which is what the assert says.
  assert.ok(
    Number(row.car_partitions) > 1,
    "mp_cars_table is no longer partitioned by ns — re-derive the blob's grain",
  );
  assert.ok(
    Number(row.cars_all_partitions) > Number(row.cars_registry),
    "the per-ns partitions no longer duplicate the roll-up; this gate is now blind",
  );

  assert.equal(
    blob.byNs.all.cars,
    Number(row.cars_registry),
    "the 'all' slice must be the ns='all' partition, not the table",
  );
  assert.notEqual(
    blob.byNs.all.cars,
    Number(row.cars_all_partitions),
    "cars is the whole-table count again — that counts a car once per parliament",
  );
  assert.equal(blob.byNs.all.mpsWithAssets, Number(row.asset_registry));
  assert.notEqual(
    blob.byNs.all.mpsWithAssets,
    Number(row.asset_all_partitions),
    "mpsWithAssets is the whole-table count again",
  );
});

test("every ns partition present in Postgres is present in the blob", async (t) => {
  if (!(await dbReachable())) return t.skip();
  const blob = load();
  if (!blob) return t.skip();

  const rows = await allRows<{ ns: string; mps: string }>(
    `SELECT ns, count(DISTINCT mp_id)::text AS mps
       FROM mp_assets_rankings_table GROUP BY ns`,
  );
  for (const r of rows) {
    // A missing key would leave that parliament's tile bare — an honest render, but for the
    // wrong reason, and invisible unless someone selects that election.
    assert.ok(
      blob.byNs[r.ns],
      `blob is missing the ns='${r.ns}' slice — regenerate it`,
    );
    assert.equal(blob.byNs[r.ns].mpsWithAssets, Number(r.mps));
  }
});

test("people and officials quote their DESTINATION's filter, not their table", async (t) => {
  if (!(await dbReachable())) return t.skip();
  const blob = load();
  if (!blob) return t.skip();

  const [row] = await allRows<Record<string, string>>(`
    SELECT (SELECT count(*) FROM person_browse_table WHERE tier LIKE '%P%') AS listed,
           (SELECT count(*) FROM person_browse_table)                       AS browse_rows,
           (SELECT count(*) FROM person)                                    AS identity_rows,
           (SELECT count(*) FROM officials_rankings_table WHERE is_exec)    AS exec_officials,
           (SELECT count(*) FROM officials_rankings_table)                  AS official_rows`);

  assert.equal(blob.people, Number(row.listed));
  // Both alternatives named explicitly, because both are defensible answers to "how many
  // people" and either would pass a bare equality against itself.
  assert.notEqual(blob.people, Number(row.browse_rows));
  assert.notEqual(blob.people, Number(row.identity_rows));

  assert.equal(blob.officials, Number(row.exec_officials));
  assert.notEqual(
    blob.officials,
    Number(row.official_rows),
    "officials dropped the is_exec filter — /officials/assets lists fewer than that",
  );

  assert.ok(blob.peopleWithDeclaration < blob.people);
});

test("the companies figure comes from the file /mp/companies renders", (t) => {
  const blob = load();
  if (!blob || !existsSync(COMPANIES_INDEX)) return t.skip();

  const idx = JSON.parse(readFileSync(COMPANIES_INDEX, "utf8")) as {
    companies: { mpRoles?: { mpId?: number }[] }[];
  };
  assert.equal(
    blob.companies,
    idx.companies.length,
    "companies drifted from companies-index.json — the tile and its destination disagree",
  );
  const mps = new Set<number>();
  for (const c of idx.companies)
    for (const r of c.mpRoles ?? []) if (r.mpId != null) mps.add(r.mpId);
  assert.equal(blob.companyMps, mps.size);
});

test("the companies figure is NOT company_politicians", async (t) => {
  if (!(await dbReachable())) return t.skip();
  const blob = load();
  if (!blob) return t.skip();

  // The corpus the first draft used. Kept as an explicit negative because the two are about
  // the same subject and the mistake is a one-word edit away.
  const [row] = await allRows<Record<string, string>>(`
    SELECT (SELECT count(DISTINCT eik) FROM company_politicians)  AS cp_companies,
           (SELECT count(*) FROM company_politicians)             AS cp_links`);
  assert.notEqual(blob.companies, Number(row.cp_companies));
  assert.notEqual(blob.companyMps, Number(row.cp_links));
});
