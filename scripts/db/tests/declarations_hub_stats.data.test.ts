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

interface Blob {
  people: number;
  peopleWithDeclaration: number;
  officials: number;
  organisations: number;
  organisationPeople: number;
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

test("the organisations figure comes from what /governance/companies renders", async (t) => {
  // ⚠️ THE TILE QUOTES ITS DESTINATION'S OWN RELATION. It used to quote
  // data/parliament/companies-index.json because that WAS what /mp/companies rendered; the
  // destination is now /governance/companies over `official_companies` (178). The rule did
  // not change — only which relation satisfies it.
  if (!(await dbReachable())) return t.skip();
  const blob = load();
  if (!blob) return t.skip();
  const [row] = await allRows<Record<string, string>>(
    `SELECT count(*)::text AS n FROM official_companies`,
  ).catch(() => [undefined as unknown as Record<string, string>]);
  if (!row) return t.skip();
  assert.equal(
    blob.organisations,
    Number(row.n),
    "organisations drifted from official_companies — the tile and its destination disagree",
  );
  // ⚠️ THE EXACT RECOUNT, carrying 178's TWO registry guards. The first version asserted
  // only `< sum(person_count)` (21,207), which admits anything in [0, 21206] — and that is
  // precisely how a 6-person overstatement shipped green: re-deriving from person_role alone
  // drops the tr_person_roles name_fold join and the tr_name_fold_people fold gate.
  const [people] = await allRows<Record<string, string>>(
    `SELECT count(DISTINCT person_id)::text AS n FROM (
       SELECT ptr.person_id
         FROM person_role ptr
         JOIN person pe ON pe.person_id = ptr.person_id
         JOIN tr_person_roles t ON t.uic = ptr.ref AND t.name_fold = pe.name_fold
         JOIN tr_name_fold_people f ON f.name_fold = pe.name_fold AND f.people_n = 1
        WHERE ptr.source IN ('tr','ngo')
          AND ptr.confidence IN ('exact_id','high','manual')
          AND pe.status = 'active' AND pe.is_public_figure
       UNION
       SELECT sc.person_id
         FROM declaration_stake_company sc
         JOIN person pe ON pe.person_id = sc.person_id
        WHERE pe.status = 'active' AND pe.is_public_figure) z`,
  );
  assert.equal(
    blob.organisationPeople,
    Number(people.n),
    "organisationPeople drifted from the gated recount — check the fold gate is still joined",
  );
  // And still not a SUM: people repeat across organisations.
  const [sum] = await allRows<Record<string, string>>(
    `SELECT coalesce(sum(person_count),0)::text AS s FROM official_companies`,
  );
  assert.ok(
    blob.organisationPeople < Number(sum.s),
    "organisationPeople equals the SUM of person_count — it must be a DISTINCT recount",
  );
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
  assert.notEqual(blob.organisations, Number(row.cp_companies));
  assert.notEqual(blob.organisationPeople, Number(row.cp_links));
});
