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
/** The /mp/companies destination's OWN fact source — the file that screen fetches. */
const COMPANIES_INDEX = path.join(ROOT, "data/parliament/companies-index.json");

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
  companies: number;
  companyMps: number;
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

  // The companies tile quotes the file its destination renders. Reading Postgres here would
  // be reading a DIFFERENT corpus that happens to be about the same subject — the exact
  // "destination counts a different set" trap, with an 8x gap.
  let companies = 0;
  let companyMps = 0;
  if (fs.existsSync(COMPANIES_INDEX)) {
    const idx = JSON.parse(fs.readFileSync(COMPANIES_INDEX, "utf8")) as {
      companies?: { mpRoles?: { mpId?: number }[] }[];
    };
    const list = idx.companies ?? [];
    companies = list.length;
    const mps = new Set<number>();
    for (const c of list)
      for (const r of c.mpRoles ?? []) if (r.mpId != null) mps.add(r.mpId);
    companyMps = mps.size;
  } else {
    // Absent on a checkout that has not run the parliament pipeline. Zero here means the
    // hook omits the figure, which is the honest render — not a tile claiming no companies.
    console.warn(
      `declarations_hub_stats: ${path.relative(ROOT, COMPANIES_INDEX)} absent — companies tile ships without a figure`,
    );
  }

  const out: DeclarationsHubStats = {
    computedAt: new Date().toISOString(),
    people: Number(row.people),
    peopleWithDeclaration: Number(row.people_with_declaration),
    officials: Number(row.officials),
    companies,
    companyMps,
    byNs,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  const all = byNs.all;
  console.log(
    `declarations_hub_stats: ${out.people} people (${out.peopleWithDeclaration} with a filing) · ` +
      `${out.officials} exec officials · ${out.companies} companies/${out.companyMps} MPs · ` +
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
