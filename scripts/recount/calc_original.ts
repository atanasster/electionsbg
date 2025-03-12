import { RecountOriginal, Votes } from "@/data/dataTypes";
import { addRecountStats, recountStats } from "@/data/utils";

export const calcRecountOriginal = ({
  originalVotes,
  recountVotes,
}: {
  originalVotes: Votes[];
  recountVotes: Votes[];
}): RecountOriginal | undefined => {
  const result = recountVotes.reduce(
    (acc: RecountOriginal, vote) => {
      const or = originalVotes.find((v) => v.partyNum === vote.partyNum) || {
        partyNum: vote.partyNum,
        paperVotes: 0,
        machineVotes: 0,
        totalVotes: 0,
      };
      const stats = recountStats(vote, or);
      addRecountStats({
        dest: acc,
        src: stats,
      });
      acc.votes.push({
        partyNum: vote.partyNum,
        ...stats,
      });
      return acc;
    },
    {
      addedVotes: 0,
      removedVotes: 0,
      addedPaperVotes: 0,
      addedMachineVotes: 0,
      removedPaperVotes: 0,
      removedMachineVotes: 0,
      votes: [],
    },
  );
  if (result.addedVotes || result.removedVotes) {
    return result;
  }
  return undefined;
};
