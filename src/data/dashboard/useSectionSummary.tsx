import { useMemo } from "react";
import {
  NationalPartyResult,
  NationalSummary,
  PaperMachineSummary,
  PartyChange,
} from "./dashboardTypes";
import { useSectionsVotes } from "../sections/useSectionsVotes";
import { useSectionStats } from "../sections/useSectionStats";
import { useElectionContext } from "../ElectionContext";
import { usePartyInfo } from "../parties/usePartyInfo";
import { findPrevVotes } from "../utils";
import { StatsVote } from "../dataTypes";

const NATIONAL_THRESHOLD_PCT = 4;
const MIN_PCT_FOR_GAINER_CONSIDERATION = 1;
const round = (n: number, digits = 2) => {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
};

export const useSectionSummary = (
  sectionCode?: string | null,
): { data?: NationalSummary; isLoading: boolean } => {
  const { selected, priorElections } = useElectionContext();
  const section = useSectionsVotes(sectionCode);
  const { prevVotes } = useSectionStats(sectionCode);
  const { parties: partyInfos } = usePartyInfo();

  const data = useMemo<NationalSummary | undefined>(() => {
    if (!sectionCode || !selected) return undefined;
    if (!section) return undefined;

    const protocol = section.results.protocol;
    const currentVotes = section.results.votes;

    const priorVotesArr: StatsVote[] | undefined = prevVotes?.results?.votes;

    const totalCurrent = currentVotes.reduce((s, v) => s + v.totalVotes, 0);
    const totalPrior =
      priorVotesArr?.reduce((s, v) => s + v.totalVotes, 0) ?? 0;

    const turnoutPct =
      protocol?.numRegisteredVoters && protocol.totalActualVoters
        ? (100 * protocol.totalActualVoters) / protocol.numRegisteredVoters
        : 0;
    const priorProtocol = prevVotes?.results?.protocol;
    const priorTurnoutPct =
      priorProtocol?.numRegisteredVoters && priorProtocol.totalActualVoters
        ? (100 * priorProtocol.totalActualVoters) /
          priorProtocol.numRegisteredVoters
        : undefined;

    let paper = 0;
    let machine = 0;
    for (const v of currentVotes) {
      paper += v.paperVotes ?? 0;
      machine += v.machineVotes ?? 0;
    }
    const pmTotal = paper + machine;
    let priorPaper = 0;
    let priorMachine = 0;
    if (priorVotesArr) {
      for (const v of priorVotesArr) {
        priorPaper += v.paperVotes ?? 0;
        priorMachine += v.machineVotes ?? 0;
      }
    }
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

    const changes = new Map<
      number,
      { priorPct: number; deltaPct: number; priorVotes: number }
    >();
    let gainer: PartyChange | undefined;
    let loser: PartyChange | undefined;

    if (priorVotesArr && totalPrior) {
      const candidates: PartyChange[] = currentVotes
        .map((v) => {
          const partyInfo = partyInfos?.find((p) => p.number === v.partyNum);
          const nickName = partyInfo?.nickName;
          if (!nickName) return undefined;
          const currentPct = totalCurrent
            ? (100 * v.totalVotes) / totalCurrent
            : 0;
          const { prevTotalVotes } = findPrevVotes(
            { ...partyInfo, ...v, nickName },
            priorVotesArr,
            true,
          );
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
            nickName,
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

      candidates.forEach((c) =>
        changes.set(c.partyNum, {
          priorPct: c.priorPct,
          deltaPct: c.deltaPct,
          priorVotes: c.priorVotes,
        }),
      );
      if (candidates.length > 0) {
        const sorted = [...candidates].sort((a, b) => b.deltaPct - a.deltaPct);
        gainer = sorted[0];
        loser = sorted[sorted.length - 1];
      }
    }

    const sortedByVotes = [...currentVotes].sort(
      (a, b) => b.totalVotes - a.totalVotes,
    );
    const topByVotesNums = new Set(
      sortedByVotes.slice(0, 6).map((v) => v.partyNum),
    );
    const partyResults: NationalPartyResult[] = sortedByVotes
      .map((v) => {
        const partyInfo = partyInfos?.find((p) => p.number === v.partyNum);
        if (!partyInfo) return undefined;
        const pct = totalCurrent ? (100 * v.totalVotes) / totalCurrent : 0;
        const change = changes.get(v.partyNum);
        const passedThreshold =
          pct >= NATIONAL_THRESHOLD_PCT || topByVotesNums.has(v.partyNum);
        return {
          partyNum: v.partyNum,
          nickName: partyInfo.nickName,
          name: partyInfo.name,
          name_en: partyInfo.name_en,
          color: partyInfo.color,
          totalVotes: v.totalVotes,
          pct: round(pct),
          priorPct: change?.priorPct,
          deltaPct: change?.deltaPct,
          passedThreshold,
        } as NationalPartyResult;
      })
      .filter((p): p is NationalPartyResult => p !== undefined);

    return {
      election: selected,
      priorElection: priorElections?.name,
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
      anomalies: {
        total: 0,
        recount: 0,
        recountZeroVotes: 0,
        suemgAdded: 0,
        suemgRemoved: 0,
        suemgMissingFlash: 0,
        problemSections: 0,
      },
      paperMachine,
      parties: partyResults,
    };
  }, [sectionCode, selected, section, prevVotes, partyInfos, priorElections]);

  return {
    data,
    isLoading: !section || (!!sectionCode && !partyInfos),
  };
};
