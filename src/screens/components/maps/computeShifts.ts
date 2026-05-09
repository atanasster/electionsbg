import {
  ElectionResults,
  PartyInfo,
  StatsVote,
  Votes,
} from "@/data/dataTypes";
import {
  findPrevVotes,
  matchPartyNickName,
  topParty,
  totalAllVotes,
} from "@/data/utils";

export type RegionShift = {
  currentPartyNum: number;
  currentNickName: string;
  currentColor?: string;
  currentPct: number;
  priorPartyNum?: number;
  priorNickName?: string;
  priorColor?: string;
  /** Vote share (pp) for the *current* top party in the *prior* election. */
  currentPartyPriorPct?: number;
  /** Change in pp for the current top party. Positive = gained ground. */
  deltaPp?: number;
  /** True when the winning party identity changed between elections. */
  flipped: boolean;
};

const enrichVotes = (
  votes: Votes[],
  parties: PartyInfo[] | undefined,
): StatsVote[] =>
  votes.map((v) => {
    const p = parties?.find((x) => x.number === v.partyNum);
    return {
      ...v,
      number: v.partyNum,
      nickName: p?.nickName ?? "",
      commonName: p?.commonName,
    };
  });

export function computeShifts<TEntry extends ElectionResults>({
  current,
  prior,
  currentParties,
  priorParties,
  keyOf,
}: {
  current?: TEntry[];
  prior?: TEntry[];
  currentParties?: PartyInfo[];
  priorParties?: PartyInfo[];
  keyOf: (entry: TEntry) => string;
}): Map<string, RegionShift> {
  const out = new Map<string, RegionShift>();
  if (!current) return out;

  const priorByKey = new Map<string, TEntry>();
  prior?.forEach((e) => priorByKey.set(keyOf(e), e));

  for (const entry of current) {
    const total = totalAllVotes(entry.results.votes);
    const top = topParty(entry.results.votes);
    if (!total || !top) continue;
    const topInfo = currentParties?.find((p) => p.number === top.partyNum);
    const currentPct = (top.totalVotes / total) * 100;

    const priorEntry = priorByKey.get(keyOf(entry));
    let priorPartyNum: number | undefined;
    let priorNickName: string | undefined;
    let priorColor: string | undefined;
    let currentPartyPriorPct: number | undefined;
    let deltaPp: number | undefined;
    let flipped = false;

    if (priorEntry && priorParties) {
      const priorTotal = totalAllVotes(priorEntry.results.votes);
      const priorEnriched = enrichVotes(priorEntry.results.votes, priorParties);

      if (topInfo && priorTotal) {
        const prev = findPrevVotes(topInfo, priorEnriched, true);
        if (prev.prevTotalVotes !== undefined) {
          currentPartyPriorPct = (prev.prevTotalVotes / priorTotal) * 100;
          deltaPp = currentPct - currentPartyPriorPct;
        }
      }

      const priorTop = topParty(priorEntry.results.votes);
      if (priorTop) {
        priorPartyNum = priorTop.partyNum;
        const priorTopInfo = priorParties.find(
          (p) => p.number === priorTop.partyNum,
        );
        priorNickName = priorTopInfo?.nickName;
        priorColor = priorTopInfo?.color;
        if (topInfo && priorTopInfo) {
          flipped = !matchPartyNickName(
            topInfo,
            {
              number: priorTopInfo.number,
              nickName: priorTopInfo.nickName,
              commonName: priorTopInfo.commonName,
            },
            true,
          );
        } else {
          flipped = topInfo?.number !== priorTopInfo?.number;
        }
      }
    }

    out.set(keyOf(entry), {
      currentPartyNum: top.partyNum,
      currentNickName: topInfo?.nickName ?? "",
      currentColor: topInfo?.color,
      currentPct,
      priorPartyNum,
      priorNickName,
      priorColor,
      currentPartyPriorPct,
      deltaPp,
      flipped,
    });
  }

  return out;
}
