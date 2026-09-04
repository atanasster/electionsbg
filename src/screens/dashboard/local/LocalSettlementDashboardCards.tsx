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
import { PersonNameLink } from "@/screens/components/person/PersonNameLink";
import { useLocalSettlement } from "@/data/local/useLocalSettlement";
import { useLocalMunicipality } from "@/data/local/useLocalMunicipality";
import { useLocalPlaceTrend } from "@/data/local/useLocalPlaceTrends";
import { MayorPayCard } from "@/screens/myarea/MyAreaMayorPayTile";
import { shouldShowMayorPayOnLocalPage } from "@/screens/myarea/mayorPayPlacement";
import { LocalPlaceTrendsTile } from "./LocalPlaceTrendsTile";
import { LocalMayorRunoffBar } from "./LocalMayorRunoffBar";
import {
  useChmiHistory,
  useChmiHistoryPending,
} from "@/data/local/useChmiHistory";
import type { ChmiHistoryEvent } from "@/data/local/useChmiHistory";
import { friendlyIsoDate, localCycleKind } from "@/data/local/cycleDate";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { formatThousands } from "@/data/utils";
import type {
  LocalKmetstvoResult,
  LocalMayorResult,
  LocalMunicipalityBundle,
} from "@/data/local/types";
import { StatCard } from "../StatCard";
import { DashboardSection } from "../DashboardSection";
import { ElectionSurfaceBoundary } from "@/screens/elections/ElectionSurfaceBoundary";
import { ElectionResultsShell } from "@/screens/elections/ElectionResultsShell";
import { ElectionSurfaceSkeleton } from "@/screens/elections/ElectionSurfaceSkeleton";
import { PartyChip } from "@/screens/components/local/LocalRankedBar";
import { kmetstvoNameKey } from "@/data/local/kmetstvoName";

