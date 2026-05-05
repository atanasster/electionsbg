import { Title } from "@/ux/Title";
import { FC, useMemo } from "react";
import { useCandidates } from "@/data/preferences/useCandidates";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { PartyLink } from "../party/PartyLink";
import { RegionLink } from "../regions/RegionLink";
import { MpProfileHeader } from "./MpProfileHeader";
import { MpFinancialDeclarations } from "./MpFinancialDeclarations";
import { MpAssetsSummary } from "./MpAssetsSummary";
import { MpManagementRoles } from "./MpManagementRoles";
import { MpConnectionsMini } from "./MpConnectionsMini";
import { CandidateDashboardCards } from "@/screens/dashboard/CandidateDashboardCards";

export const Candidate: FC<{ name: string }> = ({ name }) => {
  const { candidates } = useCandidates();
  const { findParty } = usePartyInfo();
  // The URL name may arrive in any casing — connections links use the
  // all-uppercase parliament.bg form, while internal links use the title-case
  // form from candidates.json. Resolve to the canonical name for the
  // candidate-election data fetches (which key off the title-case form).
  const candidateInfo = useMemo(() => {
    if (!candidates || !name) return undefined;
    const target = name.toLocaleUpperCase();
    return candidates.filter((c) => c.name.toLocaleUpperCase() === target);
  }, [candidates, name]);
  const canonicalName = candidateInfo?.[0]?.name ?? name;

  return (
    <div className="w-full">
      <Title
        description={`Results for party candidate ${canonicalName}`}
        className="md:pb-8"
      >
        {canonicalName}
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

      <CandidateDashboardCards name={canonicalName} />

      <MpAssetsSummary name={name} />
      <MpFinancialDeclarations name={name} />
      <MpManagementRoles name={name} />
      <MpConnectionsMini name={name} />
    </div>
  );
};
