/**
 * Precompute per-party Pearson correlations between regional vote share and
 * each demographic indicator from Census 2021. Runs as part of the party-stats
 * step in the data pipeline.
 *
 * Output: public/{election}/parties/demographics/{partyNum}.json — a tiny
 * payload that the dashboard's Demographic profile tile reads directly,
 * skipping a full census fetch + client-side correlation pass.
 *
 *   {
 *     election: "2026_04_19",
 *     partyNum: 7,
 *     correlations: [{ metric: "ethnicTurkish", r: -0.71, n: 28 }, ...]
 *   }
 *
 * Mirrors PERCENT_METRICS, NUTS3_TO_OBLAST and the Pearson + aggregation
 * helpers used client-side, kept here in plain TS so the script can run
 * without a React/JSX toolchain.
 */

import fs from "fs";
import path from "path";
import type { ElectionInfo, ElectionRegion, PartyInfo } from "@/data/dataTypes";
import type {
  CensusOblastEntity,
  CensusMetric,
  CensusPayload,
} from "@/data/census/censusTypes";
import { cikPartiesFileName, regionsVotesFileName } from "../consts";

const PERCENT_METRICS: CensusMetric[] = [
  "ethnicBulgarian",
  "ethnicTurkish",
  "ethnicRoma",
  "religionChristian",
  "religionMuslim",
  "religionNoneOrUndecl",
  "eduTertiary",
  "eduSecondary",
  "eduPrimaryOrLower",
  "ageUnder15",
  "age65plus",
  "employmentRate",
  "unemploymentRate",
  "activityRate",
];

// Mirrors src/data/census/oblastJoin.ts — Sofia city's three election MIRs
// and the PDV/PDV-00 split collapse into the geographic NSI oblasts.
const NUTS3_TO_OBLAST: Record<string, string> = {
  BG413: "BLG",
  BG341: "BGS",
  BG331: "VAR",
  BG321: "VTR",
  BG311: "VID",
  BG313: "VRC",
  BG322: "GAB",
  BG332: "DOB",
  BG425: "KRZ",
  BG415: "KNL",
  BG315: "LOV",
  BG312: "MON",
  BG423: "PAZ",
  BG414: "PER",
  BG314: "PVN",
  BG421: "PDV",
  "BG421-1": "PDV",
  BG324: "RAZ",
  BG323: "RSE",
  BG325: "SLS",
  BG342: "SLV",
  BG424: "SML",
  BG416: "SOF",
  BG417: "SOF",
  BG418: "SOF",
  BG412: "SFO",
  BG344: "SZR",
  BG334: "TGV",
  BG422: "HKV",
  BG333: "SHU",
  BG343: "JAM",
};

const sumEthnic = (e?: CensusOblastEntity["ethnic"]) =>
  e ? e.bulgarian + e.turkish + e.roma + e.other : 0;
const sumReligion = (r?: CensusOblastEntity["religion"]) =>
  r ? r.christian + r.muslim + r.jewish + r.other + r.noReligion : 0;
const sumEducation = (e?: CensusOblastEntity["education"]) =>
  e
    ? e.tertiary +
      e.upperSecondary +
      e.lowerSecondary +
      e.primaryOrLower +
      e.preSchool
    : 0;

// 0..1 share for percentage-like metrics. Mirrors censusMetricValue() in
// src/data/census/useCensus.tsx.
const censusMetricShare = (
  e: CensusOblastEntity,
  metric: CensusMetric,
): number | undefined => {
  switch (metric) {
    case "ethnicBulgarian": {
      const d = sumEthnic(e.ethnic);
      return d > 0 && e.ethnic ? e.ethnic.bulgarian / d : undefined;
    }
    case "ethnicTurkish": {
      const d = sumEthnic(e.ethnic);
      return d > 0 && e.ethnic ? e.ethnic.turkish / d : undefined;
    }
    case "ethnicRoma": {
      const d = sumEthnic(e.ethnic);
      return d > 0 && e.ethnic ? e.ethnic.roma / d : undefined;
    }
    case "religionChristian": {
      const d = sumReligion(e.religion);
      return d > 0 && e.religion ? e.religion.christian / d : undefined;
    }
    case "religionMuslim": {
      const d = sumReligion(e.religion);
      return d > 0 && e.religion ? e.religion.muslim / d : undefined;
    }
    case "religionNoneOrUndecl": {
      const d = sumReligion(e.religion);
      return d > 0 && e.religion ? e.religion.noReligion / d : undefined;
    }
    case "eduTertiary": {
      const d = sumEducation(e.education);
      return d > 0 && e.education ? e.education.tertiary / d : undefined;
    }
    case "eduSecondary": {
      const d = sumEducation(e.education);
      return d > 0 && e.education
        ? (e.education.upperSecondary + e.education.tertiary) / d
        : undefined;
    }
    case "eduPrimaryOrLower": {
      const d = sumEducation(e.education);
      return d > 0 && e.education ? e.education.primaryOrLower / d : undefined;
    }
    case "ageUnder15":
      return e.age && e.population > 0
        ? e.age.age0_14 / e.population
        : undefined;
    case "age65plus":
      return e.age && e.population > 0
        ? e.age.age65plus / e.population
        : undefined;
    case "employmentRate":
      return e.employment ? e.employment.employmentRate / 100 : undefined;
    case "unemploymentRate":
      return e.employment ? e.employment.unemploymentRate / 100 : undefined;
    case "activityRate":
      return e.employment ? e.employment.activityRate / 100 : undefined;
    default:
      return undefined;
  }
};

