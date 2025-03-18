import { CalcProcProps } from "../report_types";

export const calcRecountValues = ({
  votes,
  protocol,
  original,
}: CalcProcProps) => {
  const isChanged =
    original && (original.addedVotes !== 0 || original.removedVotes !== 0);

  if (!protocol || !isChanged) {
    return undefined;
  }
  const machineVotes = votes.reduce((acc: number, v) => {
    return acc + (v.machineVotes || 0);
  }, 0);
  const paperVotes = votes.reduce((acc: number, v) => {
    return acc + (v.paperVotes || 0);
  }, 0);
  const addedVotes = original.addedVotes;
  const removedVotes = original.removedVotes;
  const topPartyChange = votes.reduce(
    (acc: { change: number; partyNum: number } | undefined, vote) => {
      const originalVotes = original?.votes.find(
        (v) => v.partyNum === vote.partyNum,
      );
      if (originalVotes) {
        const stats = originalVotes;
        if (stats.addedVotes > (acc?.change || 0)) {
          return {
            partyNum: vote.partyNum,
            change: stats.addedVotes,
          };
        }
      }
      return acc;
    },
    undefined,
  );

  const bottomPartyChange = votes.reduce(
    (acc: { change: number; partyNum: number } | undefined, vote) => {
      const originalVotes = original?.votes.find(
        (v) => v.partyNum === vote.partyNum,
      );
      if (originalVotes) {
        const stats = originalVotes;
        if (stats.removedVotes < (acc?.change || 0)) {
          return {
            partyNum: vote.partyNum,
            change: stats.removedVotes,
          };
        }
      }
      return acc;
    },
    undefined,
  );
  return {
    value: 0,
    addedVotes,
    removedVotes,
    paperVotes,
    machineVotes,
    totalVotes: paperVotes + machineVotes,
    topPartyChange,
    bottomPartyChange,
  };
};
