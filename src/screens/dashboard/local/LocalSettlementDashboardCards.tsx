// Settlement (EKATTE) local-elections dashboard.
//
// Sub-municipal villages elect their own кмет на кметство; this surfaces that
// race plus the parent município's mayor + council context. The município
// bundle's council is município-grain, but the per-section ballots carry an
// EKATTE — so the cross-cycle place-trends artifact CAN show how this
// settlement itself voted for the council + município mayor (LocalPlaceTrendsTile).
// For settlements without their own kметство (towns governed by the município
// mayor) we still show a context card linking up to the município dashboard.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ChevronRight,
  Crown,
  Landmark,
  TrendingUp,
} from "lucide-react";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { useLocalSettlement } from "@/data/local/useLocalSettlement";
import { useLocalMunicipality } from "@/data/local/useLocalMunicipality";
import { useLocalPlaceTrend } from "@/data/local/useLocalPlaceTrends";
import { LocalPlaceTrendsTile } from "./LocalPlaceTrendsTile";
import { LocalMayorRunoffBar } from "./LocalMayorRunoffBar";
import { useChmiHistory } from "@/data/local/useChmiHistory";
import type { ChmiHistoryEvent } from "@/data/local/useChmiHistory";
import { friendlyIsoDate } from "@/data/local/cycleDate";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { formatThousands } from "@/data/utils";
import { titleCaseName } from "@/lib/utils";
import type {
  LocalKmetstvoResult,
  LocalMayorResult,
  LocalMunicipalityBundle,
} from "@/data/local/types";
import { StatCard } from "../StatCard";
import { DashboardSection } from "../DashboardSection";
import { PartyChip } from "@/screens/components/local/LocalRankedBar";

const normalize = (s: string): string =>
  s.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();

// Compact winner descriptor shared by the regular result and the chmi feed.
type ContestWinner = {
  candidateName: string;
  localPartyName: string;
  primaryCanonicalId: string | null;
  mpId?: number;
};

type PreviousContest = {
  date: string; // ISO
  kind: "regular" | "partial";
  winner: ContestWinner | null;
};

