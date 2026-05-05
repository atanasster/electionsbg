import { Title } from "@/ux/Title";
import { FC, Fragment } from "react";
import { useTranslation } from "react-i18next";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { useResolvedCandidate } from "@/data/candidates/useResolvedCandidate";
import { PartyLink } from "../party/PartyLink";
import { RegionLink } from "../regions/RegionLink";
import { MpProfileHeader } from "./MpProfileHeader";
import { MpFinancialDeclarations } from "./MpFinancialDeclarations";
import { MpAssetsSummary } from "./MpAssetsSummary";
import { MpManagementRoles } from "./MpManagementRoles";
import { MpConnectionsMini } from "./MpConnectionsMini";
import { CandidateNamesakeChooser } from "./CandidateNamesakeChooser";
import { CandidateDashboardCards } from "@/screens/dashboard/CandidateDashboardCards";

/** Render the dashboard for a single candidate.
 *
 * The /candidate/:id URL accepts three forms (see candidateSlug.ts):
 *   mp-{mpId}            — exact, points at a parliament.bg record
 *   c-{partyNum}-{slug}  — exact, scoped to a CIK candidate group
 *   {bare name}          — legacy / external links; resolves to one
 *                          candidate when unambiguous, otherwise renders
 *                          a chooser so the user can pick.
 *
 * Within a single page render we only show the rows / sub-screens that
 * belong to *this* person, so a name shared by candidates on different
 * parties no longer leaks across people. */
export const Candidate: FC<{ name: string }> = ({ name }) => {
  const { t } = useTranslation();
  const { findParty } = usePartyInfo();
  const { isLoading, matches, canonical } = useResolvedCandidate(name);

  if (isLoading) {
    return (
      <div className="w-full px-4 md:px-8 py-6 text-sm text-muted-foreground">
        {t("loading") || "Loading…"}
      </div>
    );
  }

  if (matches.length === 0) {
    // No candidate / MP matches the URL — render the bare-name page so the
    // sub-components can quietly render whatever historical data they have.
    return (
      <div className="w-full">
        <Title
          description={`Results for party candidate ${name}`}
          className="md:pb-8"
        >
          {name}
        </Title>
        <MpProfileHeader name={name} />
        <CandidateDashboardCards name={name} />
        <MpAssetsSummary name={name} />
        <MpFinancialDeclarations name={name} />
        <MpManagementRoles name={name} />
        <MpConnectionsMini name={name} />
      </div>
    );
  }

  if (!canonical) {
    return <CandidateNamesakeChooser name={name} matches={matches} />;
  }

  const displayName = canonical.name;
  const linkSlug = canonical.slug;

  return (
    <div className="w-full">
      <Title
        description={`Results for party candidate ${displayName}`}
        className="md:pb-8"
      >
        {displayName}
      </Title>

      {canonical.mpId != null && <MpProfileHeader name={displayName} />}

      {canonical.cikRows.length > 0 && (
        <div className="grid grid-cols-[auto_auto_auto] justify-center items-center gap-x-3 gap-y-1.5 px-4 py-2">
          {canonical.cikRows.map((c) => {
            const party = findParty(c.partyNum);
            return (
              <Fragment key={`${c.oblast}-${c.pref}`}>
                <PartyLink party={party} width="w-9 shrink-0" />
                <div className="text-sm sm:text-base font-semibold">
                  <RegionLink oblast={c.oblast} />
                </div>
                <div className="text-sm sm:text-base font-semibold tabular-nums">{`#${c.pref}`}</div>
              </Fragment>
            );
          })}
        </div>
      )}

      <CandidateDashboardCards name={displayName} linkSlug={linkSlug} />

      {canonical.mpId != null && (
        <>
          <MpAssetsSummary name={displayName} linkSlug={linkSlug} />
          <MpFinancialDeclarations name={displayName} />
          <MpManagementRoles name={displayName} />
          <MpConnectionsMini name={displayName} linkSlug={linkSlug} />
        </>
      )}
    </div>
  );
};
