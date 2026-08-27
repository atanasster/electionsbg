// The /procurement hub blob's SOURCE OF TRUTH: which scopes exist, and how one scope's
// figures are read out of Postgres.
//
// WHY IT IS ITS OWN MODULE. Two consumers need exactly this and nothing else — the
// generator (`hub_stats.ts`, which writes the committed artifact) and the freshness gate
// (`scripts/db/tests/procurement_hub_stats.data.test.ts`, which re-derives and compares).
// Importing the generator itself is not an option: it calls `main()` at module scope and
// ends with `process.exit(0)`, so an import would WRITE the artifact and then kill the
// importing process — a test that regenerates the file it is supposed to be checking would
// pass unconditionally, which is the worst failure available here.
//
// ⚠️ AND A SECOND COPY IN THE GATE WOULD BE WORSE THAN USELESS. A gate that re-implements
// the four function calls, the field mapping and the window arithmetic asserts that two
// implementations agree, not that the artifact matches the corpus — and the moment they
// drift it reports a failure in whichever half is wrong. The single definition is the point.
//
// Nothing here writes, reads a file, or exits.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows } from "../lib/pg";
import type { HubStat } from "../../../src/data/procurement/useProcurementHubStats";
import {
  newestFirst,
  parliamentWindow,
  type ElectionRef,
} from "../../../src/data/scope/windows";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const ELECTIONS = path.join(ROOT, "src/data/json/elections.json");

/** The committed artifact both consumers are about. */
export const HUB_STATS_PATH = "data/procurement/derived/hub_stats.json";

/** One scope: the key the frontend computes, and the window it means. */
export interface HubScope {
  key: string;
  from: string | null;
  to: string | null;
}

/**
 * Every scope the blob carries: `all`, one per parliament, one per contract year.
 *
 * ⚠️ `newestFirst` + `parliamentWindow` rather than a local copy of the formula — the
 * per-parliament window reads the NEXT-newer election, which is only correct while the
 * source is sorted. `src/data/scope/windows` is the one definition the React hook and every
 * other scoped precompute share.
 */
export const hubScopes = async (): Promise<HubScope[]> => {
  const elections = newestFirst(
    JSON.parse(fs.readFileSync(ELECTIONS, "utf8")) as ElectionRef[],
  );
  const yearRows = (await allRows(
    "SELECT DISTINCT left(date,4) AS y FROM contracts WHERE date >= '2011' ORDER BY y",
    [],
  )) as { y: string }[];

  const scopes: HubScope[] = [{ key: "all", from: null, to: null }];
  for (const e of elections) {
    const { from, to } = parliamentWindow(elections, e.name);
    scopes.push({ key: `ns:${e.name}`, from, to });
  }
  for (const { y } of yearRows) {
    const year = Number(y);
    if (!Number.isFinite(year)) continue;
    scopes.push({
      key: `y:${year}`,
      from: `${year}-01-01`,
      to: `${year + 1}-01-01`,
    });
  }
  return scopes;
};

/**
 * One scope's figures, straight from the four scoped serving functions.
 *
 * ⚠️ `topAwarders[].name` is the RAW alias `procurement_overview()` returns, which the
 * generator overwrites afterwards via `commonestNames()`. So this function's `name` is not
 * what the committed blob holds, and a consumer comparing names against it will see a
 * difference that is not drift. The gate compares `eik` and `eur` only, and says so.
 */
export const hubStatFor = async (
  from: string | null,
  to: string | null,
): Promise<HubStat> => {
  const [ov] = (await allRows("SELECT procurement_overview($1,$2) AS r", [
    from,
    to,
  ])) as {
    r: {
      totals: Record<string, number>;
      topAwarders?: { eik: string; name: string; totalEur: number }[];
    };
  }[];
  const [hc] = (await allRows("SELECT procurement_hub_counts($1,$2) AS r", [
    from,
    to,
  ])) as {
    r: { tenders: number; appeals: number; ngos: number };
  }[];
  const [rf] = (await allRows("SELECT procurement_risk_feed($1,$2) AS r", [
    from,
    to,
  ])) as {
    r: { concentrationTotal: number };
  }[];
  const [bs] = (await allRows("SELECT procurement_by_settlement($1,$2) AS r", [
    from,
    to,
  ])) as {
    r: { settlementCount: number };
  }[];
  const t = ov.r.totals;
  return {
    totalEur: t.totalEur ?? 0,
    contracts: (t.contracts ?? 0) + (t.amendments ?? 0),
    contractors: t.contractorCount ?? 0,
    connected: (t.mpCount ?? 0) + (t.officialCount ?? 0),
    tenders: hc.r.tenders ?? 0,
    appeals: hc.r.appeals ?? 0,
    ngos: hc.r.ngos ?? 0,
    flags: rf.r.concentrationTotal ?? 0,
    places: bs.r.settlementCount ?? 0,
    awarderCount: t.awarderCount ?? 0,
    // Trimmed to the three fields the head renders. The payload carries contractCount too,
    // which nothing on the hub shows — and an unused field in a blob every visitor downloads
    // is the regrowth the byte budget exists to stop.
    topAwarders: (ov.r.topAwarders ?? []).slice(0, 3).map((a) => ({
      eik: a.eik,
      name: a.name,
      eur: Math.round(a.totalEur ?? 0),
    })),
  };
};

/**
 * The SCALAR fields, named once so the gate cannot compare a subset by accident.
 *
 * ⚠️ TEN, NOT NINE. The plan that produced this gate said "nine fields" throughout and the
 * pre-execution drift check covered six of them — which is how `connected` drifting across
 * 15 scopes went unnoticed by the very measurement arguing a subset would do. Deriving the
 * list from the type is not possible at runtime, so it is written out here ONCE and the gate
 * asserts it covers every scalar key actually present in the blob.
 */
export const HUB_SCALAR_FIELDS = [
  "totalEur",
  "contracts",
  "contractors",
  "connected",
  "tenders",
  "appeals",
  "ngos",
  "flags",
  "places",
  "awarderCount",
] as const satisfies readonly (keyof HubStat)[];
