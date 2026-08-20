// The /governance/declarations hub's six tile figures, as one small committed JSON.
//
// WHY A BLOB (dashboard-hub skill §1). The hub fronts six leaderboards, each backed by its
// own matview. Rendering a count per tile live would be six queries on a page whose whole
// job is to point somewhere else, and the alternative — no figures at all, which is what
// shipped — leaves a reader unable to tell whether „Автомобили на депутати" is a page about
// forty cars or two thousand.
//
//   npx tsx scripts/db/gen_governance/declarations_hub_stats.ts
//
// ===========================================================================
// FIVE OF THE SIX FIGURES ARE NOT count(*) ON THE TILE'S TABLE, AND THE FIRST DRAFT OF THIS
// FILE GOT FOUR OF THEM WRONG — each arithmetically correct and false as a sentence.
// Measured 2026-08-07 against the live corpus; the numbers are here so the next reader can
// check them rather than trust the comment.
//
//   mp_cars_table            1,994 rows are NOT 1,994 cars. The table is PARTITIONED by
//                            `ns`, one partition per parliament PLUS an 'all' roll-up, so a
//                            car is counted once per parliament its owner sat in. The
//                            registry holds 621.
//   mp_assets_rankings_table 4,329 rows are NOT declaration-YEARS. Same partitioning: one
//                            row per (ns, mp_id), 2,207 per-NS + 2,122 in 'all'. The whole
//                            table spans 11 distinct period_year values, so "person-years"
//                            was a grain that does not exist anywhere in it.
//   company_politicians      the WRONG CORPUS for this tile. /mp/companies renders
//                            data/parliament/companies-index.json — 2,781 companies — while
//                            this table holds 346, of which the MP arm (kind='mp') is 62.
//                            The other 454 of its 521 links are kind='official'.
//   officials_rankings_table 19,036 rows, but /officials/assets sends
//                            fixedFilters [{is_exec:true}] and opens on 13,240; the 6,340
//                            municipal rows are reached from elsewhere.
//
// AND THE TWO MP TILES ARE PER-PARLIAMENT, not lifetime. /mp-assets and /mp-cars both
// `useState<MpAssetsScope>("ns")`, so they open filtered to the selected election's NS —
// and the hub tile preserves `?elections`, which would have guaranteed the mismatch on
// every parliament. `byNs` is therefore keyed exactly the way `mpAssetsNsScope()` keys its
// filter, 'all' included, and the hook mirrors that lookup.
// ===========================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, end } from "../lib/pg";
import { missingRelations, warnSkip } from "../gen_procurement/preflight";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const OUT = path.join(ROOT, "data/governance/declarations_hub_stats.json");

const RELATIONS = [
  "person_browse_table",
  "mp_assets_rankings_table",
  "mp_cars_table",
  "officials_rankings_table",
];

/** One parliament's slice of the two partitioned MP registries, keyed by `ns` exactly as
 *  `mpAssetsNsScope()` builds its filter value — the numeric NS ('52'), plus 'all'. */
export interface DeclarationsNsStats {
  /** MPs with at least one wealth row in that parliament. */
  mpsWithAssets: number;
  /** Declared vehicles, and the members holding them. */
  cars: number;
  carOwners: number;
}

export interface DeclarationsHubStats {
  computedAt: string;
  /** People the /persons browser LISTS on arrival — its default `tier = 'P'` floor. NOT
   *  the identity layer's 126,004, and not person_browse_table's 128,584. */
  people: number;
  /** Of those, how many have at least one filing — same tier floor, so the two numbers on
   *  the tile are over the same population. */
  peopleWithDeclaration: number;
  /** Officials /officials/assets opens on: its `is_exec` filter, NOT the table. */
  officials: number;
  /** Companies /mp/companies LISTS, from that page's own index, and the MPs attached to
   *  them. Deliberately not company_politicians — different corpus, 8x smaller. */
  /** Organisations /governance/companies LISTS — its own relation, `official_companies`
   *  (178). NOT „companies": 5,200 of them are сдружения, читалища, фондации, кооперации or
   *  държавни предприятия, and the tile's own copy names them. */
  organisations: number;
  /** DISTINCT people in public life attached to those organisations. Renamed from
   *  `companyMps`: the destination stopped being MP-only when it widened to every
   *  office-holder tier, and a field keeping the old name lies by name. */
  organisationPeople: number;
  /** Per-parliament, because both MP screens open scoped to the selected election. */
  byNs: Record<string, DeclarationsNsStats>;
}

