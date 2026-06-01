/**
 * Precompute Pearson correlations between each leading party's local-election
 * vote share and every Census 2021 demographic indicator, per cycle. The local
 * analogue of scripts/parties/build_demographics.ts.
 *
 * Two signals, one per race that yields a continuous per-municipality party
 * share:
 *   - COUNCIL (общински съвет) — the proportional party-list vote.
 *   - MAYOR (кмет на община) — the first-round (R1) vote summed per party.
 *     Voters pick a person, but each candidate carries a party label, so a
 *     party's R1 mayoral share across municipalities is still a continuous
 *     signal to correlate. R1 (not R2) is used because every município has it,
 *     whereas runoffs exist only in a biased subset.
 *
 * Output, per `_mi` cycle:
 *   dashboard/demographic_cleavages.json        — top council parties × metrics
 *   dashboard/demographic_cleavages_mayor.json  — top mayoral parties × metrics
 * each with a pre-computed spread per row, consumed by LocalDemographicCleavagesTile.
 *
 * Correlations run across the ~265 municipalities (obshtini). Sofia is the
 * synthetic `SOF` city-wide bundle (mapped to census SOF46); its 24 район
 * shards (S2***) are skipped so the city is counted once — for mayors this also
 * drops the район-mayor races, which are a separate sub-municipal contest.
 * Reuses the census share + Pearson helpers from the parliamentary build so the
 * maths can't drift.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type {
  CensusMetric,
  CensusMunicipalityEntity,
  CensusPayload,
} from "@/data/census/censusTypes";
import {
  PERCENT_METRICS,
  censusMetricShare,
  pearson,
  round3,
} from "../parties/build_demographics";
import { INDEPENDENT_CANONICAL_ID } from "./local_coalitions";
import type {
  LocalCouncilParty,
  LocalMayorResult,
  LocalMunicipalityBundle,
} from "./types";

const SOFIA_CITY_CENSUS_CODE = "SOF46";
const isSofiaRayonCode = (code: string) => /^S2\d{3}$/.test(code);

// Only the leading parties get a dot. Threshold mirrors the Bulgarian
// 4% electoral barrier; the per-municipality guard drops single-município
// local lists (e.g. a Sofia-only ticket) whose share would clear 4% nationally
// but carries no cross-municipal signal to correlate. Catch-all independents
// (Инициативни комитети) are excluded — that bucket isn't a coherent party.
const THRESHOLD_PCT = 4;
const MIN_MUNIS = 20;
const MAX_PARTIES = 6;

// Same bucketing rule used by build_index_json's council rollup: canonical
// lineage when known, else the independent catch-all, else a per-name local
// bucket (consistent across municipalities, so a broad local list — e.g. 2015
// БСП registered under a local name — still aggregates).
const councilBucketId = (party: LocalCouncilParty): string => {
  if (party.primaryCanonicalId) return party.primaryCanonicalId;
  if (party.isIndependent) return INDEPENDENT_CANONICAL_ID;
  return `local:${party.localPartyName.toLocaleLowerCase("bg")}`;
};

// Mayor bucketing mirrors build_index_json's mayorsByCanonical (independent
// first), so the per-município aggregation keys line up with the national
// mayoral rollup's display-name/colour lookup.
const mayorBucketId = (m: LocalMayorResult): string => {
  if (m.isIndependent) return INDEPENDENT_CANONICAL_ID;
  if (m.primaryCanonicalId) return m.primaryCanonicalId;
  return `local:${m.localPartyName.toLocaleLowerCase("bg")}`;
};

export type LocalDemographicCleavageParty = {
  canonicalId: string;
  displayName: string;
  color?: string;
  // National vote share (0..100) for the race, so the tile can show salience.
  pctNational: number;
};

export type LocalDemographicCleavageRow = {
  metric: CensusMetric;
  // r per party, in the same order as `parties` below.
  rs: number[];
  // max(r) − min(r) across the parties — pre-computed so the tile can sort
  // rows by "demographic divisiveness" without an extra pass.
  spread: number;
};

export type LocalDemographicCleavagesPayload = {
  cycle: string;
  parties: LocalDemographicCleavageParty[];
  // Rows pre-sorted by spread descending.
  rows: LocalDemographicCleavageRow[];
};

// A nationally-aggregated party share with a resolved display name + colour —
// index.json's councilVoteShare shape, reused for the mayoral rollup too.
type ShareEntry = {
  canonicalId: string;
  displayName: string;
  color: string;
  pctOfValid: number;
};

type MetaEntry = { displayName: string; color: string };
type MuniAgg = { total: number; byId: Map<string, number> };

// Aggregate per-municipality votes onto NSI census codes. `entriesFor` yields
// [bucketId, votes] pairs for one bundle (council parties or mayoral R1
// candidates). Sofia район shards are skipped; SOF maps to the city census code.
const buildMuniAggs = (
  bundles: LocalMunicipalityBundle[],
  censusCodes: Set<string>,
  entriesFor: (b: LocalMunicipalityBundle) => Array<[string, number]>,
): Map<string, MuniAgg> => {
  const muniAggs = new Map<string, MuniAgg>();
  for (const b of bundles) {
    if (isSofiaRayonCode(b.obshtinaCode)) continue; // counted via SOF
    const code = censusCodes.has(b.obshtinaCode)
      ? b.obshtinaCode
      : b.obshtinaCode === "SOF"
        ? SOFIA_CITY_CENSUS_CODE
        : undefined;
    if (!code || !censusCodes.has(code)) continue;
    let agg = muniAggs.get(code);
    if (!agg) {
      agg = { total: 0, byId: new Map() };
      muniAggs.set(code, agg);
    }
    for (const [id, votes] of entriesFor(b)) {
      agg.total += votes;
      agg.byId.set(id, (agg.byId.get(id) ?? 0) + votes);
    }
  }
  return muniAggs;
};

// National mayoral R1 vote share per canonical bucket. index.json carries
// mayorsByCanonical (seats won) but no mayoral vote share, so we sum it here
// straight from the bundles; display name + colour come from the supplied meta
// map (council rollup ∪ mayors-won rollup), with a local-name fallback.
const buildMayorNationalShare = (
  bundles: LocalMunicipalityBundle[],
  meta: Map<string, MetaEntry>,
): ShareEntry[] => {
  const totals = new Map<string, number>();
  const localName = new Map<string, string>();
  let grand = 0;
  for (const b of bundles) {
    if (isSofiaRayonCode(b.obshtinaCode)) continue;
    for (const m of b.mayor.round1) {
      const id = mayorBucketId(m);
      if (!m.isIndependent && !m.primaryCanonicalId && !localName.has(id)) {
        localName.set(id, m.localPartyName);
      }
      totals.set(id, (totals.get(id) ?? 0) + m.votes);
      grand += m.votes;
    }
  }
  return Array.from(totals.entries())
    .map(([id, totalVotes]) => {
      const md = meta.get(id) ?? {
        displayName: localName.get(id) ?? id,
        color: "#9CA3AF",
      };
      return {
        canonicalId: id,
        displayName: md.displayName,
        color: md.color,
        pctOfValid: grand > 0 ? (totalVotes / grand) * 100 : 0,
      };
    })
    .sort((a, b) => b.pctOfValid - a.pctOfValid);
};

// The core: pick the leading parties from the national share, then correlate
// each one's per-município share against every census metric. Returns null when
// fewer than two parties qualify (nothing to compare).
const computeCleavages = (opts: {
  cycle: string;
  label: string;
  muniByCode: Map<string, CensusMunicipalityEntity>;
  muniAggs: Map<string, MuniAgg>;
  nationalShare: ShareEntry[];
}): LocalDemographicCleavagesPayload | null => {
  const { cycle, label, muniByCode, muniAggs, nationalShare } = opts;
  const muniCodesInOrder = Array.from(muniAggs.keys()).filter(
    (code) => (muniAggs.get(code)?.total ?? 0) > 0,
  );

  // Pick the leading parties: ≥ threshold nationally, present in enough
  // municipalities to correlate, never the independent catch-all.
  const parties = nationalShare
    .filter(
      (p) =>
        p.canonicalId !== INDEPENDENT_CANONICAL_ID &&
        p.pctOfValid >= THRESHOLD_PCT,
    )
    .filter((p) => {
      let n = 0;
      for (const code of muniCodesInOrder) {
        if ((muniAggs.get(code)!.byId.get(p.canonicalId) ?? 0) > 0) n++;
      }
      return n >= MIN_MUNIS;
    })
    .slice(0, MAX_PARTIES);

  if (parties.length < 2) {
    console.warn(
      `[local demographics] ${cycle} (${label}): only ${parties.length} qualifying part(y/ies) — skipping cleavages.`,
    );
    return null;
  }

  // Each party's vote share per municipality, in muniCodesInOrder.
  const ysByParty = new Map<string, number[]>(
    parties.map((p) => [
      p.canonicalId,
      muniCodesInOrder.map((code) => {
        const agg = muniAggs.get(code)!;
        return (100 * (agg.byId.get(p.canonicalId) ?? 0)) / agg.total;
      }),
    ]),
  );

  // Demographic X array per metric (0..100), independent of party.
  const xByMetric = new Map<CensusMetric, (number | undefined)[]>();
  for (const metric of PERCENT_METRICS) {
    xByMetric.set(
      metric,
      muniCodesInOrder.map((code) => {
        const v = censusMetricShare(muniByCode.get(code)!, metric);
        return v !== undefined ? v * 100 : undefined;
      }),
    );
  }

  const rows: LocalDemographicCleavageRow[] = PERCENT_METRICS.map((metric) => {
    const xsRaw = xByMetric.get(metric)!;
    const rs = parties.map((p) => {
      const ysAll = ysByParty.get(p.canonicalId)!;
      const xs: number[] = [];
      const ys: number[] = [];
      for (let i = 0; i < xsRaw.length; i++) {
        if (xsRaw[i] === undefined) continue;
        xs.push(xsRaw[i] as number);
        ys.push(ysAll[i]);
      }
      return round3(pearson(xs, ys));
    });
    return { metric, rs, spread: round3(Math.max(...rs) - Math.min(...rs)) };
  }).sort((a, b) => b.spread - a.spread);

  return {
    cycle,
    parties: parties.map((p) => ({
      canonicalId: p.canonicalId,
      displayName: p.displayName,
      color: p.color,
      pctNational: round3(p.pctOfValid),
    })),
    rows,
  };
};

export const buildLocalDemographics = ({
  publicFolder,
  cycle,
  bundles,
  councilVoteShare,
  mayorsByCanonical,
  stringify,
}: {
  publicFolder: string;
  cycle: string;
  bundles: LocalMunicipalityBundle[];
  // index.json's councilVoteShare — already nationally aggregated with the
  // resolved display name + colour per canonical party.
  councilVoteShare: ShareEntry[];
  // index.json's mayorsByCanonical — used (with councilVoteShare) only to
  // resolve display names + colours for the computed mayoral vote share.
  mayorsByCanonical: {
    canonicalId: string;
    displayName: string;
    color: string;
  }[];
  stringify: (o: object) => string;
}): void => {
  const censusPath = path.join(publicFolder, "census_2021.json");
  if (!fs.existsSync(censusPath)) {
    console.warn(
      `[local demographics] ${cycle}: skipping — ${censusPath} not found.`,
    );
    return;
  }
  const census: CensusPayload = JSON.parse(
    fs.readFileSync(censusPath, "utf-8"),
  );
  const muniByCode = new Map<string, CensusMunicipalityEntity>(
    census.municipalities.map((m) => [m.code, m]),
  );
  const censusCodes = new Set(muniByCode.keys());

  const dashboardDir = path.join(publicFolder, cycle, "dashboard");
  const writePayload = (
    file: string,
    payload: LocalDemographicCleavagesPayload | null,
    label: string,
  ): void => {
    if (!payload) return;
    fs.mkdirSync(dashboardDir, { recursive: true });
    fs.writeFileSync(path.join(dashboardDir, file), stringify(payload));
    console.log(
      `[local demographics] ${cycle} (${label}): wrote dashboard/${file} (${payload.parties.length} parties × ${payload.rows.length} metrics)`,
    );
  };

  // --- Council ----------------------------------------------------------
  const councilAggs = buildMuniAggs(bundles, censusCodes, (b) =>
    b.council.map((p) => [councilBucketId(p), p.totalVotes]),
  );
  writePayload(
    "demographic_cleavages.json",
    computeCleavages({
      cycle,
      label: "council",
      muniByCode,
      muniAggs: councilAggs,
      nationalShare: councilVoteShare,
    }),
    "council",
  );

  // --- Mayor (R1) -------------------------------------------------------
  const meta = new Map<string, MetaEntry>();
  for (const p of mayorsByCanonical) {
    meta.set(p.canonicalId, { displayName: p.displayName, color: p.color });
  }
  for (const p of councilVoteShare) {
    if (!meta.has(p.canonicalId)) {
      meta.set(p.canonicalId, { displayName: p.displayName, color: p.color });
    }
  }
  const mayorShare = buildMayorNationalShare(bundles, meta);
  const mayorAggs = buildMuniAggs(bundles, censusCodes, (b) =>
    b.mayor.round1.map((m) => [mayorBucketId(m), m.votes]),
  );
  writePayload(
    "demographic_cleavages_mayor.json",
    computeCleavages({
      cycle,
      label: "mayor",
      muniByCode,
      muniAggs: mayorAggs,
      nationalShare: mayorShare,
    }),
    "mayor",
  );
};

// Standalone backfill: rebuild the cleavages artifacts for every regular `_mi`
// cycle straight from the already-written index.json + municipality bundles,
// without re-running the full HTML parse. Idempotent.
//   npx tsx scripts/parsers_local/build_local_demographics.ts [cycle]
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const publicFolder = path.resolve(here, "../../data");
  const localElectionsFile = path.resolve(
    publicFolder,
    "../src/data/json/local_elections.json",
  );
  const cycles: { name: string }[] = JSON.parse(
    fs.readFileSync(localElectionsFile, "utf-8"),
  );
  const only = process.argv[2];
  for (const { name: cycle } of cycles) {
    if (only && cycle !== only) continue;
    if (!cycle.endsWith("_mi")) continue;
    const cycleDir = path.join(publicFolder, cycle);
    const indexFile = path.join(cycleDir, "index.json");
    const muniDir = path.join(cycleDir, "municipalities");
    if (!fs.existsSync(indexFile) || !fs.existsSync(muniDir)) {
      console.warn(`[local demographics] ${cycle}: no index/municipalities.`);
      continue;
    }
    const index = JSON.parse(fs.readFileSync(indexFile, "utf-8")) as {
      councilVoteShare: ShareEntry[];
      mayorsByCanonical: {
        canonicalId: string;
        displayName: string;
        color: string;
      }[];
    };
    const bundles: LocalMunicipalityBundle[] = fs
      .readdirSync(muniDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(fs.readFileSync(path.join(muniDir, f), "utf-8")));
    buildLocalDemographics({
      publicFolder,
      cycle,
      bundles,
      councilVoteShare: index.councilVoteShare,
      mayorsByCanonical: index.mayorsByCanonical,
      stringify: (o) => JSON.stringify(o),
    });
  }
}
