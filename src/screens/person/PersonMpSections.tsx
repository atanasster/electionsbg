// The parliament-member sections merged onto the person dashboard (person-candidate-merge
// Phase 6): voting scorecard + roll-call record + declared assets/wealth. These have NO PG
// equivalent, so they'd otherwise be lost when /candidate/:id renders the person dashboard —
// voting in particular had no sub-route, so it was a dead end. The money/company/connection
// MP tiles are DELIBERATELY omitted: the person layer supersedes them EIK-exact (the merge's
// whole point), and re-mounting the name-keyed versions would reintroduce the namesake risk.
//
// Mounted only for a (former/sitting) MP. The CandidateMpProvider hands the known mpId + the
// single-shard roster entry to the per-MP hooks so they skip the ~950 KB parliament roster.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Wallet } from "lucide-react";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import { useMpEntry } from "@/data/parliament/useMpEntry";
import { CandidateMpProvider } from "@/data/candidates/CandidateMpContext";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { MpScorecardTile } from "@/screens/components/candidates/MpScorecardTile";
import { MpVotingSection } from "@/screens/components/candidates/MpVotingSection";
import { MpAssetsSummary } from "@/screens/components/candidates/MpAssetsSummary";

export const PersonMpSections: FC<{
  name: string;
  mpId: number;
  // True when the page renders the PersonMoneyTimeline (id="person-money") below,
  // so the scorecard's connected-contracts metric can deep-link to it.
  hasMoneyTimeline?: boolean;
}> = ({ name, mpId, hasMoneyTimeline }) => {
  const { t } = useTranslation();
  const { selected } = useElectionContext();
  const { entry } = useMpEntry(mpId);
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
    <CandidateMpProvider value={{ id: mpId, name, entry: entry ?? null }}>
      {/* Each scorecard KPI drills into its fuller breakdown further down the
          page: loyalty/attendance → the roll-call section, net worth → the
          declarations section, connected contracts → the money timeline. */}
      <MpScorecardTile
        name={name}
        links={{
          loyalty: maybeServedInSelectedNs ? "#parliament" : undefined,
          attendance: maybeServedInSelectedNs ? "#parliament" : undefined,
          netWorth: "#declarations",
          connectedContracts: hasMoneyTimeline ? "#person-money" : undefined,
        }}
      />
      {maybeServedInSelectedNs && (
        <MpVotingSection name={name} linkSlug={linkSlug} mpId={mpId} />
      )}
      {/* Declared ASSETS/wealth (property, bank, vehicles). The declared company STAKES that
          used to live here moved into the unified <PersonCompanies> "Фирми" section, folded
          onto the registry company they belong to. Self-hides when the assets tile is empty. */}
      <DashboardSection
        id="declarations"
        title={t("mp_section_assets") || "Assets & declarations"}
        icon={Wallet}
      >
        <MpAssetsSummary name={name} linkSlug={linkSlug} />
      </DashboardSection>
    </CandidateMpProvider>
  );
};
