import { RecountOriginal, Votes } from "@/data/dataTypes";

export const calcRecountOriginal = ({
  originalVotes,
  recountVotes,
}: {
  originalVotes: Votes[];
  recountVotes: Votes[];
}): RecountOriginal | undefined => {
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
        const r_paperVotes = vote.paperVotes || 0;
        const r_machineVotes = vote.machineVotes || 0;
        const o_paperVotes = or.paperVotes || 0;
        const o_machineVotes = or.machineVotes || 0;
        const addedPaperVotes =
          r_paperVotes > o_paperVotes ? r_paperVotes - o_paperVotes : 0;
        const addedMachineVotes =
          r_machineVotes > o_machineVotes ? r_machineVotes - o_machineVotes : 0;
        acc.addedPaperVotes += addedPaperVotes;
        acc.addedMachineVotes += addedPaperVotes;
        acc.addedVotes += addedPaperVotes + addedMachineVotes;
        const removedPaperVotes =
          r_paperVotes < o_paperVotes ? o_paperVotes + r_paperVotes : 0;
        const removedMachineVotes =
          r_machineVotes < o_machineVotes ? r_machineVotes - o_machineVotes : 0;
        acc.removedPaperVotes += removedPaperVotes;
        acc.removedMachineVotes += removedMachineVotes;
        acc.removedVotes += removedMachineVotes + removedPaperVotes;
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
  if (addedVotes || removedVotes) {
    return {
      votes: originalVotes,
      addedVotes,
      removedVotes,
      addedPaperVotes,
      addedMachineVotes,
      removedPaperVotes,
      removedMachineVotes,
    };
  }
  return undefined;
};
