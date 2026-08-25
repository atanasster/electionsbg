// The parliament-member sections merged onto the person dashboard (person-candidate-merge
// Phase 6): voting scorecard + roll-call record. These have NO PG equivalent, so they'd
// otherwise be lost when /candidate/:id renders the person dashboard — voting in particular
// had no sub-route, so it was a dead end. The money/company/connection MP tiles are
// DELIBERATELY omitted: the person layer supersedes them EIK-exact (the merge's whole
// point), and re-mounting the name-keyed versions would reintroduce the namesake risk.
//
// Declared assets/wealth used to be rendered HERE too (MpAssetsSummary, off the name-keyed
// useMpAssets/useMpDeclarations roster pipeline) — retired in favour of the SAME
// `person_declarations`/090 PG-backed `PersonDeclarations` every other tier uses
// (PersonProfileScreen renders it unconditionally now). The two pipelines were verified to
// compute the identical figure (`mp_assets()` and `person_declarations()` both read
// `person_wealth_year`, and `mp_serving.data.test.ts` gates that they reconcile), so this
// was a duplicate rendering of one number in two visual languages, not two numbers — see
// `docs/plans/` for the audit. `MpAssetsSummary` itself is UNTOUCHED: the legacy
// /candidate/:id fallback (`Candidate.tsx`, `MpProfileSections.tsx` — the namesake-chooser
// and private/unresolved-person path) still renders it directly and must keep working.
//
// Mounted only for a (former/sitting) MP. The CandidateMpProvider that hands the known mpId
// to the per-MP hooks (so they skip the ~950 KB parliament roster) is NOT here — it wraps the
// whole dashboard in PersonProfileScreen.

import { FC } from "react";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import { rollcallCoverage } from "@/data/parliament/rollcallCoverage";
import { PersonNoRollcallNote } from "./PersonNoRollcallNote";
import { useMpEntry } from "@/data/parliament/useMpEntry";
import { MpScorecardTile } from "@/screens/components/candidates/MpScorecardTile";
import { MpVotingSection } from "@/screens/components/candidates/MpVotingSection";
import { DECLARATIONS_ANCHOR } from "./DeclarationsSection";

export const PersonMpSections: FC<{
  name: string;
  mpId: number;
  // True when the page renders the PersonMoneyTimeline (id="person-money") below,
  // so the scorecard's connected-contracts metric can deep-link to it.
  hasMoneyTimeline?: boolean;
}> = ({ name, mpId, hasMoneyTimeline }) => {
  const { selected } = useElectionContext();
  const { entry } = useMpEntry(mpId);
  const linkSlug = `mp-${mpId}`;

  // Roll-call only exists for the parliament the MP actually sat in; skip the block (and its
  // ~300 KB roll-call fetch) only when the roster entry POSITIVELY lists the NSes served and
  // this isn't one. The by-id shard leaves nsFolders empty for many (esp. former) MPs, so an
  // empty/absent list means "unknown" → render and let MpVotingSection self-hide if empty.
  //
  // The proven-absent case additionally rules it out, so the page makes exactly ONE statement
  // about the roll-call. Without that, `?elections=2014_10_05` (ns "43") on an MP with
  // nsFolders ["43"] satisfied both: the voting section mounted and paid its fetch WHILE the
  // note said no record exists, and the scorecard's loyalty/attendance tiles pointed at a
  // `#parliament` anchor that vanishes when the section self-hides. `?elections=` is in the
  // usePreserveParams allowlist, so arriving from a 2014 page is an ordinary path.
  const coverage = rollcallCoverage(entry?.nsFolders, entry?.hasRollcall);
  const ns = electionToNsFolder(selected);
  const maybeServedInSelectedNs =
    coverage !== false &&
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
      {/* …and when there is no voting record to show because the corpus does not reach this
          MP, SAY so rather than leaving a blank. Self-hides on anything short of a proven
          negative — see the component. */}
      <PersonNoRollcallNote
        nsFolders={entry?.nsFolders}
        hasRollcall={entry?.hasRollcall}
      />
      {/* Declared assets/wealth is no longer rendered here — see the module header. It opens
          in the SAME `#declarations` section as every other tier, via `PersonDeclarations`
          in PersonProfileScreen, which the `netWorth` link above still targets. */}
    </>
  );
};
