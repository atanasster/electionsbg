import { PartyInfo, PreferencesInfo } from "@/data/dataTypes";
import { useElectionContext } from "@/data/ElectionContext";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { PreferencesTable } from "../../preferences/PreferencesTable";
import { FC } from "react";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | null | undefined, number]>): Promise<
  PreferencesInfo[] | null
> => {
  if (!queryKey[1] || !queryKey[2]) {
    return null;
  }
  const response = await fetch(
    `/${queryKey[1]}/parties/preferences/${queryKey[2]}/sections.json`,
  );
  const data = await response.json();
  return data;
};
export const PartyCandidatesBySection: FC<{
  party: PartyInfo;
}> = ({ party }) => {
  const { selected } = useElectionContext();
  const { data: preferences } = useQuery({
    queryKey: ["party_preferences_by_section", selected, party.number],
    queryFn,
  });

  return preferences ? (
    <PreferencesTable
      preferences={preferences}
      visibleColumns={["candidate", "ekatte", "section"]}
      hiddenColumns={["party"]}
    />
  ) : null;
};
