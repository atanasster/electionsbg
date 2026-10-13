import { FC } from "react";
import { useResolvedCandidateWithFallback } from "@/data/candidates/useCandidateElectionFallback";
import { useCandidateName } from "@/data/candidates/useCandidateName";
import { useMps } from "@/data/parliament/useMps";
import { useMpEntry } from "@/data/parliament/useMpEntry";
import { CandidateMpProvider } from "@/data/candidates/CandidateMpContext";
import { CandidateHeader } from "./CandidateHeader";
import { MpProfileHeader } from "./MpProfileHeader";
import { MpFinancialDeclarations } from "./MpFinancialDeclarations";
import { MpAssetsSummary } from "./MpAssetsSummary";
import { MpManagementRoles } from "./MpManagementRoles";
import { MpProfileSections } from "./MpProfileSections";
import { MpScorecardTile } from "./MpScorecardTile";
import { CandidateNamesakeChooser } from "./CandidateNamesakeChooser";
import {
  CandidateLoadError,
  CandidateNotFound,
  CandidateResolving,
} from "./CandidateRouteStates";
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
  // Resolves against the selected election and, when the candidate is not on
  // that ballot (a bare name from an earlier cycle, or a slug minted in another
  // election), probes the other elections and switches context to the newest
  // one that has them — search-engine results and old shared links carry no
  // `?elections=`, so they land on the latest election.
  const { isResolving, notFound, isError, matches, canonical, parsed } =
    useResolvedCandidateWithFallback(name);
  const { isEn, nameForBg } = useCandidateName();

  // An `mp-<id>` URL points at a parliament.bg record that may not be a
  // candidate on the *selected* ballot (the election-scoped resolver above then
  // matches no one and the page would render blank). Resolve the MP's roster
  // entry so deep links from the procurement scanner, search, etc. still render
  // the full dashboard. See the same pattern in CandidateProcurementScreen.
  //
  // Prefer the per-MP shard (~0.4 KB) over the whole ~950 KB index.json — this
  // is the procurement→MP deep-link path, so paying for the full roster just to
  // read one entry was the page's biggest single download. Fall back to the
  // roster only when the shard is genuinely missing (legacy deploy).
  const mpIdParam = parsed?.kind === "mp" ? parsed.mpId : null;
  const needEntry = mpIdParam != null && notFound;
  const {
    entry: shardMp,
    isLoading: entryLoading,
    isFetched: entryFetched,
  } = useMpEntry(needEntry ? mpIdParam : null);
  const needRosterFallback = needEntry && entryFetched && !shardMp;
  const { findMpById, isLoading: rosterLoading } = useMps(needRosterFallback);
  const rosterMp =
    shardMp ?? (needRosterFallback ? findMpById(mpIdParam) : undefined);
  const awaitingRoster =
    needEntry && !rosterMp && (entryLoading || rosterLoading);

  if (isResolving || awaitingRoster) {
    // Reserve roughly the height of a typical candidate page so the layout
    // doesn't jump from a one-line "Loading…" to a multi-card screen once
    // the candidate index resolves. This was the dominant CLS source on
    // /candidate/* pages because the swap inserts ~1500px above the fold.
    // The election-fallback probe reuses the same skeleton so a search-engine
    // visitor sees "Loading…" instead of a blank page while we switch cycles.
    return <CandidateResolving />;
  }

  if (matches.length === 0 && rosterMp) {
    // No election holds a candidacy shard for this MP, but the global
    // roster does — render the full MP dashboard keyed by the roster name
    // (sub-components query BG-name-keyed parliament data, which is
    // election-independent). cikRows is absent (no candidacy on record).
    const lookupName = rosterMp.name;
    const headerName = isEn ? rosterMp.name_en : rosterMp.name;
    const linkSlug = `mp-${rosterMp.id}`;
    return (
      <CandidateMpProvider
        value={{ id: rosterMp.id, name: lookupName, entry: rosterMp }}
      >
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
          <MpProfileSections
            name={lookupName}
            linkSlug={linkSlug}
            mpEntry={rosterMp}
          />
        </div>
      </CandidateMpProvider>
    );
  }

  // A slug URL that no election holds (and, for an MP, no roster entry): say
  // so rather than rendering an empty body under the homepage's head.
  if (notFound) return <CandidateNotFound />;
  // A slug whose shard fetch failed: we can't tell whether it exists, and the
  // bare-name body below would key its data on the slug itself.
  if (isError && parsed?.kind !== "name") return <CandidateLoadError />;

  if (matches.length === 0) {
    // No candidate matches a bare-name URL — render the bare-name page so the
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

  // For MP candidates, share the already-resolved entry so the per-MP hooks
  // resolve name→id (and read the roster entry) from context instead of each
  // fetching the full roster. CIK-only candidates have no mpId, so no provider.
  const mpContext =
    canonical.mpId != null
      ? { id: canonical.mpId, name: lookupName, entry: canonical.mpEntry }
      : null;

  return (
    <CandidateMpProvider value={mpContext}>
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
          <MpProfileSections
            name={lookupName}
            linkSlug={linkSlug}
            mpEntry={canonical.mpEntry}
          />
        )}
      </div>
    </CandidateMpProvider>
  );
};