const pearson = (xs: number[], ys: number[]): number => {
  const n = xs.length;
  if (n < 3) return 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? 0 : num / denom;
};

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export type PartyDemographicCorrelation = {
  metric: CensusMetric;
  r: number;
  n: number;
};

export type PartyDemographicsPayload = {
  election: string;
  partyNum: number;
  correlations: PartyDemographicCorrelation[];
};

export type DemographicCleavageParty = {
  partyNum: number;
  nickName: string;
  nickName_en?: string;
  color?: string;
  // National vote share for this party in this election (0..100). Used so the
  // home tile can size/sort dots by salience without a second fetch.
  pctNational: number;
};

export type DemographicCleavageRow = {
  metric: CensusMetric;
  // r per party, in the same order as `parties` below.
  rs: number[];
  // max(r) − min(r) across the parties — pre-computed so the tile can sort
  // rows by "demographic divisiveness" without an extra pass.
  spread: number;
};

export type DemographicCleavagesPayload = {
  election: string;
  // Top-N parties by national vote share, capped to a small set (5).
  parties: DemographicCleavageParty[];
  // Rows pre-sorted by spread descending — the most polarizing demographic
  // floats to the top.
  rows: DemographicCleavageRow[];
};

// Bulgarian electoral threshold: only parties that cleared 4% of the national
// vote get mandates. We use the same cutoff for the dashboard cleavages tile so
// the dot plot reflects parties that actually shaped the parliament — count
// varies naturally per election (4–7 parties is typical).
const PARLIAMENT_THRESHOLD_PCT = 4;

