// The parliament-member sections merged onto the person dashboard (person-candidate-merge
// Phase 6): voting scorecard + roll-call record + declared assets/wealth. These have NO PG
// equivalent, so they'd otherwise be lost when /candidate/:id renders the person dashboard —
// voting in particular had no sub-route, so it was a dead end. The money/company/connection
// MP tiles are DELIBERATELY omitted: the person layer supersedes them EIK-exact (the merge's
// whole point), and re-mounting the name-keyed versions would reintroduce the namesake risk.
//
// Mounted only for a (former/sitting) MP. The CandidateMpProvider that hands the known mpId
// to the per-MP hooks (so they skip the ~950 KB parliament roster) is NOT here — it wraps the
// whole dashboard in PersonProfileScreen. It used to be this component's own child, which put
// its own body outside it: the gate below then resolved the MP by NAME through the roster,
// was false for the whole roster window, and the page painted the wrong declarations block
// before swapping it. See useMpOwnsDeclarations.

import { FC } from "react";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import { useMpEntry } from "@/data/parliament/useMpEntry";
import { MpScorecardTile } from "@/screens/components/candidates/MpScorecardTile";
import { MpVotingSection } from "@/screens/components/candidates/MpVotingSection";
import { MpAssetsSummary } from "@/screens/components/candidates/MpAssetsSummary";
import {
  DeclarationsSection,
  DECLARATIONS_ANCHOR,
} from "./DeclarationsSection";
import { PersonDeclarations } from "./PersonDeclarations";
import { useMpOwnsDeclarations } from "./useMpOwnsDeclarations";

export const PersonMpSections: FC<{
  name: string;
  mpId: number;
  /** The unified person slug — the key the PG filing list is fetched by. */
  slug: string;
  // True when the page renders the PersonMoneyTimeline (id="person-money") below,
  // so the scorecard's connected-contracts metric can deep-link to it.
  hasMoneyTimeline?: boolean;
}> = ({ name, mpId, slug, hasMoneyTimeline }) => {
  const { selected } = useElectionContext();
  const { entry } = useMpEntry(mpId);
  // The one predicate the person page also reads, so exactly one component ever opens
  // the `#declarations` section. It covers MpAssetsSummary's own in-flight branch, so
  // the reserved-height card still shows while the queries settle.
  const ownsDeclarations = useMpOwnsDeclarations(name, mpId);
  const linkSlug = `mp-${mpId}`;

  // Roll-call only exists for the parliament the MP actually sat in; skip the block (and its
  // ~300 KB roll-call fetch) only when the roster entry POSITIVELY lists the NSes served and
  // this isn't one. The by-id shard leaves nsFolders empty for many (esp. former) MPs, so an
  // empty/absent list means "unknown" → render and let MpVotingSection self-hide if empty.
  const ns = electionToNsFolder(selected);
  const maybeServedInSelectedNs =
    ns != null &&
    (entry?.nsFolders?.length ? entry.nsFolders.includes(ns) : true);

  return (
    <>
      {/* Each scorecard KPI drills into its fuller breakdown further down the
          page: loyalty/attendance → the roll-call section, net worth → the
          declarations section, connected contracts → the money timeline. */}
      <MpScorecardTile
        name={name}
        links={{
          loyalty: maybeServedInSelectedNs ? "#parliament" : undefined,
          attendance: maybeServedInSelectedNs ? "#parliament" : undefined,
          netWorth: `#${DECLARATIONS_ANCHOR}`,
          connectedContracts: hasMoneyTimeline ? "#person-money" : undefined,
        }}
      />
      {maybeServedInSelectedNs && (
        <MpVotingSection name={name} linkSlug={linkSlug} mpId={mpId} />
      )}
      {/* Declared ASSETS/wealth (property, bank, vehicles). The declared company STAKES that
          used to live here moved into the unified <PersonCompanies> "Фирми" section, folded
          onto the registry company they belong to.
          Gated on the same condition MpAssetsSummary uses internally — it returns null once
          the queries settle with no rollup, and the heading used to render regardless, leaving
          a bare "Имущество и декларации" with nothing under it for every MP who never filed
          as one (e.g. a minister who only ever filed in the officials register). */}
      {ownsDeclarations && (
        <DeclarationsSection>
          <MpAssetsSummary name={name} linkSlug={linkSlug} />
          {/* …and every filing behind that snapshot. The rollup is ONE year (plus a prior
              for the delta); the register holds the whole series, across every tier the
              person filed in — 11 filings for an MP who later sat in the EP, of which the
              snapshot alone showed one. This block used to be suppressed for anyone with an
              MP rollup, so the section titled "Имущество и декларации" contained no
              декларации. `bare` because the heading and the register link are right above. */}
          <PersonDeclarations slug={slug} bare />
        </DeclarationsSection>
      )}
    </>
  );
};
