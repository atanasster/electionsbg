import { FC } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Briefcase, Landmark, Vote, Wallet } from "lucide-react";
import { Link } from "@/ux/Link";
import { useResolvedCandidate } from "@/data/candidates/useResolvedCandidate";
import { useCandidateName } from "@/data/candidates/useCandidateName";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { CandidateHeader } from "./CandidateHeader";
import { MpProfileHeader } from "./MpProfileHeader";
import { MpFinancialDeclarations } from "./MpFinancialDeclarations";
import { MpAssetsSummary } from "./MpAssetsSummary";
import { MpManagementRoles } from "./MpManagementRoles";
import { MpConnectionsMini } from "./MpConnectionsMini";
import { MpConnectedContractsTile } from "./MpConnectedContractsTile";
import { MpVotingTile } from "./MpVotingTile";
import { MpTwinsTile } from "./MpTwinsTile";
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
  const { isLoading, matches, canonical } = useResolvedCandidate(name);
  const { isEn, nameForBg } = useCandidateName();

  if (isLoading) {
    // Reserve roughly the height of a typical candidate page so the layout
    // doesn't jump from a one-line "Loading…" to a multi-card screen once
    // the candidate index resolves. This was the dominant CLS source on
    // /candidate/* pages because the swap inserts ~1500px above the fold.
    return (
      <div className="w-full py-6">
        <div className="text-sm text-muted-foreground text-center">
          {t("loading") || "Loading…"}
        </div>
        <div aria-hidden className="min-h-[1200px]" />
      </div>
    );
  }

  if (matches.length === 0) {
    // No candidate / MP matches the URL — render the bare-name page so the
    // sub-components can quietly render whatever historical data they have.
    const headerName = nameForBg(name);
    return (
      <div className="w-full">
        <CandidateHeader
          displayName={headerName}
          lookupName={name}
          seoDescription={`Results for party candidate ${headerName}`}
        />
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

  // Bulgarian form is the lookup key for sub-components (they query against
  // BG-keyed data files); the heading shown to the user follows the locale.
  const lookupName = canonical.name;
  const headerName = isEn ? canonical.name_en : canonical.name;
  const linkSlug = canonical.slug;

  return (
    <div className="w-full">
      <CandidateHeader
        displayName={headerName}
        lookupName={lookupName}
        cikRows={canonical.cikRows}
        seoDescription={`Results for party candidate ${headerName}`}
      />

      {canonical.mpId != null && <MpProfileHeader name={lookupName} />}

      <CandidateDashboardCards name={lookupName} linkSlug={linkSlug} />

      {canonical.mpId != null && (
        <>
          <DashboardSection
            id="parliament"
            title={t("mp_section_voting") || "Voting & similarity"}
            icon={Vote}
          >
            <MpVotingTile name={lookupName} linkSlug={linkSlug} />
            <MpTwinsTile name={lookupName} />
          </DashboardSection>

          <DashboardSection
            id="declarations"
            title={t("mp_section_assets") || "Assets & declarations"}
            icon={Wallet}
          >
            <MpAssetsSummary name={lookupName} linkSlug={linkSlug} />
            <MpFinancialDeclarations name={lookupName} />
          </DashboardSection>

          <DashboardSection
            id="declarations"
            title={t("mp_section_business") || "Business & management"}
            icon={Briefcase}
          >
            <MpManagementRoles name={lookupName} />
            <MpConnectionsMini name={lookupName} linkSlug={linkSlug} />
          </DashboardSection>

          <DashboardSection
            id="procurement"
            title={t("mp_section_procurement") || "Public procurement"}
            icon={Landmark}
          >
            <MpConnectedContractsTile name={lookupName} linkSlug={linkSlug} />
          </DashboardSection>

          <div className="mt-6 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{t("mp_section_explore_more") || "Explore further"}:</span>
            <Link
              to="/governance"
              underline={false}
              className="inline-flex items-center gap-1 rounded-full border bg-card px-3 py-1 text-primary hover:underline"
            >
              {t("nav_governance") || "Governance"}
              <ArrowRight className="h-3 w-3" />
            </Link>
            <Link
              to="/parliament"
              underline={false}
              className="inline-flex items-center gap-1 rounded-full border bg-card px-3 py-1 text-primary hover:underline"
            >
              {t("dashboard_section_parliament")}
              <ArrowRight className="h-3 w-3" />
            </Link>
            <Link
              to="/connections"
              underline={false}
              className="inline-flex items-center gap-1 rounded-full border bg-card px-3 py-1 text-primary hover:underline"
            >
              {t("connections_link_label")}
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </>
      )}
    </div>
  );
};