// Full multi-candidate ranking rows (reused for the headline race + the
// expandable round-1 table). `muted` drops the winner emphasis for round 1.
const MayorCandidateRows: FC<{
  rows: LocalMayorResult[];
  muted?: boolean;
}> = ({ rows, muted }) => {
  const { t } = useTranslation();
  const { colorFor } = useCanonicalParties();
  return (
    <div className="flex flex-col divide-y">
      {rows.map((c) => {
        const color = c.primaryCanonicalId
          ? colorFor(c.primaryCanonicalId)
          : undefined;
        return (
          <div
            key={`${c.localPartyNum}-${c.candidateName}`}
            className={`flex items-center gap-2 py-2 ${c.isElected && !muted ? "font-medium" : ""}`}
          >
            <MpAvatar
              name={c.candidateName}
              mpId={c.mpId}
              showPartyRing={false}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate">{titleCaseName(c.candidateName)}</div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
                {color ? (
                  <span
                    aria-hidden
                    className="inline-block size-2 rounded-full ring-1 ring-border shrink-0"
                    style={{ backgroundColor: color }}
                  />
                ) : null}
                <span className="truncate">{c.localPartyName}</span>
              </div>
            </div>
            {c.isElected && !muted ? (
              <span className="inline-flex items-center rounded-md border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary shrink-0">
                {t("local_election_winner_badge")}
              </span>
            ) : null}
            <div className="text-right shrink-0 tabular-nums">
              <div>{formatThousands(c.votes)}</div>
              <div className="text-[10px] text-muted-foreground">
                {c.pctOfValid.toFixed(1)}%
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// Village-mayor (kметство) contest, latest-first. The headline is the most
// recent contest (a later by-election supersedes the regular-cycle vote): full
// runoff bar + round-2 ranking + an expandable round-1 table + turnout. Earlier
// contests (the regular vote, older by-elections) drop to a compact
// "Предишни избори" list in the same card.
const KmetstvoMayorCard: FC<{
  latest: LocalKmetstvoResult;
  latestDate: string; // ISO date of the headline contest
  latestKind: "regular" | "partial";
  previous: PreviousContest[];
}> = ({ latest, latestDate, latestKind, previous }) => {
  const { t } = useTranslation();
  const { colorFor } = useCanonicalParties();
  const hasRunoff = !!latest.round2?.length;
  const table = useMemo(
    () =>
      [...(hasRunoff ? latest.round2! : latest.candidates)].sort(
        (a, b) => b.votes - a.votes,
      ),
    [latest, hasRunoff],
  );
  const round1Sorted = useMemo(
    () => [...latest.candidates].sort((a, b) => b.votes - a.votes),
    [latest],
  );
  const turnoutPct =
    latest.numRegisteredVoters && latest.totalActualVoters
      ? (latest.totalActualVoters / latest.numRegisteredVoters) * 100
      : null;
  const badge =
    (latestKind === "partial"
      ? t("local_settlement_kmet_partial")
      : t("local_settlement_kmet_regular")) +
    (hasRunoff ? ` · ${t("local_settlement_kmet_runoff")}` : "") +
    ` · ${friendlyIsoDate(latestDate)}`;
  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Crown className="h-4 w-4 shrink-0" />
            <span className="truncate">
              {t("local_settlement_kmetstvo_mayor")}
            </span>
          </div>
          <span className="text-[11px] font-medium normal-case text-muted-foreground shrink-0">
            {badge}
          </span>
        </div>
      }
    >
      {hasRunoff ? (
        <div className="mt-1">
          <LocalMayorRunoffBar round2={latest.round2!} />
        </div>
      ) : null}
      <MayorCandidateRows rows={table} />
      {hasRunoff ? (
        <details className="group mt-2">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground hover:text-foreground">
            <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
            {t("local_settlement_kmet_round1", { count: round1Sorted.length })}
          </summary>
          <div className="mt-1 opacity-80">
            <MayorCandidateRows rows={round1Sorted} muted />
          </div>
        </details>
      ) : null}
      {turnoutPct != null ? (
        <div className="mt-2 text-xs text-muted-foreground">
          {t("local_settlement_kmet_turnout", {
            pct: turnoutPct.toFixed(1),
            voted: formatThousands(latest.totalActualVoters!),
            registered: formatThousands(latest.numRegisteredVoters!),
          })}
        </div>
      ) : null}
      {previous.length > 0 ? (
        <div className="mt-3 border-t pt-2">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("local_settlement_kmet_previous")}
          </div>
          <ul className="flex flex-col divide-y">
            {previous.map((p, i) => {
              const color = p.winner?.primaryCanonicalId
                ? colorFor(p.winner.primaryCanonicalId)
                : undefined;
              return (
                <li
                  key={`${p.date}-${i}`}
                  className="flex items-center gap-2 py-1.5 text-sm"
                >
                  <span className="w-20 shrink-0 text-xs tabular-nums text-muted-foreground">
                    {friendlyIsoDate(p.date)}
                  </span>
                  {p.winner ? (
                    <>
                      <MpAvatar
                        name={p.winner.candidateName}
                        mpId={p.winner.mpId}
                        showPartyRing={false}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate">
                          {titleCaseName(p.winner.candidateName)}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
                          {color ? (
                            <span
                              aria-hidden
                              className="inline-block size-2 rounded-full ring-1 ring-border shrink-0"
                              style={{ backgroundColor: color }}
                            />
                          ) : null}
                          <span className="truncate">
                            {p.winner.localPartyName}
                          </span>
                        </div>
                      </div>
                      <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {p.kind === "partial"
                          ? t("local_settlement_kmet_partial")
                          : t("local_settlement_kmet_regular")}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </StatCard>
  );
};

// Parent município context: mayor + top council parties, link to the full page.
const ParentMunicipalityCard: FC<{
  bundle: LocalMunicipalityBundle;
  cycle: string;
}> = ({ bundle, cycle }) => {
  const { t } = useTranslation();
  const { colorFor } = useCanonicalParties();
  const topCouncil = useMemo(
    () =>
      [...bundle.council]
        .filter((p) => p.mandatesWon > 0)
        .sort((a, b) => b.mandatesWon - a.mandatesWon)
        .slice(0, 5),
    [bundle],
  );
  const mayor = bundle.mayor.elected;
  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Landmark className="h-4 w-4 shrink-0" />
            <span className="truncate">
              {t("local_settlement_parent_municipality")} ·{" "}
              {bundle.obshtinaName}
            </span>
          </div>
          <Link
            to={`/local/${cycle}/${bundle.obshtinaCode}`}
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline normal-case shrink-0"
          >
            {t("local_election_view_details")}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      }
    >
      <div className="mt-1 flex flex-col gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("local_election_stat_mayor")}
          </div>
          {mayor ? (
            <div className="mt-1 flex items-center gap-2">
              <MpAvatar
                name={mayor.candidateName}
                mpId={mayor.mpId}
                showPartyRing={false}
              />
              <span className="font-medium truncate">
                {titleCaseName(mayor.candidateName)}
              </span>
              <span className="text-xs text-muted-foreground truncate">
                {mayor.localPartyName}
              </span>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              {t("local_election_no_winner")}
            </div>
          )}
        </div>
        {topCouncil.length > 0 ? (
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {t("local_election_sec_council")}
            </div>
            <ul className="mt-1 flex flex-col gap-1">
              {topCouncil.map((p) => (
                <li
                  key={p.localPartyNum}
                  className="flex items-center gap-2 text-[12px]"
                >
                  <PartyChip
                    name={p.localPartyName}
                    color={
                      (p.primaryCanonicalId
                        ? colorFor(p.primaryCanonicalId)
                        : undefined) ?? "#9ca3af"
                    }
                  />
                  <span className="ml-auto tabular-nums font-semibold shrink-0">
                    {p.mandatesWon}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </StatCard>
  );
};

export const LocalSettlementDashboardCards: FC<{
  ekatte: string;
  cycle: string;
}> = ({ ekatte, cycle }) => {
  const { t } = useTranslation();
  const { name, obshtina, municipality, kmetstvo, isLoading } =
    useLocalSettlement(ekatte, cycle);
  const chmiEvents = useChmiHistory(obshtina);
  const { data: trendsFile } = useLocalPlaceTrend("s", ekatte);

  const kmetstvoEvents = useMemo(() => {
    if (!name) return [];
    const target = normalize(name);
    return chmiEvents.filter(
      (e) =>
        e.kind === "kmetstvo_mayor" &&
        e.kmetstvoName != null &&
        normalize(e.kmetstvoName) === target,
    );
  }, [chmiEvents, name]);

  const cycleIso = cycle.slice(0, 10).replace(/_/g, "-"); // "2023-10-29"

  // The latest by-election newer than this cycle's regular vote supersedes the
  // regular-cycle mayor. `useChmiHistory` already applies the as-of cutoff for
  // older cycle views, so for an older cycle this is empty (no post-cutoff events).
  const currentByElection = useMemo<ChmiHistoryEvent | null>(() => {
    const newer = kmetstvoEvents.filter((e) => e.date > cycleIso);
    if (!newer.length) return null;
    return newer.reduce((a, b) => (b.date > a.date ? b : a));
  }, [kmetstvoEvents, cycleIso]);

  // Load the by-election's own município bundle for the FULL kmetstvo race
  // (round 1 + round 2 + turnout) — the chmi history feed carries only the
  // winner. The hook is disabled (returns undefined) when there's no by-election.
  const { municipality: byElectionBundle } = useLocalMunicipality(
    currentByElection?.obshtinaCode ?? null,
    currentByElection?.cycle,
  );
  const latestKmetstvo = useMemo<LocalKmetstvoResult | null>(() => {
    if (!currentByElection || !byElectionBundle || !name) return null;
    const target = normalize(currentByElection.kmetstvoName ?? name);
    return (
      byElectionBundle.kmetstva.find(
        (k) => normalize(k.kmetstvoName) === target,
      ) ?? null
    );
  }, [byElectionBundle, currentByElection, name]);

  // Headline contest = the by-election when present, else the regular vote.
  const featuredKmetstvo = latestKmetstvo ?? kmetstvo ?? null;
  const featuredDate =
    latestKmetstvo && currentByElection ? currentByElection.date : cycleIso;
  const featuredKind: "regular" | "partial" = latestKmetstvo
    ? "partial"
    : "regular";

  // Earlier contests, newest-first: older by-elections then the regular vote.
  const previousContests = useMemo<PreviousContest[]>(() => {
    if (!latestKmetstvo || !currentByElection) return [];
    const prev: PreviousContest[] = kmetstvoEvents
      .filter((e) => e.date < currentByElection.date)
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((e) => ({
        date: e.date,
        kind: "partial" as const,
        winner: {
          candidateName: e.candidateName,
          localPartyName: e.localPartyName,
          primaryCanonicalId: e.primaryCanonicalId,
          mpId: e.mpId,
        },
      }));
    const regularWinner =
      kmetstvo?.elected ??
      kmetstvo?.candidates.find((c) => c.isElected) ??
      null;
    if (regularWinner) {
      prev.push({ date: cycleIso, kind: "regular", winner: regularWinner });
    }
    return prev;
  }, [latestKmetstvo, currentByElection, kmetstvoEvents, kmetstvo, cycleIso]);

  if (isLoading && !municipality) {
    return <p className="text-sm text-muted-foreground">{t("loading")}</p>;
  }
  if (!municipality) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("local_election_no_data")}
      </p>
    );
  }

  return (
    <div>
      <DashboardSection id="local-mayors" title={t("local_sec_mayors")}>
        {featuredKmetstvo ? (
          <KmetstvoMayorCard
            latest={featuredKmetstvo}
            latestDate={featuredDate}
            latestKind={featuredKind}
            previous={previousContests}
          />
        ) : (
          <StatCard
            label={
              <div className="flex items-center gap-2">
                <Crown className="h-4 w-4" />
                <span>{t("local_settlement_kmetstvo_mayor")}</span>
              </div>
            }
          >
            <p className="text-sm text-muted-foreground">
              {t("local_settlement_no_kmetstvo", {
                municipality: municipality.obshtinaName,
              })}
            </p>
          </StatCard>
        )}
      </DashboardSection>

      {/* How this settlement itself voted over the cycles — sits high, right
          under the village-mayor tier, above the parent-município context. */}
      {trendsFile ? (
        <DashboardSection
          id="local-trends"
          title={t("local_sec_trends")}
          icon={TrendingUp}
        >
          <LocalPlaceTrendsTile
            trend={trendsFile.trend}
            cyclesAsc={trendsFile.cyclesAsc}
            councilTitle={t("local_place_council_settlement_title")}
            councilHint={t("local_place_council_settlement_hint")}
            mayorTitle={t("local_place_mayor_settlement_title")}
            mayorHint={t("local_place_mayor_settlement_hint")}
          />
        </DashboardSection>
      ) : null}

      <DashboardSection id="local-overview" title={t("local_sec_councils")}>
        <ParentMunicipalityCard bundle={municipality} cycle={cycle} />
      </DashboardSection>
    </div>
  );
};
