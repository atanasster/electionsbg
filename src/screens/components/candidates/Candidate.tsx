import { FC, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useResolvedCandidate } from "@/data/candidates/useResolvedCandidate";
import { useCandidateElectionFallback } from "@/data/candidates/useCandidateElectionFallback";
import { useCandidateName } from "@/data/candidates/useCandidateName";
import { useElectionContext } from "@/data/ElectionContext";
import { useMps } from "@/data/parliament/useMps";
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

  // An `mp-<id>` URL points at a parliament.bg record that may not be a
  // candidate on the *selected* ballot (the election-scoped resolver above then
  // matches no one and the page would render blank). Fall back to the global,
  // election-independent parliament roster so deep links from the procurement
  // scanner, search, etc. resolve to the MP's full dashboard. See the same
  // pattern in CandidateProcurementScreen.
  //
  // The roster is ~949 KB, so gate the fetch on `needRoster` — only the rare
  // mp-id-not-on-this-ballot case loads it, preserving the candidate-page data
  // diet for the common (resolved / CIK) cases.
  const mpIdParam = parsed?.kind === "mp" ? parsed.mpId : null;
  const needRoster = mpIdParam != null && !isLoading && matches.length === 0;
  const { findMpById, isLoading: rosterLoading } = useMps(needRoster);
  const rosterMp = needRoster ? findMpById(mpIdParam) : undefined;
  const awaitingRoster = needRoster && !rosterMp && rosterLoading;

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
    (needsElectionFallback && (isProbing || !!fallbackElection)) ||
    awaitingRoster
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

  if (matches.length === 0 && rosterMp) {
    // The selected election has no candidacy for this MP, but the global
    // roster does — render the full MP dashboard keyed by the roster name
    // (sub-components query BG-name-keyed parliament data, which is
    // election-independent). cikRows is absent (no candidacy this cycle).
    const lookupName = rosterMp.name;
    const headerName = isEn ? rosterMp.name_en : rosterMp.name;
    const linkSlug = `mp-${rosterMp.id}`;
    return (
      <div className="w-full">
        <CandidateHeader
          displayName={headerName}
          lookupName={lookupName}
          mpEntry={rosterMp}
          seoDescription={`Results for party candidate ${headerName}`}
        />
        <MpProfileHeader name={lookupName} />
        <MpScorecardTile name={lookupName} />
        <CandidateDashboardCards name={lookupName} linkSlug={linkSlug} />
        <MpProfileSections name={lookupName} linkSlug={linkSlug} />
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
