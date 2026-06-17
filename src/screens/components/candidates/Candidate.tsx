import { FC, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useResolvedCandidate } from "@/data/candidates/useResolvedCandidate";
import { useCandidateElectionFallback } from "@/data/candidates/useCandidateElectionFallback";
import { useCandidateName } from "@/data/candidates/useCandidateName";
import { useElectionContext } from "@/data/ElectionContext";
import { CandidateHeader } from "./CandidateHeader";
import { MpProfileHeader } from "./MpProfileHeader";
import { MpFinancialDeclarations } from "./MpFinancialDeclarations";
import { MpAssetsSummary } from "./MpAssetsSummary";
import { MpManagementRoles } from "./MpManagementRoles";
import { MpConnectionsMini } from "./MpConnectionsMini";
import { MpProfileSections } from "./MpProfileSections";
import { MpScorecardTile } from "./MpScorecardTile";
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
  const { isLoading, matches, canonical, parsed } = useResolvedCandidate(name);
  const { isEn, nameForBg } = useCandidateName();
  const { selected, setSelected } = useElectionContext();

  // A bare-name /candidate/:id URL (search-engine results, old shared links)
  // resolves against whatever election is currently selected. When the person
  // ran in an earlier cycle they match no one in the latest election and the
  // page renders blank — so probe the other elections and switch context to
  // the most recent one that has them.
  const [switchedElection, setSwitchedElection] = useState(false);
  const needsElectionFallback =
    !isLoading &&
    matches.length === 0 &&
    parsed?.kind === "name" &&
    !switchedElection;
  const { isProbing, fallbackElection } = useCandidateElectionFallback(
    name,
    needsElectionFallback,
  );
  useEffect(() => {
    if (fallbackElection && fallbackElection !== selected) {
      setSwitchedElection(true);
      setSelected(fallbackElection);
    }
  }, [fallbackElection, selected, setSelected]);

  if (
    isLoading ||
    (needsElectionFallback && (isProbing || !!fallbackElection))
  ) {
    // Reserve roughly the height of a typical candidate page so the layout
    // doesn't jump from a one-line "Loading…" to a multi-card screen once
    // the candidate index resolves. This was the dominant CLS source on
    // /candidate/* pages because the swap inserts ~1500px above the fold.
    // The election-fallback probe reuses the same skeleton so a search-engine
    // visitor sees "Loading…" instead of a blank page while we switch cycles.
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
          mpEntry={null}
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
        mpEntry={canonical.mpEntry}
        cikRows={canonical.cikRows}
        seoDescription={`Results for party candidate ${headerName}`}
      />

      {canonical.mpId != null && <MpProfileHeader name={lookupName} />}

      {canonical.mpId != null && <MpScorecardTile name={lookupName} />}

      <CandidateDashboardCards name={lookupName} linkSlug={linkSlug} />

      {canonical.mpId != null && (
        <MpProfileSections name={lookupName} linkSlug={linkSlug} />
      )}
    </div>
  );
};
