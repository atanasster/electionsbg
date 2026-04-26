import fs from "fs";
import {
  ElectionInfo,
  PartyInfo,
  PartySeats,
  StatsVote,
} from "@/data/dataTypes";
import { findPrevVotes } from "@/data/utils";
import {
  AnomalyCounts,
  NationalPartyResult,
  NationalSummary,
  PaperMachineSummary,
  PartyChange,
} from "@/data/dashboard/dashboardTypes";

const NATIONAL_THRESHOLD_PCT = 4;
const MIN_PCT_FOR_GAINER_CONSIDERATION = 1;

const round = (n: number, digits = 2) => {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
};

const readSectionIds = (path: string): string[] => {
  if (!fs.existsSync(path)) return [];
  try {
    const arr = JSON.parse(fs.readFileSync(path, "utf-8")) as Array<{
      section?: string;
    }>;
    return arr.map((r) => r.section).filter((s): s is string => !!s);
  } catch {
    return [];
  }
};

const readProblemSectionIds = (path: string): string[] => {
  if (!fs.existsSync(path)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(path, "utf-8")) as {
      neighborhoods?: Array<{ sections?: Array<{ section?: string }> }>;
    };
    const ids: string[] = [];
    data.neighborhoods?.forEach((n) => {
      n.sections?.forEach((s) => {
        if (s.section) ids.push(s.section);
      });
    });
    return ids;
  } catch {
    return [];
  }
};

const computeAnomalies = (
  reportsFolder: string,
  problemSectionsFile: string,
): AnomalyCounts => {
  const sectionsFolder = `${reportsFolder}/section`;
  const recount = readSectionIds(`${sectionsFolder}/recount.json`);
  const recountZeroVotes = readSectionIds(
    `${sectionsFolder}/recount_zero_votes.json`,
  );
  const suemgAdded = readSectionIds(`${sectionsFolder}/suemg_added.json`);
  const suemgRemoved = readSectionIds(`${sectionsFolder}/suemg_removed.json`);
  const suemgMissingFlash = readSectionIds(
    `${sectionsFolder}/suemg_missing_flash.json`,
  );
  const problemSections = readProblemSectionIds(problemSectionsFile);

  const all = new Set<string>([
    ...recount,
    ...recountZeroVotes,
    ...suemgAdded,
    ...suemgRemoved,
    ...suemgMissingFlash,
    ...problemSections,
  ]);

  return {
    total: all.size,
    recount: new Set(recount).size,
    recountZeroVotes: new Set(recountZeroVotes).size,
    suemgAdded: new Set(suemgAdded).size,
    suemgRemoved: new Set(suemgRemoved).size,
    suemgMissingFlash: new Set(suemgMissingFlash).size,
    problemSections: new Set(problemSections).size,
  };
};

const sumPaperMachine = (votes: StatsVote[] | undefined) => {
  if (!votes) return undefined;
  let paper = 0;
  let machine = 0;
  for (const v of votes) {
    paper += v.paperVotes ?? 0;
    machine += v.machineVotes ?? 0;
  }
  return { paper, machine };
};

const computePaperMachine = (
  current: StatsVote[],
  prior?: StatsVote[],
): PaperMachineSummary | undefined => {
  const cur = sumPaperMachine(current);
  if (!cur) return undefined;
  const total = cur.paper + cur.machine;
  if (!total) return undefined;
  const paperPct = round((100 * cur.paper) / total);
  const machinePct = round((100 * cur.machine) / total);
  const priorSum = sumPaperMachine(prior);
  const priorTotal = priorSum ? priorSum.paper + priorSum.machine : 0;
  const priorPaperPct =
    priorSum && priorTotal
      ? round((100 * priorSum.paper) / priorTotal)
      : undefined;
  const priorMachinePct =
    priorSum && priorTotal
      ? round((100 * priorSum.machine) / priorTotal)
      : undefined;
  return {
    paperVotes: cur.paper,
    machineVotes: cur.machine,
    total,
    paperPct,
    machinePct,
    priorPaperPct,
    priorMachinePct,
    deltaPaperPct:
      priorPaperPct !== undefined ? round(paperPct - priorPaperPct) : undefined,
    deltaMachinePct:
      priorMachinePct !== undefined
        ? round(machinePct - priorMachinePct)
        : undefined,
  };
};