// Compact winner descriptor shared by the regular result and the chmi feed.
type ContestWinner = {
  candidateName: string;
  localPartyName: string;
  primaryCanonicalId: string | null;
  mpId?: number;
  personSlug?: string;
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
              <div className="truncate">
                <PersonNameLink
                  name={c.candidateName}
                  personSlug={c.personSlug}
                  mpId={c.mpId}
                />
              </div>
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
                          <PersonNameLink
                            name={p.winner.candidateName}
                            personSlug={p.winner.personSlug}
                            mpId={p.winner.mpId}
                          />
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
              <PersonNameLink
                name={mayor.candidateName}
                personSlug={mayor.personSlug}
                mpId={mayor.mpId}
                className="font-medium truncate"
              />
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
  const { name, kmetstvoObshtina, municipality, kmetstvo, isLoading } =
    useLocalSettlement(ekatte, cycle);
  // The by-elections are keyed the same way the race is — a Sofia кметство's партиален вот is
  // filed under 'SOF', never under the village's район — so this reads the кметство code, not
  // the parent one.
  const chmiEvents = useChmiHistory(kmetstvoObshtina);
  const chmiPending = useChmiHistoryPending(kmetstvoObshtina);
  const { data: trendsFile } = useLocalPlaceTrend("s", ekatte);

  const kmetstvoEvents = useMemo(() => {
    if (!name) return [];
    const target = kmetstvoNameKey(name);
    return chmiEvents.filter(
      (e) =>
        e.kind === "kmetstvo_mayor" &&
        e.kmetstvoName != null &&
        kmetstvoNameKey(e.kmetstvoName) === target,
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
  const { municipality: byElectionBundle, isLoading: byElectionLoading } =
    useLocalMunicipality(
      currentByElection?.obshtinaCode ?? null,
      currentByElection?.cycle,
    );

  // ⚠⚠ NULL IS TWO STATES AT THE SHELL'S GATE BELOW — "nothing superseded this cycle" and "we do
  // not know yet" — and only the first may render it. Resolution is TWO fetch waves deep (the
  // chmi shard, then that by-election's own bundle) while the page's own guard clears after one,
  // so the unknown state is the normal cold-load path, not a rare race: measured, 216 settlement
  // pages would have shown „Избран · да" on the superseded mayor for a round-trip, directly above
  // the card naming their successor, and then had the whole block vanish underneath the reader.
  //
  // ⚠ AND `useChmiHistory` RETURNS `[]` WHILE LOADING, which is why the first wave needs its own
  // signal — an empty event list is indistinguishable from "this place has never had a
  // by-election", so `currentByElection` is null during wave 1 for a superseded place too.
  //
  // It lapses when the queries SETTLE rather than when they succeed, so a 404 on the by-election
  // bundle cannot suppress the shell for ever.
  const supersessionPending =
    chmiPending || (!!currentByElection && byElectionLoading);
  const latestKmetstvo = useMemo<LocalKmetstvoResult | null>(() => {
    if (!currentByElection || !byElectionBundle || !name) return null;
    const target = kmetstvoNameKey(currentByElection.kmetstvoName ?? name);
    return (
      byElectionBundle.kmetstva.find(
        (k) => kmetstvoNameKey(k.kmetstvoName) === target,
      ) ?? null
    );
  }, [byElectionBundle, currentByElection, name]);

  // What the CYCLE being viewed is. Not derivable from whether a newer vote
  // superseded it: on a chmi-cycle page there is no newer event by definition,
  // so falling back to "regular" there labelled the cycle's own частичен избор
  // „редовен вот". Only a slug that positively reads as partial flips the label
  // — an unclassifiable one keeps the previous default rather than asserting a
  // by-election, and the card renders nothing for it anyway (no data).
  const cycleKind: "regular" | "partial" =
    localCycleKind(cycle) === "partial" ? "partial" : "regular";

  // Headline contest = the by-election when present, else this cycle's own vote.
  const featuredKmetstvo = latestKmetstvo ?? kmetstvo ?? null;
  const featuredDate =
    latestKmetstvo && currentByElection ? currentByElection.date : cycleIso;
  // A superseding by-election is always partial; otherwise the headline IS the
  // viewed cycle's contest, so it carries that cycle's kind.
  const featuredKind: "regular" | "partial" = latestKmetstvo
    ? "partial"
    : cycleKind;

  // Earlier contests, newest-first: older by-elections then the regular vote.
  const previousContests = useMemo<PreviousContest[]>(() => {
    // ⚠ THE LIST IS DELIBERATELY ONLY EVER SHOWN ON A SUPERSEDED PAGE, and the filter below
    // reads as though it were a general history — it admits by-elections OLDER than the viewed
    // cycle, which is why the sort has to follow the push (с. Трояново's 2021 by-election under
    // the 2023 regular vote). It is not a history: it exists to relegate the result the
    // headline displaced. So a кметство with pre-cycle by-elections and no superseding one
    // shows none of them here, and the same 2021 event is listed on a superseded page and
    // omitted on a non-superseded one. `/local/chmi` is the full feed.
    if (!latestKmetstvo || !currentByElection) return [];
    const prev: PreviousContest[] = kmetstvoEvents
      .filter((e) => e.date < currentByElection.date)
      .map((e) => ({
        date: e.date,
        kind: "partial" as const,
        winner: {
          candidateName: e.candidateName,
          localPartyName: e.localPartyName,
          primaryCanonicalId: e.primaryCanonicalId,
          mpId: e.mpId,
          personSlug: e.personSlug,
        },
      }));
    const cycleWinner =
      kmetstvo?.elected ??
      kmetstvo?.candidates.find((c) => c.isElected) ??
      null;
    // The viewed cycle's own contest, with ITS kind — not a hardcoded "regular".
    // On a chmi cycle the chmi feed above already carries this same vote, so
    // guard on the date or the list shows 20.10.2024 twice, once per source.
    if (cycleWinner && !prev.some((p) => p.date === cycleIso)) {
      prev.push({ date: cycleIso, kind: cycleKind, winner: cycleWinner });
    }
    // Sort AFTER the push, never before it. The viewed cycle is not necessarily
    // older than every chmi event: `useChmiHistory` cuts off on the selected
    // PARLIAMENTARY election and has no lower bound, so a кметство's
    // by-elections from BEFORE this cycle are in the shard too. Sorting first
    // and appending put с. Трояново's 2021 by-election above its 2023 regular
    // vote — 18 кметства render out of order that way.
    prev.sort((a, b) => b.date.localeCompare(a.date));
    return prev;
  }, [
    latestKmetstvo,
    currentByElection,
    kmetstvoEvents,
    kmetstvo,
    cycleIso,
    cycleKind,
  ]);

  // The кметство race and the parent bundle come from two different shards, and on a PARTIAL
  // cycle only one of them usually exists: a chmi folder holds just the municipalities that
  // voted, so a Sofia village's район shard is missing while the SOF bundle carrying its
  // by-election is present. Bailing on the parent alone declared "no local-election data" for
  // a settlement whose race we hold and whose /person badge links here by the winner's name.
  // ⚠ THE SURFACE BOUNDARY IS BELOW THIS, so a settlement whose ARTIFACT exists but whose
  // LEGACY bundle does not gets „няма данни" and never mounts it — the migration's premise is
  // that the artifact is the canonical reader, and here it is reached only if the old path
  // resolved first. Measured 2026-09-04: 0 of 4,910 published surfaces are in that state (every
  // parent bundle and every кметство-source bundle exists, and none is missing from
  // settlements.json), so this is latent rather than live — a runtime fragility only, on a 404
  // or a slow shard. `LocalElectionScreen` has the same shape at município level; the region,
  // section and country tiers mount their boundary unconditionally. Do not widen this bail
  // without re-measuring.
  const hasAnything = !!municipality || !!featuredKmetstvo;
  if (isLoading && !hasAnything) {
    return <p className="text-sm text-muted-foreground">{t("loading")}</p>;
  }
  if (!hasAnything) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("local_election_no_data")}
      </p>
    );
  }

  return (
    <div>
      {/* ⚠ THE LAST OF THE FOUR LOCAL LEVELS WHOSE ARTIFACT NOTHING READ — 4,910 published
          settlement surfaces, one `settlement_mayor` ballot each.

          ⚠ IT RENDERS HERE, INSIDE THE CARDS, RATHER THAN BESIDE THE HEADER IN THE SCREEN, and
          that placement is the whole point. The supersession predicate lives in THIS component:
          `latestKmetstvo` is what a later кметство by-election produces, and the header's screen
          has neither the hook nor the bundle. Putting the boundary in the screen would have
          meant computing supersession a second time — the exact drift `supersededMayor`'s gate
          forbids one level up. The visual position is unchanged: the cards are the first thing
          the screen renders after the header. The SPACING differs by 0.5rem, which is the one
          structural consequence of putting it here: `LocalSettlementDashboardScreen` separates
          its own children with `space-y-6`, while inside the cards the shell carries its own
          `my-4` into the mayors section. Deliberate, and not worth a wrapper — recorded so a
          reader comparing against the region screen does not read it as a mistake.

          ⚠ AND THE SUPPRESSION IS THE SAME RULE AS THE MUNICÍPIO'S, for the same reason. The
          surface's mayor ballot carries `isElected` on the REGULAR-cycle winner; where a
          by-election has since replaced them, `KmetstvoMayorCard` below already leads with the
          current officeholder and relegates this cycle's result under its own dated eyebrow, so
          a „Избран · да" column above it would name the wrong person first.

          Measured 2026-09-04 across both published cycles: 216 settlement pages would name two
          different people as кмет, one immediately above the other — 116 on 2019_10_27_mi and
          100 on 2023_10_29_mi (Слънчево VAR02, Бистрица KNL48, Калейца LOV34, Глава PVN37,
          Лесковец VRC31, Върбак SHU11, Гроздьово VAR13 …). That is 4.4% of the 4,910-page
          corpus, against 8 pages at município level — the figure is here so the next reader can
          tell a working guard from a vacuous one without re-deriving it. */}
      {latestKmetstvo || supersessionPending ? null : (
        <ElectionSurfaceBoundary
          kind="local"
          level="settlement"
          cycle={cycle}
          id={ekatte}
          // Every lever measured against the corpus, not guessed: two facts is this level's
          // maximum (`winner` and `margin`; 3,634 of 4,910 carry both, 1,276 carry one), one
          // canvas for its single `settlement_mayor` ballot, no map — the ballot declares one
          // and `MAP_ADAPTERS` registers no `local/*` adapter to draw it — and two rows.
          //
          // ⚠ `rows={2}` DEPARTS FROM THE "RESERVE THE TALLEST" RULE THE OTHER CALL SITES USE,
          // deliberately. That rule is right where the maximum is also the common case: at
          // `local/municipality` the council ballot fills all 8 preview rows on 578 of 578
          // pages, so reserving 8 shifts almost nobody. A settlement mayor race is not that
          // shape — measured over all 4,910 published ballots the median is 2, the p90 is 4,
          // and 60.9% carry two rows or fewer. Left at the component's default of 8 the mean
          // shift is 5.62 rows and 99.8% of pages move; at 2 it is 0.90 rows and 34.9% do not
          // move at all. Reserving the tallest here does not avoid a shift, it guarantees one
          // on nearly every page — upward rather than downward, which CLS counts the same.
          //
          // `canvases={1}` is not restating the default: it is the measured claim that this
          // level publishes exactly one ballot, and `declaredColumns.data.test.ts` fails if a
          // settlement surface ever carries two.
          skeleton={
            <ElectionSurfaceSkeleton
              facts={2}
              canvases={1}
              rows={2}
              withMap={false}
            />
          }
          fallback={null}
        >
          {(s) => (
            <ElectionResultsShell
              surface={s}
              scope="header"
              currentView="local"
            />
          )}
        </ElectionSurfaceBoundary>
      )}
      <DashboardSection id="local-mayors" title={t("local_sec_mayors")}>
        {featuredKmetstvo ? (
          <KmetstvoMayorCard
            latest={featuredKmetstvo}
            latestDate={featuredDate}
            latestKind={featuredKind}
            previous={previousContests}
          />
        ) : municipality ? (
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
        ) : null}
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

      {/* Absent on a partial cycle that did not include this settlement's own município —
          the кметство race above is then all this cycle holds for the place. */}
      {municipality ? (
        <DashboardSection id="local-overview" title={t("local_sec_councils")}>
          <ParentMunicipalityCard bundle={municipality} cycle={cycle} />
          {/* This is current accountability information, not a result from a
              historic election. Keep it off old result pages, and label its
              municipal scope so it cannot be read as a kmetstvo mayor's pay. */}
          {shouldShowMayorPayOnLocalPage(cycle) ? (
            <div className="mt-3">
              <MayorPayCard
                obshtina={municipality.obshtinaCode}
                scope="parentMunicipality"
              />
            </div>
          ) : null}
        </DashboardSection>
      ) : null}
    </div>
  );
};
