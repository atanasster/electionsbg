// The MP roll-call section as a SEQUENCED TRACK — split out of PersonMpSections so the
// scorecard can stay above the tracks where it belongs.
//
// Why the split: `MpScorecardTile` is a per-person summary of PARLIAMENTARY metrics (party
// loyalty, attendance, declared net worth, procurement to connected firms). While it sat
// inside PersonMpSections it rendered between the local track's card and the national
// track's header, so on a councillor-then-MP page it fell visually under the „МЕСТНА
// ВЛАСТ" pill — national content beneath the wrong label, which is the same class of error
// the track headers exist to remove. The scorecard now renders once, above both tracks,
// belonging to the person rather than to either body; this component is the part that is
// genuinely national and genuinely sequenced.

import { FC, ReactNode } from "react";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import { rollcallCoverage } from "@/data/parliament/rollcallCoverage";
import { useMpEntry } from "@/data/parliament/useMpEntry";
import { MpVotingSection } from "@/screens/components/candidates/MpVotingSection";

export const PersonMpVoting: FC<{
  name: string;
  mpId: number;
  /** The "Народно събрание" track header, for a person who ALSO has a municipal-council
   *  voting record. Forwarded to MpVotingSection so it renders inside that section's own
   *  success path — see its header for why the two must be inseparable. */
  header?: ReactNode;
}> = ({ name, mpId, header }) => {
  const { selected } = useElectionContext();
  const { entry } = useMpEntry(mpId);

  // Roll-call only exists for the parliament the MP actually sat in; skip the block (and its
  // ~300 KB roll-call fetch) only when the roster entry POSITIVELY lists the NSes served and
  // this isn't one. The by-id shard leaves nsFolders empty for many (esp. former) MPs, so an
  // empty/absent list means "unknown" → render and let MpVotingSection self-hide if empty.
  // Duplicated from PersonMpSections deliberately: both hooks are React-Query-deduped, so the
  // second call costs nothing, and the alternative — threading the flag between two siblings —
  // would couple them through the page. See PersonMpSections for why the same predicate also
  // gates the scorecard's `#parliament` deep links.
  const coverage = rollcallCoverage(entry?.nsFolders, entry?.hasRollcall);
  const ns = electionToNsFolder(selected);
  const maybeServedInSelectedNs =
    coverage !== false &&
    ns != null &&
    (entry?.nsFolders?.length ? entry.nsFolders.includes(ns) : true);

  if (!maybeServedInSelectedNs) return null;
  return (
    <MpVotingSection
      name={name}
      linkSlug={`mp-${mpId}`}
      mpId={mpId}
      header={header}
    />
  );
};
