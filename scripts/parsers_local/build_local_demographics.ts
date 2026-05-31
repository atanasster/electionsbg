/**
 * Precompute Pearson correlations between each leading party's COUNCIL vote
 * share and every Census 2021 demographic indicator, per local-election cycle.
 * The local analogue of scripts/parties/build_demographics.ts: there the
 * signal is the parliamentary party vote, here it is the proportional council
 * (общински съвет) vote — the only race where voters pick a party list rather
 * than a person, so the only one a demographic correlation is meaningful for.
 *
 * Output, per `_mi` cycle:
 *   dashboard/demographic_cleavages.json — top council parties × metrics matrix
 *   with a pre-computed spread per row, consumed by LocalDemographicCleavagesTile.
 *
 * Correlations run across the ~265 municipalities (obshtini). Sofia is the
 * synthetic `SOF` city-wide bundle (mapped to census SOF46); its 24 район
 * shards (S2***) are skipped so the city is counted once. Reuses the census
 * share + Pearson helpers from the parliamentary build so the maths can't drift.
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
import type { LocalCouncilParty, LocalMunicipalityBundle } from "./types";

const SOFIA_CITY_CENSUS_CODE = "SOF46";
const isSofiaRayonCode = (code: string) => /^S2\d{3}$/.test(code);

// Only the leading council parties get a dot. Threshold mirrors the Bulgarian
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

export type LocalDemographicCleavageParty = {
  canonicalId: string;
  displayName: string;
  color?: string;
  // National council vote share (0..100), so the tile can show salience.
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

type CouncilShareEntry = {
  canonicalId: string;
  displayName: string;
  color: string;
  pctOfValid: number;
};

type MuniAgg = { total: number; byId: Map<string, number> };

export const buildLocalDemographics = ({
  publicFolder,
  cycle,
  bundles,
  councilVoteShare,
  stringify,
}: {
  publicFolder: string;
  cycle: string;
  bundles: LocalMunicipalityBundle[];
  // index.json's councilVoteShare — already nationally aggregated with the
  // resolved display name + colour per canonical party.
  councilVoteShare: CouncilShareEntry[];
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

  // Aggregate per-municipality council votes onto NSI census codes.
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
    for (const party of b.council) {
      const id = councilBucketId(party);
      agg.total += party.totalVotes;
      agg.byId.set(id, (agg.byId.get(id) ?? 0) + party.totalVotes);
    }
  }
  const muniCodesInOrder = Array.from(muniAggs.keys()).filter(
    (code) => (muniAggs.get(code)?.total ?? 0) > 0,
  );

  // Pick the leading council parties: ≥ threshold nationally, present in
  // enough municipalities to correlate, never the independent catch-all.
  const parties = councilVoteShare
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
      `[local demographics] ${cycle}: only ${parties.length} qualifying council part(y/ies) — skipping cleavages.`,
    );
    return;
  }

  // Each party's council vote share per municipality, in muniCodesInOrder.
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

  const payload: LocalDemographicCleavagesPayload = {
    cycle,
    parties: parties.map((p) => ({
      canonicalId: p.canonicalId,
      displayName: p.displayName,
      color: p.color,
      pctNational: round3(p.pctOfValid),
    })),
    rows,
  };

  const dashboardDir = path.join(publicFolder, cycle, "dashboard");
  fs.mkdirSync(dashboardDir, { recursive: true });
  fs.writeFileSync(
    path.join(dashboardDir, "demographic_cleavages.json"),
    stringify(payload),
  );
  console.log(
    `[local demographics] ${cycle}: wrote dashboard/demographic_cleavages.json (${parties.length} parties × ${rows.length} metrics, n=${muniCodesInOrder.length} municipalities)`,
  );
};

// Standalone backfill: rebuild the cleavages artifact for every regular `_mi`
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
      councilVoteShare: CouncilShareEntry[];
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
      stringify: (o) => JSON.stringify(o),
    });
  }
}