export const buildPartyDemographics = ({
  publicFolder,
  stringify,
}: {
  publicFolder: string;
  stringify: (o: object) => string;
}) => {
  const censusPath = path.join(publicFolder, "census_2021.json");
  if (!fs.existsSync(censusPath)) {
    console.warn(
      `[party demographics] skipping — ${censusPath} not found (run scripts/census/build_census.ts first).`,
    );
    return;
  }
  const census: CensusPayload = JSON.parse(
    fs.readFileSync(censusPath, "utf-8"),
  );
  const oblastByCode = new Map<string, CensusOblastEntity>(
    census.oblasts.map((o) => [o.code, o]),
  );

  const electionsFile = path.resolve(
    publicFolder,
    "../src/data/json/elections.json",
  );
  const elections: ElectionInfo[] = JSON.parse(
    fs.readFileSync(electionsFile, "utf-8"),
  );

  for (const e of elections) {
    const electionFolder = path.join(publicFolder, e.name);
    const partiesFile = path.join(electionFolder, cikPartiesFileName);
    const regionVotesFile = path.join(electionFolder, regionsVotesFileName);
    if (!fs.existsSync(partiesFile) || !fs.existsSync(regionVotesFile)) {
      continue;
    }
    const parties: PartyInfo[] = JSON.parse(
      fs.readFileSync(partiesFile, "utf-8"),
    );
    const regionVotes: ElectionRegion[] = JSON.parse(
      fs.readFileSync(regionVotesFile, "utf-8"),
    );

    // Aggregate per-NSI-oblast turnout once; per-party aggregation is the
    // same denominator, only the numerator changes.
    type Agg = { total: number; partyTotals: Map<number, number> };
    const oblastAggs = new Map<string, Agg>();
    for (const region of regionVotes) {
      const oblastCode = NUTS3_TO_OBLAST[region.nuts3];
      if (!oblastCode || !oblastByCode.has(oblastCode)) continue;
      const total = region.results.votes.reduce((s, v) => s + v.totalVotes, 0);
      let agg = oblastAggs.get(oblastCode);
      if (!agg) {
        agg = { total: 0, partyTotals: new Map() };
        oblastAggs.set(oblastCode, agg);
      }
      agg.total += total;
      for (const v of region.results.votes) {
        agg.partyTotals.set(
          v.partyNum,
          (agg.partyTotals.get(v.partyNum) ?? 0) + v.totalVotes,
        );
      }
    }

    // Pre-compute the demographic X arrays once per metric — they're
    // independent of party and identical across all party iterations.
    const oblastCodesInOrder = Array.from(oblastAggs.keys()).filter(
      (code) => (oblastAggs.get(code)?.total ?? 0) > 0,
    );
    const xByMetric = new Map<CensusMetric, (number | undefined)[]>();
    for (const metric of PERCENT_METRICS) {
      xByMetric.set(
        metric,
        oblastCodesInOrder.map((code) => {
          const entity = oblastByCode.get(code)!;
          const v = censusMetricShare(entity, metric);
          return v !== undefined ? v * 100 : undefined;
        }),
      );
    }

    const outDir = path.join(electionFolder, "parties", "demographics");
    fs.mkdirSync(outDir, { recursive: true });
    for (const f of fs.readdirSync(outDir)) fs.rmSync(path.join(outDir, f));

    // Per-party correlations + a side index of (partyNum → r-by-metric) for
    // the dashboard cleavages aggregate computed below.
    const correlationsByParty = new Map<
      number,
      PartyDemographicCorrelation[]
    >();

    for (const party of parties) {
      const correlations: PartyDemographicCorrelation[] = [];
      const ys = oblastCodesInOrder.map((code) => {
        const agg = oblastAggs.get(code)!;
        const partyVotes = agg.partyTotals.get(party.number) ?? 0;
        return (partyVotes / agg.total) * 100;
      });
      for (const metric of PERCENT_METRICS) {
        const xsRaw = xByMetric.get(metric)!;
        const xs: number[] = [];
        const ysFiltered: number[] = [];
        for (let i = 0; i < xsRaw.length; i++) {
          if (xsRaw[i] === undefined) continue;
          xs.push(xsRaw[i] as number);
          ysFiltered.push(ys[i]);
        }
        const r = pearson(xs, ysFiltered);
        correlations.push({ metric, r: round3(r), n: xs.length });
      }
      correlationsByParty.set(party.number, correlations);
      const payload: PartyDemographicsPayload = {
        election: e.name,
        partyNum: party.number,
        correlations,
      };
      fs.writeFileSync(
        path.join(outDir, `${party.number}.json`),
        stringify(payload),
      );
    }
    console.log(
      `[party demographics] ${e.name}: wrote ${parties.length} party files to ${outDir}`,
    );

    // Build the home-dashboard cleavages aggregate: top-N parties by national
    // vote share × every metric, with pre-computed spread per row so the tile
    // can render straight from a single ~1KB fetch.
    const totalsByParty = new Map<number, number>();
    let nationalTotal = 0;
    for (const region of regionVotes) {
      for (const v of region.results.votes) {
        totalsByParty.set(
          v.partyNum,
          (totalsByParty.get(v.partyNum) ?? 0) + v.totalVotes,
        );
        nationalTotal += v.totalVotes;
      }
    }
    const topParties = parties
      .map((p) => ({
        info: p,
        votes: totalsByParty.get(p.number) ?? 0,
        pct: nationalTotal
          ? (100 * (totalsByParty.get(p.number) ?? 0)) / nationalTotal
          : 0,
      }))
      .filter((p) => p.pct >= PARLIAMENT_THRESHOLD_PCT)
      .sort((a, b) => b.votes - a.votes);

    if (topParties.length >= 2) {
      const cleavageParties: DemographicCleavageParty[] = topParties.map(
        ({ info, votes }) => ({
          partyNum: info.number,
          nickName: info.nickName,
          nickName_en: info.nickName_en,
          color: info.color,
          pctNational: nationalTotal
            ? Math.round((10000 * votes) / nationalTotal) / 100
            : 0,
        }),
      );
      const rows: DemographicCleavageRow[] = PERCENT_METRICS.map((metric) => {
        const rs = topParties.map(({ info }) => {
          const c = correlationsByParty
            .get(info.number)
            ?.find((x) => x.metric === metric);
          return c?.r ?? 0;
        });
        const max = Math.max(...rs);
        const min = Math.min(...rs);
        return { metric, rs, spread: round3(max - min) };
      }).sort((a, b) => b.spread - a.spread);

      const cleavagesPayload: DemographicCleavagesPayload = {
        election: e.name,
        parties: cleavageParties,
        rows,
      };
      const dashboardDir = path.join(electionFolder, "dashboard");
      fs.mkdirSync(dashboardDir, { recursive: true });
      fs.writeFileSync(
        path.join(dashboardDir, "demographic_cleavages.json"),
        stringify(cleavagesPayload),
      );
      console.log(
        `[party demographics] ${e.name}: wrote dashboard/demographic_cleavages.json (${topParties.length} parties ≥${PARLIAMENT_THRESHOLD_PCT}% × ${rows.length} metrics)`,
      );
    }
  }
};
