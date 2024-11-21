import { useEffect, useState, createContext, useContext } from "react";
import { PartyInfo, PartyVotes, Votes } from "./dataTypes";

type PartyContextType = {
  findParty: (partyNum: number) => PartyInfo | undefined;
  topVotesParty: (votes?: Votes[]) => PartyVotes | undefined;
};
const PartyContext = createContext<PartyContextType>({
  findParty: () => undefined,
  topVotesParty: () => undefined,
});

export const PartyContextProvider: React.FC<React.PropsWithChildren> = ({
  children,
}) => {
  const [parties, setParties] = useState<PartyInfo[]>([]);
  useEffect(() => {
    fetch("/2024_10/cik_parties.json")
      .then((response) => response.json())
      .then((data) => {
        setParties(data);
      });
  }, []);

  const findParty = (partyNum: number) =>
    parties.find((p) => p.number === partyNum);
  const topVotesParty = (votes?: Votes[]): PartyVotes | undefined => {
    const tp = votes?.reduce((acc, curr) => {
      if (acc.totalVotes > curr.totalVotes) {
        return acc;
      }
      return curr;
    }, votes[0]);

    return tp ? ({ ...tp, ...findParty(tp.key) } as PartyVotes) : undefined;
  };
  return (
    <PartyContext.Provider value={{ findParty, topVotesParty }}>
      {children}
    </PartyContext.Provider>
  );
};

export const usePartyInfo = () => {
  const context = useContext(PartyContext);
  return context;
};