const run = async (): Promise<void> => {
  const missing = await missingRelations(RELATIONS);
  if (missing.length) {
    warnSkip(
      "declarations_hub_stats",
      `missing ${missing.join(", ")}`,
      "run npm run db:refresh (or the loader for the named relation)",
    );
    await end();
    return;
  }

  const [row] = await allRows<Record<string, string>>(`
    SELECT
      -- THE DESTINATION'S BASIS, not the identity layer's. /persons applies
      -- defaultFilters [{tier:'P'}] — the public-figure floor — so it opens on 62,050 of
      -- the 128,584 rows here, and of 126,004 rows in the person table. All three are
      -- defensible answers to "how many people"; this is the one the page uses.
      (SELECT count(*) FROM person_browse_table WHERE tier LIKE '%P%')      AS people,
      (SELECT count(*) FROM person_browse_table
        WHERE tier LIKE '%P%' AND has_declaration)                         AS people_with_declaration,
      -- is_exec mirrors OfficialsAssetsScreen's fixedFilters. Without it the tile says
      -- 19,036 over a page listing 13,240.
      (SELECT count(*) FROM officials_rankings_table WHERE is_exec)        AS officials`);

  if (!row || Number(row.people) === 0) {
    warnSkip(
      "declarations_hub_stats",
      "person_browse_table has no public-tier rows",
      "run npm run db:load:persons-browse:pg",
    );
    await end();
    return;
  }

  // GROUP BY ns, never a whole-table count — see the header. The 'all' partition is a row
  // like any other here, so it needs no special case and cannot be double-counted.
  const cars = await allRows<Record<string, string>>(
    `SELECT ns, count(*) AS cars, count(DISTINCT mp_id) AS owners
       FROM mp_cars_table GROUP BY ns`,
  );
  const assets = await allRows<Record<string, string>>(
    `SELECT ns, count(DISTINCT mp_id) AS mps
       FROM mp_assets_rankings_table GROUP BY ns`,
  );

  const byNs: Record<string, DeclarationsNsStats> = {};
  const slot = (ns: string): DeclarationsNsStats =>
    (byNs[ns] ??= { mpsWithAssets: 0, cars: 0, carOwners: 0 });
  for (const r of assets) slot(r.ns).mpsWithAssets = Number(r.mps);
  for (const r of cars) {
    const s = slot(r.ns);
    s.cars = Number(r.cars);
    s.carOwners = Number(r.owners);
  }

  // ⚠️ THE TILE QUOTES ITS DESTINATION'S OWN RELATION, and that is the whole rule here.
  // It used to read data/parliament/companies-index.json because that WAS what
  // /mp/companies rendered; the destination is now /governance/companies over
  // `official_companies` (178), so this reads that. Reading anything else — company_politicians
  // is the standing temptation — would be counting a different corpus that happens to be about
  // the same subject, which is the trap the previous comment here was written for.
  //
  // person_count is per organisation and people repeat across them, so the headline needs a
  // DISTINCT recount over the two arms rather than a SUM of the column.
  let organisations = 0;
  let organisationPeople = 0;
  const ocMissing = await missingRelations(["official_companies"]);
  if (ocMissing.length) {
    // Absent on a database that has not applied 178. Both figures stay 0 and the hook OMITS
    // the tile's metric rather than rendering „0 организации", which would be a claim.
    warnSkip(
      "declarations_hub_stats",
      "official_companies absent — companies tile ships without a figure",
      "run npm run db:load:declarations:pg -- --resolve",
    );
  } else {
    const [oc] = await allRows<{ n: string; people: string }>(
      // ⚠️ THE PEOPLE RECOUNT MUST CARRY 178's TWO REGISTRY GUARDS. Re-deriving from
      // person_role alone drops the `tr_person_roles` name_fold join and the
      // `tr_name_fold_people.people_n = 1` fold gate, and publishes 14,870 against the
      // matview's 14,864 — six people the registry says are not uniquely identified by
      // their name, three of them on a fold it has not measured at all, which 148's rule
      // refuses rather than admits. The error is one-way: it can only ever overstate.
      //
      // A DISTINCT recount, never sum(person_count): people repeat across organisations, and
      // that column sums to 21,207.
      `SELECT count(*)::text AS n,
              (SELECT count(DISTINCT person_id)::text FROM (
                 SELECT ptr.person_id
                   FROM person_role ptr
                   JOIN person pe ON pe.person_id = ptr.person_id
                   JOIN tr_person_roles t
                     ON t.uic = ptr.ref AND t.name_fold = pe.name_fold
                   JOIN tr_name_fold_people f
                     ON f.name_fold = pe.name_fold AND f.people_n = 1
                  WHERE ptr.source IN ('tr','ngo')
                    AND ptr.confidence IN ('exact_id','high','manual')
                    AND pe.status = 'active' AND pe.is_public_figure
                 UNION
                 SELECT sc.person_id
                   FROM declaration_stake_company sc
                   JOIN person pe ON pe.person_id = sc.person_id
                  WHERE pe.status = 'active' AND pe.is_public_figure) z) AS people
         FROM official_companies`,
    );
    organisations = Number(oc.n);
    organisationPeople = Number(oc.people);
    if (organisations === 0) {
      // Applied but never built. Distinct from absent, and silent before this.
      warnSkip(
        "declarations_hub_stats",
        "official_companies is EMPTY — companies tile ships without a figure",
        "run npm run db:load:declarations:pg -- --resolve",
      );
    }
  }

  const out: DeclarationsHubStats = {
    computedAt: new Date().toISOString(),
    people: Number(row.people),
    peopleWithDeclaration: Number(row.people_with_declaration),
    officials: Number(row.officials),
    organisations,
    organisationPeople,
    byNs,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  const all = byNs.all;
  console.log(
    `declarations_hub_stats: ${out.people} people (${out.peopleWithDeclaration} with a filing) · ` +
      `${out.officials} exec officials · ${out.organisations} organisations/` +
      `${out.organisationPeople} people · ` +
      `${Object.keys(byNs).length} ns partitions (all: ${all?.mpsWithAssets} MPs, ${all?.cars} cars/${all?.carOwners} owners)`,
  );
  await end();
};

if (process.argv[1] && process.argv[1].includes("declarations_hub_stats")) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
