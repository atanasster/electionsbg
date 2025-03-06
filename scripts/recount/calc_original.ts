import { RecountOriginal, Votes } from "@/data/dataTypes";

export const calcRecountOriginal = ({
  originalVotes,
  recountVotes,
}: {
  originalVotes: Votes[];
  recountVotes: Votes[];
}): RecountOriginal => {
  const {
    addedVotes,
    removedVotes,
    addedPaperVotes,
    addedMachineVotes,
    removedPaperVotes,
    removedMachineVotes,
  } = recountVotes.reduce(
    (acc: Omit<RecountOriginal, "votes">, vote) => {
      const or = originalVotes.find((v) => v.partyNum === vote.partyNum);
      if (or) {
        if (vote.totalVotes > or.totalVotes) {
          acc.addedVotes += vote.totalVotes - or.totalVotes;
          acc.addedPaperVotes += (vote.paperVotes || 0) - (or.paperVotes || 0);
          acc.addedMachineVotes +=
            (vote.machineVotes || 0) - (or.machineVotes || 0);
        } else if (vote.totalVotes < or.totalVotes) {
          acc.removedVotes -= or.totalVotes - vote.totalVotes;
          acc.removedPaperVotes -=
            (or.paperVotes || 0) - (vote.paperVotes || 0);
          acc.removedMachineVotes -=
            (or.machineVotes || 0) - (vote.machineVotes || 0);
        }
      }
      return acc;
    },
    {
      addedVotes: 0,
      removedVotes: 0,
      addedPaperVotes: 0,
      addedMachineVotes: 0,
      removedPaperVotes: 0,
      removedMachineVotes: 0,
    },
  );
  return {
    votes: originalVotes,
    addedVotes,
    removedVotes,
    addedPaperVotes,
    addedMachineVotes,
    removedPaperVotes,
    removedMachineVotes,
  };
};
