import fs from "fs";
import path from "path";
import { ElectionInfo, PartyInfo } from "@/data/dataTypes";
import { cikPartiesFileName } from "scripts/consts";
import { savePartitioned } from "scripts/dataReaders";
import {
  loadSectionStats,
  type RiskBand,
  type RiskScoreReport,
} from "./risk_score";

// Cross-election section "rap sheet" — one chronological record per
// polling section, joining its turnout + winner + winner-share (from the
// per-oblast section files) with its risk SCREENING score + band (from
// each election's risk_score.json). A VIEW over data already published;
// it introduces no new signal and makes no fraud claim — see
// risk_score.ts for the full "screening, not a verdict" framing.
//
// Output is partitioned by 2-digit oblast prefix (sections/risk_history/
// <prefix>.json) so a section page fetches one small bucket, matching the
// risk_score/<prefix>.json buckets the SPA already uses.

/** One election's row in a section's risk history. Risk fields are
 * undefined when the section had no risk row that election — i.e. no
 * screening signal fired (a clean cycle), or the section did not exist
 * in the risk report (earliest elections / missing inputs). */
export type RiskHistoryEntry = {
  election: string;
  /** Turnout %, 0–100. Can exceed 100 in mobile / hospital sections. */
  turnoutPct: number;
  winnerPartyNum?: number;
  /** CEC nickname of the winning party — the key the SPA resolves
   * against canonical_parties.json for a language-aware display name. */
  winnerNickName?: string;
  /** That election's CEC colour — a fallback for parties absent from the
   * canonical index; the SPA prefers the canonical colour. */
  winnerColor?: string;
  /** Winning party's share of the section vote, %, 0–100. */
  winnerSharePct?: number;
  /** Risk screening score 0–100 — undefined when no signal fired. */
  score?: number;
  band?: RiskBand;
  signalsAvailable?: number;
  signalsTotal?: number;
};

const round1 = (n: number): number => Math.round(n * 10) / 10;

// Index a single election's risk_score.json by section id. Returns an
// empty map if the report is missing (earliest elections may lack it).
const loadRiskRows = (
  filePath: string,
): Map<string, RiskScoreReport["rows"][number]> => {
  const m = new Map<string, RiskScoreReport["rows"][number]>();
  if (!fs.existsSync(filePath)) return m;
  try {
    const report = JSON.parse(
      fs.readFileSync(filePath, "utf-8"),
    ) as RiskScoreReport;
    for (const r of report.rows ?? []) m.set(r.section, r);
  } catch {
    // ignore — a corrupt/partial report just yields no risk fields
  }
  return m;
};

export const generateRiskHistory = ({
  publicFolder,
  stringify,
}: {
  publicFolder: string;
  stringify: (o: object) => string;
}): void => {
  const electionsFile = path.resolve(
    publicFolder,
    "../src/data/json/elections.json",
  );
  const elections: ElectionInfo[] = (
    JSON.parse(fs.readFileSync(electionsFile, "utf-8")) as ElectionInfo[]
  ).sort((a, b) => a.name.localeCompare(b.name));

  const bySection: Record<string, RiskHistoryEntry[]> = {};

  for (const e of elections) {
    const year = e.name;
    const stats = loadSectionStats(publicFolder, year);
    if (stats.length === 0) continue;

    const partiesFile = `${publicFolder}/${year}/${cikPartiesFileName}`;
    const partyByNum = new Map<number, PartyInfo>();
    if (fs.existsSync(partiesFile)) {
      const parties: PartyInfo[] = JSON.parse(
        fs.readFileSync(partiesFile, "utf-8"),
      );
      for (const p of parties) partyByNum.set(p.number, p);
    }

    const riskRows = loadRiskRows(
      `${publicFolder}/${year}/reports/section/risk_score.json`,
    );

    for (const s of stats) {
      const party =
        s.topPartyNum !== undefined ? partyByNum.get(s.topPartyNum) : undefined;
      const risk = riskRows.get(s.section);
      const entry: RiskHistoryEntry = {
        election: year,
        turnoutPct: round1(s.turnout * 100),
        winnerPartyNum: s.topPartyNum,
        winnerNickName: party?.nickName,
        winnerColor: party?.color,
        winnerSharePct: round1(s.winnerShare * 100),
        score: risk ? round1(risk.score) : undefined,
        band: risk?.band,
        signalsAvailable: risk?.signalsAvailable,
        signalsTotal: risk?.signalsTotal,
      };
      (bySection[s.section] ??= []).push(entry);
    }
  }

  // A single-election section has no "history" to show — drop it so the
  // SPA's useRiskHistory hook 404s and the rap-sheet tile hides itself.
  const withHistory: Record<string, RiskHistoryEntry[]> = {};
  let kept = 0;
  for (const [section, entries] of Object.entries(bySection)) {
    if (entries.length < 2) continue;
    entries.sort((a, b) => a.election.localeCompare(b.election));
    withHistory[section] = entries;
    kept += 1;
  }

  savePartitioned(
    withHistory,
    stringify,
    `${publicFolder}/sections/risk_history`,
    (key) => key.slice(0, 2),
  );
  console.log(`Risk history: ${kept} sections with ≥2 elections`);
};
