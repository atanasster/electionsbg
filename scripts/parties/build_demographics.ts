/**
 * Precompute per-party Pearson correlations between municipal vote share and
 * each demographic indicator from Census 2021. Runs as part of the party-stats
 * step in the data pipeline.
 *
 * Correlations are computed across the ~265 municipalities (obshtini) rather
 * than the 28 oblasts — a ~10x larger sample that turns the relationships from
 * suggestive into statistically solid. Census 2021 publishes the ethnocultural
 * / education / employment dimensions down to the municipality level, so the
 * finer grain costs no demographic resolution.
 *
 * Outputs, per election:
 *   - parties/demographics/{partyNum}.json — per-party correlations:
 *       { election, partyNum, correlations: [{ metric, r, n }, ...] }
 *   - dashboard/demographic_cleavages.json — top-N parties x metrics matrix
 *   - dashboard/demographic_scatter.json   — per-municipality vote totals that
 *       the /demographics scatter consumes (joined client-side to the census
 *       municipalities payload).
 *
 * Mirrors PERCENT_METRICS and the Pearson helper used client-side, kept here
 * in plain TS so the script can run without a React/JSX toolchain.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { ElectionInfo, PartyInfo } from "@/data/dataTypes";
import type {
  CensusEntity,
  CensusMetric,
  CensusMunicipalityEntity,
  CensusPayload,
} from "@/data/census/censusTypes";
import { cikPartiesFileName } from "../consts";

export const PERCENT_METRICS: CensusMetric[] = [
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
  "age15_29",
  "age30_44",
  "age45_64",
  "age65plus",
  "genderFemale",
  "employmentRate",
  "unemploymentRate",
  "activityRate",
];

// Election data splits Столична община (Sofia city) into rayon-level units
// (S2302, S2401, S2511, ...); NSI's census keeps it as one municipality
// (SOF46). All Sofia rayon codes therefore aggregate into that single entity.
// Abroad continent buckets (AF, AS, EU, NA, OC, SA) have no census entity and
// are dropped.
const SOFIA_CITY_CENSUS_CODE = "SOF46";
const isSofiaRayonCode = (obshtina: string) => /^S2[345]/.test(obshtina);

const sumEthnic = (e?: CensusEntity["ethnic"]) =>
  e ? e.bulgarian + e.turkish + e.roma + e.other : 0;
const sumReligion = (r?: CensusEntity["religion"]) =>
  r ? r.christian + r.muslim + r.jewish + r.other + r.noReligion : 0;
const sumEducation = (e?: CensusEntity["education"]) =>
  e
    ? e.tertiary +
      e.upperSecondary +
      e.lowerSecondary +
      e.primaryOrLower +
      e.preSchool
    : 0;

// 0..1 share for percentage-like metrics. Mirrors censusMetricValue() in
// src/data/census/useCensus.tsx.
export const censusMetricShare = (
  e: CensusEntity,
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
    case "age15_29":
      return e.age && e.population > 0
        ? e.age.age15_29 / e.population
        : undefined;
    case "age30_44":
      return e.age && e.population > 0
        ? e.age.age30_44 / e.population
        : undefined;
    case "age45_64":
      return e.age && e.population > 0
        ? e.age.age45_64 / e.population
        : undefined;
    case "age65plus":
      return e.age && e.population > 0
        ? e.age.age65plus / e.population
        : undefined;
    case "genderFemale": {
      const d = e.gender ? e.gender.male + e.gender.female : 0;
      return d > 0 && e.gender ? e.gender.female / d : undefined;
    }
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

export const pearson = (xs: number[], ys: number[]): number => {
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

export const round3 = (n: number) => Math.round(n * 1000) / 1000;

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

// Per-municipality vote totals consumed by the /demographics scatter. The
// census dimensions are joined client-side from census_2021.json, so this
// payload carries only the obshtina code and the party vote breakdown.
export type VoteDemographicMunicipality = {
  obshtina: string;
  votes: { partyNum: number; totalVotes: number }[];
};

export type VoteDemographicsScatterPayload = {
  election: string;
  municipalities: VoteDemographicMunicipality[];
};

// Bulgarian electoral threshold: only parties that cleared 4% of the national
// vote get mandates. We use the same cutoff for the dashboard cleavages tile so
// the dot plot reflects parties that actually shaped the parliament — count
// varies naturally per election (4–7 parties is typical).
const PARLIAMENT_THRESHOLD_PCT = 4;

type MunicipalityVoteFile = {
  obshtina?: string;
  results?: { votes?: { partyNum: number; totalVotes: number }[] };
};

type MuniAgg = { total: number; partyTotals: Map<number, number> };

// Read every per-municipality vote file in an election folder and aggregate
// party + total votes onto the NSI census municipality codes.
const aggregateMunicipalityVotes = (
  municipalitiesDir: string,
  censusCodes: Set<string>,
): Map<string, MuniAgg> => {
  const aggs = new Map<string, MuniAgg>();
  if (!fs.existsSync(municipalitiesDir)) return aggs;
  for (const file of fs.readdirSync(municipalitiesDir)) {
    if (!file.endsWith(".json")) continue;
    // This dir also holds the gitignored Пловдив/Варна район shards
    // ("<muni>-<code>.json", obshtina "PDV22-06") that gen_city_rayon_data.ts
    // writes. They are subsets of their parent city (PDV22/VAR06), so any
    // directory-globbing rollup MUST skip them or it double-counts city votes.
    // The census-code guard below already rejects them (PDV22-06 is not an NSI
    // code), but skip explicitly here so the invariant doesn't depend on it.
    if (/^[A-Z]{3}\d{2}-\d{2}\.json$/.test(file)) continue;
    const mv: MunicipalityVoteFile = JSON.parse(
      fs.readFileSync(path.join(municipalitiesDir, file), "utf-8"),
    );
    if (!mv.obshtina || !mv.results?.votes) continue;
    const code = censusCodes.has(mv.obshtina)
      ? mv.obshtina
      : isSofiaRayonCode(mv.obshtina)
        ? SOFIA_CITY_CENSUS_CODE
        : undefined;
    if (!code || !censusCodes.has(code)) continue;
    let agg = aggs.get(code);
    if (!agg) {
      agg = { total: 0, partyTotals: new Map() };
      aggs.set(code, agg);
    }
    for (const v of mv.results.votes) {
      agg.total += v.totalVotes;
      agg.partyTotals.set(
        v.partyNum,
        (agg.partyTotals.get(v.partyNum) ?? 0) + v.totalVotes,
      );
    }
  }
  return aggs;
};

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
  const muniByCode = new Map<string, CensusMunicipalityEntity>(
    census.municipalities.map((m) => [m.code, m]),
  );
  const censusCodes = new Set(muniByCode.keys());

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
    const municipalitiesDir = path.join(electionFolder, "municipalities");
    if (!fs.existsSync(partiesFile) || !fs.existsSync(municipalitiesDir)) {
      continue;
    }
    const parties: PartyInfo[] = JSON.parse(
      fs.readFileSync(partiesFile, "utf-8"),
    );

    const muniAggs = aggregateMunicipalityVotes(municipalitiesDir, censusCodes);

    // Pre-compute the demographic X arrays once per metric — they're
    // independent of party and identical across all party iterations.
    const muniCodesInOrder = Array.from(muniAggs.keys()).filter(
      (code) => (muniAggs.get(code)?.total ?? 0) > 0,
    );
    const xByMetric = new Map<CensusMetric, (number | undefined)[]>();
    for (const metric of PERCENT_METRICS) {
      xByMetric.set(
        metric,
        muniCodesInOrder.map((code) => {
          const entity = muniByCode.get(code)!;
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
      const ys = muniCodesInOrder.map((code) => {
        const agg = muniAggs.get(code)!;
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
      `[party demographics] ${e.name}: wrote ${parties.length} party files (n=${muniCodesInOrder.length} municipalities) to ${outDir}`,
    );

    const dashboardDir = path.join(electionFolder, "dashboard");
    fs.mkdirSync(dashboardDir, { recursive: true });

    // Per-municipality vote totals for the /demographics scatter.
    const scatterPayload: VoteDemographicsScatterPayload = {
      election: e.name,
      municipalities: muniCodesInOrder.map((code) => ({
        obshtina: code,
        votes: Array.from(muniAggs.get(code)!.partyTotals.entries())
          .map(([partyNum, totalVotes]) => ({ partyNum, totalVotes }))
          .sort((a, b) => a.partyNum - b.partyNum),
      })),
    };
    fs.writeFileSync(
      path.join(dashboardDir, "demographic_scatter.json"),
      stringify(scatterPayload),
    );

    // Build the home-dashboard cleavages aggregate: top-N parties by national
    // vote share × every metric, with pre-computed spread per row so the tile
    // can render straight from a single ~1KB fetch.
    const totalsByParty = new Map<number, number>();
    let nationalTotal = 0;
    for (const agg of muniAggs.values()) {
      nationalTotal += agg.total;
      for (const [partyNum, votes] of agg.partyTotals) {
        totalsByParty.set(partyNum, (totalsByParty.get(partyNum) ?? 0) + votes);
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

// Allow running this step standalone (regenerate only the demographics
// artifacts) without re-running the full party-stats pipeline.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  buildPartyDemographics({
    publicFolder: path.resolve(here, "../../data"),
    stringify: (o) => JSON.stringify(o),
  });
}
