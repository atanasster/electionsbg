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
import { reportSkip } from "../../lib/report_skip";
import { assertCommitted } from "../../lib/assert_committed";

const BLOB = "data/governance/declarations_hub_stats.json";

interface TopNetWorth {
  slug: string;
  name: string;
  netWorthEur: number;
  year: number;
}

interface Blob {
  topNetWorth?: TopNetWorth[];
  topNetWorthYears?: { first: number; last: number } | null;
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

const skipDb = !(await dbReachable()) ? "Postgres unreachable" : false;
reportSkip(import.meta.url, skipDb);
// Hoisted so the FILE reports as skipped rather than passed — `load()` is pure and
// module-scope-safe, so there was no reason for these five to stay in-body.
const skipBlob =
  skipDb ||
  (!load()
    ? "the declarations hub-stats blob is absent — run npm run db:gen-declarations-hub-stats"
    : false);
reportSkip(import.meta.url, skipBlob !== skipDb ? skipBlob : false);

// OUTSIDE any gate, deliberately — these are COMMITTED, so absence is a broken
// working copy rather than a supported state. See scripts/lib/assert_committed.ts.
assertCommitted("data/governance/declarations_hub_stats.json");

test.skipIf(skipBlob)(
  "the two MP registries are partitioned by ns — a whole-table count is never a figure",
  async (t) => {
    const blob = load();
    if (!blob) {
      reportSkip(
        import.meta.url,
        "the declarations hub-stats blob is absent — run npm run db:gen-declarations-hub-stats",
      );
      return t.skip();
    }

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
  },
);

test.skipIf(skipBlob)(
  "every ns partition present in Postgres is present in the blob",
  async (t) => {
    const blob = load();
    if (!blob) {
      reportSkip(
        import.meta.url,
        "the declarations hub-stats blob is absent — run npm run db:gen-declarations-hub-stats",
      );
      return t.skip();
    }

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
  },
);

test.skipIf(skipBlob)(
  "people and officials quote their DESTINATION's filter, not their table",
  async (t) => {
    const blob = load();
    if (!blob) {
      reportSkip(
        import.meta.url,
        "the declarations hub-stats blob is absent — run npm run db:gen-declarations-hub-stats",
      );
      return t.skip();
    }

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
  },
);

test.skipIf(skipBlob)(
  "the organisations figure comes from what /companies?political=1 renders",
  async (t) => {
    // ⚠️ THE TILE QUOTES ITS DESTINATION'S OWN RELATION. It used to quote
    // data/parliament/companies-index.json because that WAS what /mp/companies rendered; the
    // destination is now /companies?political=1 over `company_browse_table` (188) WHERE
    // is_official_linked, formerly official_companies' (178) whole relation. The rule did not
    // change — only which relation satisfies it.
    const blob = load();
    if (!blob) {
      reportSkip(
        import.meta.url,
        "the declarations hub-stats blob is absent — run npm run db:gen-declarations-hub-stats",
      );
      return t.skip();
    }
    const [row] = await allRows<Record<string, string>>(
      `SELECT count(*)::text AS n FROM company_browse_table WHERE is_official_linked`,
    ).catch(() => [undefined as unknown as Record<string, string>]);
    if (!row) {
      reportSkip(
        import.meta.url,
        "company_browse_table is absent — run npm run db:load:declarations:pg -- --resolve",
      );
      return t.skip();
    }
    assert.equal(
      blob.organisations,
      Number(row.n),
      "organisations drifted from company_browse_table — the tile and its destination disagree",
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
      `SELECT coalesce(sum(person_count),0)::text AS s
       FROM company_browse_table WHERE is_official_linked`,
    );
    assert.ok(
      blob.organisationPeople < Number(sum.s),
      "organisationPeople equals the SUM of person_count — it must be a DISTINCT recount",
    );
  },
);

test.skipIf(skipBlob)(
  "the companies figure is NOT company_politicians",
  async (t) => {
    const blob = load();
    if (!blob) {
      reportSkip(
        import.meta.url,
        "the declarations hub-stats blob is absent — run npm run db:gen-declarations-hub-stats",
      );
      return t.skip();
    }

    // The corpus the first draft used. Kept as an explicit negative because the two are about
    // the same subject and the mistake is a one-word edit away.
    const [row] = await allRows<Record<string, string>>(`
    SELECT (SELECT count(DISTINCT eik) FROM company_politicians)  AS cp_companies,
           (SELECT count(*) FROM company_politicians)             AS cp_links`);
    assert.notEqual(blob.organisations, Number(row.cp_companies));
    assert.notEqual(blob.organisationPeople, Number(row.cp_links));
  },
);

test.skipIf(skipBlob)(
  "the evidence rail IS /officials/assets' own first rows",
  async (t) => {
    const blob = load();
    if (!blob) {
      reportSkip(
        import.meta.url,
        "the declarations hub-stats blob is absent — run npm run db:gen-declarations-hub-stats",
      );
      return t.skip();
    }
    if (!blob.topNetWorth?.length) {
      reportSkip(
        import.meta.url,
        "the blob predates the evidence rail — re-run npm run db:gen-declarations-hub-stats",
      );
      return t.skip();
    }

    // ⚠️ THE DESTINATION'S FILTER AND SORT, written out here rather than imported from the
    // generator — a gate re-running the generator's own SQL can only prove the file was
    // freshly written (see this file's header). `OfficialsAssetsScreen` renders this matview
    // with fixedFilters [{is_exec:true}] and defaultSort [{net_worth_eur, desc}]; if either
    // moves, the rail stops being that page's first rows while its heading keeps naming it.
    const want = await allRows<Record<string, string>>(`
      SELECT slug, round(net_worth_eur)::text AS net,
             round(total_assets_eur)::text AS gross,
             latest_declaration_year::text AS year
        FROM officials_rankings_table
       WHERE is_exec AND net_worth_eur IS NOT NULL
         AND excluded_asset_rows = 0
       ORDER BY net_worth_eur DESC, slug
       LIMIT 5`);

    assert.equal(
      want.length,
      5,
      "the matview returned fewer than five rankable rows — every comparison below would " +
        "then be trivially satisfiable",
    );

    assert.deepEqual(
      blob.topNetWorth.map((r) => r.slug),
      want.map((r) => r.slug),
      "the rail is not /officials/assets' first five — check its filter and sort",
    );
    for (const [i, r] of blob.topNetWorth.entries())
      assert.equal(
        r.netWorthEur,
        Number(want[i].net),
        `row ${i} value drifted`,
      );

    // ⚠️ NET, NOT GROSS — no set or order comparison can tell them apart here. Measured
    // 2026-08-26, sorting by total_assets_eur yields the SAME five slugs in the same order,
    // so a generator that switched sort keys passes every comparison above. What separates
    // them is the VALUE: two of the five carry real debts, so at least one row must disagree
    // with the gross column or the rail is publishing assets under a „minus задължения" basis.
    const differs = blob.topNetWorth.filter(
      (r, i) => r.netWorthEur !== Number(want[i].gross),
    );
    assert.ok(
      differs.length > 0,
      "every rail row equals total_assets_eur — the rail may be publishing GROSS assets " +
        "under a net-worth basis, or every top declarant now reports zero debts",
    );

    // ⚠️ EACH ROW'S YEAR AGAINST THE MATVIEW, not against the blob's own copy of itself.
    // The year is rendered ON the row („· 2021"), and deriving the check from the blob is
    // circular: projecting some other integer column as `year` is self-consistent and every
    // span assertion still passes, while the rail publishes „· 0" beside a named person.
    for (const [i, r] of blob.topNetWorth.entries())
      assert.equal(
        r.year,
        Number(want[i].year),
        `row ${i} (${r.slug}) is dated ${r.year}, but its filing is ${want[i].year}`,
      );

    const years = blob.topNetWorth.map((r) => r.year);
    assert.ok(
      blob.topNetWorthYears,
      "rows without a span — the aside refuses to render, so the head loses its rail",
    );
    assert.equal(blob.topNetWorthYears!.first, Math.min(...years));
    assert.equal(blob.topNetWorthYears!.last, Math.max(...years));

    // ⚠️ NON-VACUITY, and the reason the plural basis wording exists: these are each
    // person's LATEST filing, so they legitimately mix vintages. Were they ever to agree,
    // the singular wording would be the honest one — this is here so that becoming a
    // single-year rail is a decision rather than a silent drift.
    assert.ok(
      new Set(years).size > 1,
      "every rail row shares a year — re-check whether the singular basis wording applies",
    );

    const vals = blob.topNetWorth.map((r) => r.netWorthEur);
    assert.deepEqual(
      vals,
      [...vals].sort((a, b) => b - a),
    );
  },
);

// No DB and no blob: this reads a source file, so it must run everywhere.
test("the rail's invariant still rests on what /officials/assets actually does", () => {
  // ⚠️ THE GATE ABOVE CHECKS ONLY OUR SIDE. The rail's whole claim — that these are that
  // page's first rows — is a joint property of the generator's query AND the screen's
  // config, and the screen is the half nothing else here can see. A fixedFilters or
  // defaultSort edit there silently turns the rail into five people the destination does
  // not open on, under a heading naming it.
  //
  // Read as SOURCE rather than executed: the screen is a React component this node-side
  // gate cannot render, and both values are literals.
  const screen = readFileSync("src/screens/OfficialsAssetsScreen.tsx", "utf8");
  assert.match(
    screen,
    /fixedFilters[\s\S]{0,200}\{ id: "is_exec", value: true \}/,
    "/officials/assets no longer fixes is_exec — the rail's population clause (the " +
      "register minus municipal officials) may no longer describe its rows",
  );
  assert.match(
    screen,
    /defaultSort=\{\[\{ id: "net_worth_eur", desc: true \}\]\}/,
    "/officials/assets no longer opens sorted by net worth — the rail is no longer its " +
      "first rows",
  );
});