const computePartyChange = (
  current: StatsVote[],
  prior: StatsVote[] | undefined,
  parties: PartyInfo[],
  totalCurrent: number,
  totalPrior: number,
): {
  gainer?: PartyChange;
  loser?: PartyChange;
  changes: Map<number, { priorPct: number; deltaPct: number }>;
} => {
  if (!prior || !totalPrior) return { changes: new Map() };
  const candidates = current
    .map((v) => {
      const partyInfo = parties.find((p) => p.number === v.partyNum);
      const currentPct = totalCurrent ? (100 * v.totalVotes) / totalCurrent : 0;
      const { prevTotalVotes } = findPrevVotes(
        { ...partyInfo, ...v },
        prior,
        true,
      );
      // New parties (no prior match) baseline at 0 — a new party at 44% IS the biggest gainer.
      const priorVotes = prevTotalVotes ?? 0;
      const priorPct = totalPrior ? (100 * priorVotes) / totalPrior : 0;
      if (
        currentPct < MIN_PCT_FOR_GAINER_CONSIDERATION &&
        priorPct < MIN_PCT_FOR_GAINER_CONSIDERATION
      ) {
        return undefined;
      }
      return {
        partyNum: v.partyNum,
        nickName: v.nickName,
        color: partyInfo?.color,
        currentVotes: v.totalVotes,
        currentPct: round(currentPct),
        priorVotes,
        priorPct: round(priorPct),
        deltaVotes: v.totalVotes - priorVotes,
        deltaPct: round(currentPct - priorPct),
      } as PartyChange;
    })
    .filter((c): c is PartyChange => c !== undefined);

  const changes = new Map(
    candidates.map((c) => [
      c.partyNum,
      { priorPct: c.priorPct, deltaPct: c.deltaPct },
    ]),
  );

  if (candidates.length === 0) return { changes };
  const sorted = [...candidates].sort((a, b) => b.deltaPct - a.deltaPct);
  return {
    gainer: sorted[0],
    loser: sorted[sorted.length - 1],
    changes,
  };
};

export const generateNationalSummary = ({
  publicFolder,
  reportsFolder,
  election,
  priorElection,
  parties,
  seatsByElection,
  stringify,
}: {
  publicFolder: string;
  reportsFolder: string;
  election: ElectionInfo;
  priorElection?: ElectionInfo;
  parties: PartyInfo[];
  seatsByElection: Record<string, PartySeats[]>;
  stringify: (o: object) => string;
}) => {
  const year = election.name;
  const protocol = election.results?.protocol;
  const currentVotes: StatsVote[] = election.results?.votes ?? [];
  const priorVotes: StatsVote[] | undefined = priorElection?.results?.votes;

  const totalCurrent = currentVotes.reduce((s, v) => s + v.totalVotes, 0);
  const totalPrior = priorVotes?.reduce((s, v) => s + v.totalVotes, 0) ?? 0;

  const seats = seatsByElection[year] ?? [];
  const seatByPartyNum = new Map(seats.map((s) => [s.partyNum, s.seats]));

  const turnoutPct =
    protocol?.numRegisteredVoters && protocol.totalActualVoters
      ? (100 * protocol.totalActualVoters) / protocol.numRegisteredVoters
      : 0;
  const priorProtocol = priorElection?.results?.protocol;
  const priorTurnoutPct =
    priorProtocol?.numRegisteredVoters && priorProtocol.totalActualVoters
      ? (100 * priorProtocol.totalActualVoters) /
        priorProtocol.numRegisteredVoters
      : undefined;

  const { gainer, loser, changes } = computePartyChange(
    currentVotes,
    priorVotes,
    parties,
    totalCurrent,
    totalPrior,
  );

  const partyResults: NationalPartyResult[] = currentVotes
    .map((v) => {
      const partyInfo = parties.find((p) => p.number === v.partyNum);
      const pct = totalCurrent ? (100 * v.totalVotes) / totalCurrent : 0;
      const change = changes.get(v.partyNum);
      return {
        partyNum: v.partyNum,
        nickName: v.nickName,
        name: partyInfo?.name,
        name_en: partyInfo?.name_en,
        color: partyInfo?.color,
        totalVotes: v.totalVotes,
        pct: round(pct),
        priorPct: change?.priorPct,
        deltaPct: change?.deltaPct,
        seats: seatByPartyNum.get(v.partyNum),
        passedThreshold: pct >= NATIONAL_THRESHOLD_PCT,
      };
    })
    .sort((a, b) => b.totalVotes - a.totalVotes);

  const anomalies = computeAnomalies(
    reportsFolder,
    `${publicFolder}/${year}/problem_sections.json`,
  );

  const paperMachine = computePaperMachine(currentVotes, priorVotes);

  const summary: NationalSummary = {
    election: year,
    priorElection: priorElection?.name,
    turnout: {
      actual: protocol?.totalActualVoters ?? 0,
      registered: protocol?.numRegisteredVoters ?? 0,
      pct: round(turnoutPct),
      priorPct:
        priorTurnoutPct !== undefined ? round(priorTurnoutPct) : undefined,
      deltaPct:
        priorTurnoutPct !== undefined
          ? round(turnoutPct - priorTurnoutPct)
          : undefined,
    },
    topGainer: gainer,
    topLoser: loser,
    anomalies,
    paperMachine,
    parties: partyResults,
  };

  const outFile = `${publicFolder}/${year}/national_summary.json`;
  fs.writeFileSync(outFile, stringify(summary), "utf8");
  console.log("Successfully added file ", outFile);
};
