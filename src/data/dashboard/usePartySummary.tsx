import { useMemo } from "react";
import { PartyInfo } from "../dataTypes";
import { useElectionContext } from "../ElectionContext";
import { findPrevVotes, partyVotesPosition, totalAllVotes } from "../utils";
import { usePartyByRegion } from "../parties/usePartyByLocation";
import { useRegions } from "../regions/useRegions";
import { useRegionVotes } from "../regions/useRegionVotes";
import {
  PartyDashboardSummary,
  PartyLocationRow,
  PartySwingRegion,
} from "./partyDashboardTypes";
import { PaperMachineSummary } from "./dashboardTypes";

const round = (n: number, digits = 2) => {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
};

export const usePartySummary = (
  party?: PartyInfo,
): { data?: PartyDashboardSummary; isLoading: boolean } => {
  const { selected, electionStats, priorElections } = useElectionContext();
  const { rows: regionRows, isLoading: regionsLoading } = usePartyByRegion(
    party?.number,
  );
  const { findRegion } = useRegions();
  const { votes: regionVotes } = useRegionVotes();

  const data = useMemo<PartyDashboardSummary | undefined>(() => {
    if (!party || !selected) return undefined;
    if (!regionRows) return undefined;

    const partyVotes = electionStats?.results?.votes.find(
      (v) => v.number === party.number,
    );
    const totalNational = totalAllVotes(electionStats?.results?.votes) ?? 0;
    const totalVotes = partyVotes?.totalVotes ?? 0;
    const pctNational = totalNational ? (100 * totalVotes) / totalNational : 0;
    const pos = partyVotesPosition(party.number, electionStats?.results?.votes);

    const prior = findPrevVotes(party, priorElections?.results?.votes, true);
    const priorTotalNational = totalAllVotes(priorElections?.results?.votes);
    const priorTotalVotes = prior.prevTotalVotes;
    const priorPctNational =
      priorTotalNational && priorTotalVotes !== undefined
        ? (100 * priorTotalVotes) / priorTotalNational
        : undefined;
    const priorPos = prior.partyNum
      ? partyVotesPosition(prior.partyNum, priorElections?.results?.votes)
      : undefined;

    const paper = partyVotes?.paperVotes ?? 0;
    const machine = partyVotes?.machineVotes ?? 0;
    const pmTotal = paper + machine;
    const priorPaper = prior.prevPaperVotes ?? 0;
    const priorMachine = prior.prevMachineVotes ?? 0;
    const priorPmTotal = priorPaper + priorMachine;
    const paperMachine: PaperMachineSummary | undefined = pmTotal
      ? {
          paperVotes: paper,
          machineVotes: machine,
          total: pmTotal,
          paperPct: round((100 * paper) / pmTotal),
          machinePct: round((100 * machine) / pmTotal),
          priorPaperPct: priorPmTotal
            ? round((100 * priorPaper) / priorPmTotal)
            : undefined,
          priorMachinePct: priorPmTotal
            ? round((100 * priorMachine) / priorPmTotal)
            : undefined,
          deltaPaperPct: priorPmTotal
            ? round((100 * paper) / pmTotal - (100 * priorPaper) / priorPmTotal)
            : undefined,
          deltaMachinePct: priorPmTotal
            ? round(
                (100 * machine) / pmTotal - (100 * priorMachine) / priorPmTotal,
              )
            : undefined,
        }
      : undefined;

    // Region-level: votes share of party total, plus region's own % for this party
    const regions: PartyLocationRow[] = regionRows
      .map((r) => {
        const info = findRegion(r.oblast);
        return {
          key: r.oblast,
          name: info?.name,
          name_en: info?.name_en,
          long_name: info?.long_name,
          long_name_en: info?.long_name_en,
          oblast: r.oblast,
          position: r.position,
          totalVotes: r.totalVotes,
          paperVotes: r.paperVotes,
          machineVotes: r.machineVotes,
          allVotes: r.allVotes,
          pctOfLocation: r.allVotes ? (100 * r.totalVotes) / r.allVotes : 0,
          pctOfPartyTotal: totalVotes ? (100 * r.totalVotes) / totalVotes : 0,
          prevYearVotes: r.prevYearVotesConsolidated ?? r.prevYearVotes,
          deltaVotes:
            r.prevYearVotesConsolidated !== undefined ||
            r.prevYearVotes !== undefined
              ? r.totalVotes -
                (r.prevYearVotesConsolidated ?? r.prevYearVotes ?? 0)
              : undefined,
        } as PartyLocationRow;
      })
      .sort((a, b) => b.totalVotes - a.totalVotes);

    // Build swing list using regional totals from region_votes.json
    const regionalTotalByKey = new Map<string, number>();
    if (regionVotes) {
      for (const rv of regionVotes) {
        const sum = rv.results.votes.reduce((s, v) => s + v.totalVotes, 0);
        regionalTotalByKey.set(rv.key, sum);
      }
    }
    const swings: PartySwingRegion[] = regions
      .map((r) => {
        const allVotes = r.allVotes;
        const currentPct = allVotes ? (100 * r.totalVotes) / allVotes : 0;
        // Estimate prior pct using the prior-year vote ratio scaled by current
        // location votes (an approximation; an exact value would need historical
        // location totals which aren't in this file).
        const priorVotes = r.prevYearVotes;
        const priorPct =
          priorVotes !== undefined && allVotes
            ? (100 * priorVotes) / allVotes
            : undefined;
        return {
          key: r.key,
          name: r.name,
          oblast: r.oblast,
          position: r.position,
          currentPct: round(currentPct),
          priorPct: priorPct !== undefined ? round(priorPct) : undefined,
          deltaPctPoints:
            priorPct !== undefined ? round(currentPct - priorPct) : undefined,
          totalVotes: r.totalVotes,
          prevYearVotes: r.prevYearVotes,
        } as PartySwingRegion;
      })
      .filter((s) => s.deltaPctPoints !== undefined);

    const swingsSorted = [...swings].sort(
      (a, b) => (b.deltaPctPoints ?? 0) - (a.deltaPctPoints ?? 0),
    );

    return {
      election: selected,
      priorElection: priorElections?.name,
      partyNum: party.number,
      nickName: party.nickName,
      name: party.name,
      name_en: party.name_en,
      color: party.color,

      totalVotes,
      pctNational: round(pctNational),
      position: pos?.position ?? 0,
      passedThreshold: pctNational >= 4,

      priorTotalVotes,
      priorPctNational:
        priorPctNational !== undefined ? round(priorPctNational) : undefined,
      priorPosition: priorPos?.position,
      deltaVotes:
        priorTotalVotes !== undefined
          ? totalVotes - priorTotalVotes
          : undefined,
      deltaPctNational:
        priorPctNational !== undefined
          ? round(pctNational - priorPctNational)
          : undefined,
      deltaPosition:
        priorPos?.position && pos?.position
          ? priorPos.position - pos.position
          : undefined,

      paperMachine,

      topRegion: regions[0],
      bottomRegion: regions[regions.length - 1],
      biggestGainerRegion: swingsSorted[0],
      biggestLoserRegion: swingsSorted[swingsSorted.length - 1],

      regions,
      swings,
    };
  }, [
    party,
    selected,
    regionRows,
    electionStats,
    priorElections,
    findRegion,
    regionVotes,
  ]);

  return {
    data,
    isLoading: regionsLoading,
  };
};
