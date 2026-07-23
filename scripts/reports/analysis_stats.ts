// analysis_stats.json — the precomputed per-election headline numbers for the
// /analysis hub tiles (AnalysisHubScreen, via src/data/analysis/
// useAnalysisStats.tsx). One tiny file per election, so the hub is a single
// fetch rather than mounting six different analysis hooks. Same idea as
// procurement's sector_stats.json, but keyed by election instead of ?pscope.
//
// This is a pure AGGREGATOR: it re-reads the numbers other pipeline steps have
// already written (national_summary, risk_score_summary, benford, the vote-flow
// transitions, polls accuracy, the donor summary) and picks the one headline
// figure per analysis. A metric whose source file isn't present yet is simply
// omitted — the tile then renders without a number, exactly like a sector with
// no stat. Because it only reads siblings, it runs at the end of the reports
// step and can also be re-run cheaply on its own (main.ts `--analysisStats`).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ElectionInfo } from "@/data/dataTypes";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface AnalysisStat {
  kind: "count" | "percent" | "eur" | "score";
  value: number;
  total?: number;
  captionKey: string;
}

type Stats = Record<string, AnalysisStat>;

const readJson = <T = unknown>(file: string): T | undefined => {
  if (!fs.existsSync(file)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  } catch (err) {
    // A corrupt source is a different failure mode than an absent one: still
    // omit the metric (return undefined), but surface it in the pipeline log.
    console.warn(`analysis_stats: could not parse ${file}: ${String(err)}`);
    return undefined;
  }
};

/** Build (and write) the analysis_stats.json for a single election folder. */
export const generateAnalysisStats = ({
  publicFolder,
  year,
  stringify,
}: {
  publicFolder: string;
  year: string;
  stringify: (o: object) => string;
}): Stats => {
  const stats: Stats = {};

  // national_summary → wasted-vote share + turnout (both already 0–100).
  const ns = readJson<{
    turnout?: { pct?: number };
    wastedVotes?: { share?: number };
  }>(`${publicFolder}/${year}/national_summary.json`);
  if (ns?.wastedVotes?.share != null) {
    stats.wasted = {
      kind: "percent",
      value: ns.wastedVotes.share,
      captionKey: "analysis_stat_wasted_caption",
    };
  }
  if (ns?.turnout?.pct != null) {
    stats.turnout = {
      kind: "percent",
      value: ns.turnout.pct,
      captionKey: "analysis_stat_turnout_caption",
    };
  }

  // risk_score_summary → critical-section count of all sections.
  const risk = readJson<{
    totalSections?: number;
    counts?: { critical?: number };
  }>(`${publicFolder}/${year}/reports/section/risk_score_summary.json`);
  if (risk?.counts?.critical != null) {
    stats.risk = {
      kind: "count",
      value: risk.counts.critical,
      total: risk.totalSections,
      captionKey: "analysis_stat_risk_caption",
    };
  }

  // benford → number of parties whose second-digit (else first-digit) MAD clears
  // the "moderate" 0.04 threshold — same signal as the home BenfordTile.
  const benford = readJson<{
    parties?: {
      firstDigit?: { mad?: number };
      secondDigit?: { mad?: number };
    }[];
  }>(`${publicFolder}/${year}/reports/benford.json`);
  if (benford?.parties?.length) {
    const flagged = benford.parties.filter((p) => {
      const test = p.secondDigit ?? p.firstDigit;
      return test?.mad != null && test.mad >= 0.04;
    }).length;
    stats.benford = {
      kind: "count",
      value: flagged,
      captionKey: "analysis_stat_benford_caption",
    };
  }

  // vote-flow persistence → national stay-rate (0–1) of the transition pair that
  // ENDS at this election (folder `${from}_${to}` → ends with `_${year}`).
  const transDir = `${publicFolder}/transitions`;
  if (fs.existsSync(transDir)) {
    const pair = fs
      .readdirSync(transDir)
      .find((name) => name.endsWith(`_${year}`));
    if (pair) {
      const pf = readJson<{ national?: { stayRate?: number } }>(
        `${transDir}/${pair}/persistence.json`,
      );
      if (pf?.national?.stayRate != null) {
        stats.persistence = {
          kind: "percent",
          value: pf.national.stayRate * 100,
          captionKey: "analysis_stat_persistence_caption",
        };
      }
    }
  }

  // polls accuracy → the best (lowest) agency MAE for this election.
  const acc = readJson<{
    elections?: { electionDate?: string; agencies?: { mae?: number }[] }[];
  }>(`${publicFolder}/polls/accuracy.json`);
  if (acc?.elections?.length) {
    const hyphenDate = year.replace(/_/g, "-");
    const entry = acc.elections.find((e) => e.electionDate === hyphenDate);
    const maes = (entry?.agencies ?? [])
      .map((a) => a.mae)
      .filter((m): m is number => typeof m === "number");
    if (maes.length) {
      stats.polls = {
        kind: "score",
        value: Math.min(...maes),
        captionKey: "analysis_stat_polls_caption",
      };
    }
  }

  // campaign financing → total donations for the cycle (EUR).
  const donors = readJson<{ totalDonations?: number }>(
    `${publicFolder}/${year}/parties/donors.json`,
  );
  if (typeof donors?.totalDonations === "number" && donors.totalDonations > 0) {
    stats.financing = {
      kind: "eur",
      value: donors.totalDonations,
      captionKey: "analysis_stat_financing_caption",
    };
  }

  fs.writeFileSync(
    `${publicFolder}/${year}/analysis_stats.json`,
    stringify(stats),
    "utf8",
  );
  console.log(
    `analysis_stats ${year}: ${Object.keys(stats).join(", ") || "(none)"}`,
  );
  return stats;
};

/** Regenerate analysis_stats.json for every election (or one, when `election`
 *  is given) — the cheap standalone path behind main.ts `--analysisStats`. */
export const generateAllAnalysisStats = (
  stringify: (o: object) => string,
  election?: string,
) => {
  const publicFolder = path.resolve(__dirname, `../../data`);
  const electionsFile = path.resolve(
    __dirname,
    "../../src/data/json/elections.json",
  );
  const elections: ElectionInfo[] = JSON.parse(
    fs.readFileSync(electionsFile, "utf-8"),
  );
  elections
    .filter((e) => election === undefined || election === e.name)
    .forEach((e) => {
      if (!fs.existsSync(`${publicFolder}/${e.name}`)) return;
      generateAnalysisStats({ publicFolder, year: e.name, stringify });
    });
};
