import { Title } from "@/ux/Title";
import { FC, useMemo } from "react";
import { useCandidates } from "@/data/preferences/useCandidates";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { PartyLink } from "../party/PartyLink";
import { RegionLink } from "../regions/RegionLink";
import { MpProfileHeader } from "./MpProfileHeader";
import { CandidateDashboardCards } from "@/screens/dashboard/CandidateDashboardCards";

export const Candidate: FC<{ name: string }> = ({ name }) => {
  const { candidates } = useCandidates();
  const { findParty } = usePartyInfo();
  const candidateInfo = useMemo(
    () => candidates?.filter((c) => c.name === name),
    [candidates, name],
  );

  return (
    <div className="w-full">
      <Title
        description={`Results for party candidate ${name}`}
        className="md:pb-8"
      >
        {name}
      </Title>

      <MpProfileHeader name={name} />

      <table className="flex justify-center py-2">
        <tbody>
          {candidateInfo?.map((c) => {
            const party = findParty(c.partyNum);
            return (
              <tr key={`${c.oblast}-${c.pref}`}>
                <td>
                  <div className="my-1">
                    <PartyLink party={party} width="w-14"></PartyLink>
                  </div>
                </td>
                <td>
                  <div className="text-lg px-2 font-semibold">
                    <RegionLink oblast={c.oblast} />
                  </div>
                </td>
                <td>
                  <div className="text-lg px-2 font-semibold">{`#${c.pref}`}</div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <CandidateDashboardCards name={name} />
    </div>
  );
};
