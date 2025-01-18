import { PartyFinancing, PartyInfo } from "@/data/dataTypes";
import { useElectionContext } from "@/data/ElectionContext";
import { useLastYearParties } from "@/data/parties/useLastYearParties";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<
  [string, string | null | undefined, number | null | undefined]
>): Promise<PartyFinancing | null> => {
  if (!queryKey[1] || !queryKey[2]) {
    return null;
  }
  const response = await fetch(
    `/${queryKey[1]}/parties/financing/${queryKey[2]}/filing.json`,
  );
  const data = await response.json();
  return data;
};

export const useFinancing = (party?: PartyInfo) => {
  const { selected, priorElections } = useElectionContext();
  const { data: financing, isError } = useQuery({
    queryKey: ["parties_financing_per_party", selected, party?.number],
    queryFn,
  });

  const { partyByNickName } = useLastYearParties();
  const lyParty = partyByNickName(party?.nickName);
  const { data: priorFinancing } = useQuery({
    queryKey: [
      "parties_financing_per_party_prev_year",
      priorElections?.name,
      lyParty?.number,
    ],
    queryFn,
  });
  return { financing, isError, priorFinancing };
};
