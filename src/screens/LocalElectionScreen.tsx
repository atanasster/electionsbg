// Local-election full results screen.
//
// Routes served:
//   /local/:cycle                   → cycle overview (município list)
//   /local/:cycle/:obshtinaCode     → full per-município results
//
// Per-município layout (stacked sections, no tabs, per feedback_no_tabs_ux):
//   1. Stats grid (mayor / council seats / turnout / valid votes)
//   2. Mayor section — full candidate ranking, R1 then R2 if applicable
//   3. Council section — party-by-party seat breakdown with expandable
//      elected-councillor lists
//   4. Kmetstvo mayors (only when present — empty for Sofia districts)
//   5. District (район) mayors (only for the SOF city-wide shard)
//   6. Cross-link from Sofia район shards back to the SOF city-wide bundle

import { FC, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Landmark,
  Map as MapIcon,
  ShieldAlert,
} from "lucide-react";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { useLocalMunicipality } from "@/data/local/useLocalMunicipality";
import {
  districtRayonGovernanceId,
  findCityRayon,
  findCityRayonByName,
  type CityRayon,
} from "@/data/local/cityRayonCatalog";
import { useChmiHistory } from "@/data/local/useChmiHistory";
import type { ChmiHistoryEvent } from "@/data/local/useChmiHistory";
import { useKmetstvoEkatte } from "@/data/local/useKmetstvoEkatte";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { friendlyCycleDate } from "@/data/local/cycleDate";
import { LocalCountryDashboardCards } from "./dashboard/local/LocalCountryDashboardCards";
import { LocalSofiaRayonMapTile } from "./dashboard/local/LocalSofiaRayonMapTile";
import { LocalCouncilHemicycleTile } from "./dashboard/local/LocalCouncilHemicycleTile";
import { LocalMayorRunoffBar } from "./dashboard/local/LocalMayorRunoffBar";
import { LocalSectionsTile } from "./dashboard/local/LocalSectionsTile";
import { LocalSectionsMapTile } from "./dashboard/local/LocalSectionsMapTile";
import { LocalProblemVotesByPartyTile } from "./dashboard/local/LocalProblemVotesByPartyTile";
import { useLocalProblemSections } from "@/data/local/useLocalProblemSections";
import { TopMayorsTile } from "./dashboard/local/TopMayorsTile";
import { TopCouncilPartiesTile } from "./dashboard/local/TopCouncilPartiesTile";
import { LocalMayorTimelineTile } from "./dashboard/local/LocalMayorTimelineTile";
import { LocalMidtermComparisonTile } from "./dashboard/local/LocalMidtermComparisonTile";
import { LocalCouncilTrendsTile } from "./dashboard/local/LocalCouncilTrendsTile";
import { useLocalSectionShard } from "@/data/local/useLocalSectionShard";
import { PlaceHeader } from "@/screens/components/PlaceHeader";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import { DashboardSection } from "./dashboard/DashboardSection";
import { CensusDemographicsTile } from "./dashboard/CensusDemographicsTile";
import { IndicatorsTile } from "./dashboard/IndicatorsTile";
import { OfficialsDiffTile } from "./dashboard/OfficialsDiffTile";
import { MunicipalOfficialsRosterTile } from "./dashboard/MunicipalOfficialsRosterTile";
import {
  MayorVsCouncilTile,
  TopCouncillorsTile,
} from "./dashboard/local/LocalMunicipalityExtras";
import { formatThousands } from "@/data/utils";
import {
  LocalCouncilParty,
  LocalKmetstvoResult,
  LocalDistrictMayorResult,
  LocalMayorResult,
  LocalMunicipalityBundle,
} from "@/data/local/types";

// === Stats grid ===========================================================

const StatItem: FC<{
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}> = ({ label, value, sub }) => (
  <div className="rounded-xl border bg-card p-4 shadow-sm">
    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {label}
    </div>
    <div className="mt-1 text-base font-semibold leading-tight">{value}</div>
    {sub ? (
      <div className="mt-1 text-[11px] font-normal leading-tight text-muted-foreground">
        {sub}
      </div>
    ) : null}
  </div>
);

// Per-ballot snapshot: valid votes + the turnout of the election that produced
// them + which election that was. Turnout belongs to the vote (one number per
// election), so a mayoral by-election — ingested HTML-only, with no
// registration totals — reports none ("—").
type BallotStat = {
  votes: number;
  turnout: string | null;
  source: string;
};

const BallotCard: FC<{ label: string; stat: BallotStat }> = ({
  label,
  stat,
}) => {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-base font-semibold leading-tight tabular-nums">
        {t("local_election_ballot_votes", {
          votes: formatThousands(stat.votes),
        })}
      </div>
      <div className="mt-0.5 text-[12px] font-normal leading-tight text-muted-foreground tabular-nums">
        {t("local_election_ballot_activity", { value: stat.turnout ?? "—" })}
      </div>
      <div className="mt-0.5 text-[11px] font-normal leading-tight text-muted-foreground">
        {stat.source}
      </div>
    </div>
  );
};

const StatsGrid: FC<{
  bundle: LocalMunicipalityBundle;
  // Sofia / Пловдив / Варна район — its seats are elected city-wide, so the
  // seats card carries a "city-wide vote" note.
  isRayon: boolean;
  // Current officeholder when a later partial mayoral by-election has been held
  // (overrides the regular-cycle winner on the Кмет card).
  currentMayor?: { name: string; date: string } | null;
  // The mayor and council are two separate ballots (and, after a by-election,
  // two separate elections) — each gets its own card.
  mayorBallot: BallotStat;
  councilBallot: BallotStat;
}> = ({ bundle, isRayon, currentMayor, mayorBallot, councilBallot }) => {
  const { t } = useTranslation();
  const totalSeats = bundle.council.reduce((a, p) => a + p.mandatesWon, 0);
  const partiesWithSeats = bundle.council.filter(
    (p) => p.mandatesWon > 0,
  ).length;
  const mayorName = currentMayor?.name ?? bundle.mayor.elected?.candidateName;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <StatItem
        label={t("local_election_stat_mayor")}
        value={
          mayorName ? (
            <span className="flex items-center gap-1.5">
              <span className="truncate">{mayorName}</span>
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">
              {t("local_election_no_winner")}
            </span>
          )
        }
        sub={
          currentMayor
            ? t("local_election_stat_mayor_current_sub", {
                date: currentMayor.date,
              })
            : undefined
        }
      />
      <BallotCard label={t("local_election_ballot_mayor")} stat={mayorBallot} />
      <StatItem
        label={t("local_election_stat_council_seats")}
        value={
          <span className="tabular-nums">
            {totalSeats}{" "}
            <span className="text-xs text-muted-foreground font-normal">
              · {partiesWithSeats} {t("local_election_stat_council_parties")}
            </span>
          </span>
        }
        sub={
          isRayon ? t("local_election_stat_council_citywide_sub") : undefined
        }
      />
      <BallotCard
        label={t("local_election_ballot_council")}
        stat={councilBallot}
      />
    </div>
  );
};

// === Section heading =====================================================

const Section: FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <section className="mt-8">
    <h2 className="text-lg font-semibold mb-3">{title}</h2>
    {children}
  </section>
);

// === Mayor table =========================================================

const MayorTable: FC<{
  candidates: LocalMayorResult[];
}> = ({ candidates }) => {
  const { t } = useTranslation();
  const { colorFor } = useCanonicalParties();
  const sorted = useMemo(
    () => [...candidates].sort((a, b) => b.votes - a.votes),
    [candidates],
  );
  if (sorted.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("local_election_no_winner")}
      </p>
    );
  }
  return (
    <div className="rounded-xl border bg-card">
      <table className="w-full text-sm table-fixed">
        <thead className="text-xs uppercase tracking-wide text-muted-foreground border-b">
          <tr>
            <th className="py-2 px-3 text-left w-10">
              {t("local_election_th_rank")}
            </th>
            <th className="py-2 px-3 text-left w-2/5">
              {t("local_election_th_candidate")}
            </th>
            <th className="py-2 px-3 text-left">
              {t("local_election_th_party")}
            </th>
            <th className="py-2 px-3 text-right w-20">
              {t("local_election_th_votes")}
            </th>
            <th className="py-2 px-3 text-right w-16">
              {t("local_election_th_pct")}
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((c, i) => {
            const color = c.primaryCanonicalId
              ? colorFor(c.primaryCanonicalId)
              : undefined;
            return (
              <tr
                key={`${c.localPartyNum}-${c.candidateName}`}
                className={`border-b last:border-b-0 ${c.isElected ? "bg-accent/30" : ""}`}
              >
                <td className="py-2 px-3 tabular-nums text-muted-foreground align-top">
                  {i + 1}
                </td>
                <td className="py-2 px-3 align-top">
                  <div className="flex items-start gap-2 min-w-0">
                    <MpAvatar
                      name={c.candidateName}
                      mpId={c.mpId}
                      showPartyRing={false}
                    />
                    <span className="font-medium break-words min-w-0">
                      {c.candidateName}
                    </span>
                    {c.isElected ? (
                      <span className="ml-1 inline-flex items-center rounded-md border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary shrink-0">
                        {t("local_election_winner_badge")}
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="py-2 px-3 text-muted-foreground align-top">
                  <span className="flex items-start gap-1.5 min-w-0">
                    {color ? (
                      <span
                        aria-hidden
                        className="inline-block size-2 rounded-full ring-1 ring-border shrink-0 mt-1.5"
                        style={{ backgroundColor: color }}
                      />
                    ) : null}
                    <span className="break-words min-w-0">
                      {c.localPartyName}
                    </span>
                  </span>
                </td>
                <td className="py-2 px-3 text-right tabular-nums align-top">
                  {formatThousands(c.votes)}
                </td>
                <td className="py-2 px-3 text-right tabular-nums align-top">
                  {c.pctOfValid.toFixed(2)}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

// === Council section =====================================================

const CouncilPartyRow: FC<{ party: LocalCouncilParty }> = ({ party }) => {
  const { colorFor } = useCanonicalParties();
  const [expanded, setExpanded] = useState(false);
  const elected = useMemo(
    () => party.candidates.filter((c) => c.isElected),
    [party],
  );
  const color = party.primaryCanonicalId
    ? colorFor(party.primaryCanonicalId)
    : undefined;
  return (
    <div className={`border-b last:border-b-0`}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        disabled={elected.length === 0}
        className="w-full text-left flex items-center gap-3 py-2 px-3 hover:bg-accent/30 disabled:hover:bg-transparent disabled:cursor-default"
      >
        {elected.length > 0 ? (
          expanded ? (
            <ChevronDown className="size-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground shrink-0" />
          )
        ) : (
          <span className="size-4 shrink-0" />
        )}
        <span className="flex items-center gap-1.5 min-w-0 flex-1">
          {color ? (
            <span
              aria-hidden
              className="inline-block size-2 rounded-full ring-1 ring-border shrink-0"
              style={{ backgroundColor: color }}
            />
          ) : null}
          <span className="font-medium truncate" title={party.localPartyName}>
            {party.localPartyName}
          </span>
        </span>
        <span className="text-sm text-muted-foreground tabular-nums shrink-0 w-24 text-right">
          {formatThousands(party.totalVotes)}
        </span>
        <span className="text-sm text-muted-foreground tabular-nums shrink-0 w-16 text-right">
          {party.pctOfValid.toFixed(2)}%
        </span>
        <span className="font-semibold tabular-nums shrink-0 w-12 text-right">
          {party.mandatesWon}
        </span>
      </button>
      {expanded && elected.length > 0 ? (
        <ul className="pl-12 pb-2">
          {elected
            .sort((a, b) => b.prefVotes - a.prefVotes)
            .map((c) => (
              <li
                key={c.listPos}
                className="flex items-center gap-2 py-1 text-sm"
              >
                <MpAvatar name={c.name} mpId={c.mpId} showPartyRing={false} />
                <span className="font-medium">{c.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  · {formatThousands(c.prefVotes)} пр.
                </span>
              </li>
            ))}
        </ul>
      ) : null}
    </div>
  );
};

// Full party-by-party council table with expandable elected-councillor lists.
// The header `<Section>` is owned by the caller (so the Sofia район "council is
// replicated" note and the single "Общински съвет" heading aren't duplicated);
// this is the "see full results" expansion behind the compact parties tile.
const CouncilFullTable: FC<{ bundle: LocalMunicipalityBundle }> = ({
  bundle,
}) => {
  const { t } = useTranslation();
  const sorted = useMemo(
    () =>
      [...bundle.council].sort((a, b) => {
        if (b.mandatesWon !== a.mandatesWon)
          return b.mandatesWon - a.mandatesWon;
        return b.totalVotes - a.totalVotes;
      }),
    [bundle],
  );
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="text-xs uppercase tracking-wide text-muted-foreground border-b py-2 px-3 grid grid-cols-[16px_1fr_96px_64px_48px] gap-3 items-center">
        <span />
        <span>{t("local_election_th_party")}</span>
        <span className="text-right">{t("local_election_th_votes")}</span>
        <span className="text-right">{t("local_election_th_pct")}</span>
        <span className="text-right">{t("local_election_th_seats")}</span>
      </div>
      {sorted.map((p) => (
        <CouncilPartyRow key={p.localPartyNum} party={p} />
      ))}
    </div>
  );
};

// === Kmetstvo mayors table ===============================================

const KmetstvaSection: FC<{
  kmetstva: LocalKmetstvoResult[];
  obshtinaCode: string;
  cycle: string;
}> = ({ kmetstva, obshtinaCode, cycle }) => {
  const { t } = useTranslation();
  const { ekatteFor } = useKmetstvoEkatte();
  if (kmetstva.length === 0) return null;
  const rows = kmetstva.map((k) => {
    const winner = k.candidates.find((c) => c.isElected) ?? k.candidates[0];
    return {
      kmetstvo: k.kmetstvoName,
      winner,
      ekatte: ekatteFor(obshtinaCode, k.kmetstvoName),
    };
  });
  return (
    <Section title={t("local_election_sec_kmetstva")}>
      <div className="rounded-xl border bg-card">
        <table className="w-full text-sm table-fixed">
          <thead className="text-xs uppercase tracking-wide text-muted-foreground border-b">
            <tr>
              <th className="py-2 px-3 text-left w-1/5">
                {t("local_election_th_kmetstvo")}
              </th>
              <th className="py-2 px-3 text-left w-1/3">
                {t("local_election_th_candidate")}
              </th>
              <th className="py-2 px-3 text-left">
                {t("local_election_th_party")}
              </th>
              <th className="py-2 px-3 text-right w-20">
                {t("local_election_th_votes")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.kmetstvo} className="border-b last:border-b-0">
                <td className="py-2 px-3 font-medium align-top break-words">
                  {r.ekatte ? (
                    <Link
                      to={`/local/${cycle}/settlement/${r.ekatte}`}
                      className="hover:underline"
                    >
                      {r.kmetstvo}
                    </Link>
                  ) : (
                    r.kmetstvo
                  )}
                </td>
                <td className="py-2 px-3 align-top">
                  {r.winner ? (
                    <div className="flex items-start gap-2 min-w-0">
                      <MpAvatar
                        name={r.winner.candidateName}
                        mpId={r.winner.mpId}
                        showPartyRing={false}
                      />
                      <span className="break-words min-w-0">
                        {r.winner.candidateName}
                      </span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="py-2 px-3 text-muted-foreground align-top break-words">
                  {r.winner?.localPartyName ?? ""}
                </td>
                <td className="py-2 px-3 text-right tabular-nums align-top">
                  {r.winner ? formatThousands(r.winner.votes) : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
};

// === District (район) mayors — SOF only ==================================

const DistrictsSection: FC<{
  obshtinaCode: string;
  districts: LocalDistrictMayorResult[];
}> = ({ obshtinaCode, districts }) => {
  const { t } = useTranslation();
  if (districts.length === 0) return null;
  // Each row links to the район's governance place — Sofia районите resolve to
  // their own S2xxx município, Пловдив/Варна районите to the catalog id
  // (PDV22-01). Names join by the official spelling (districtCode is empty).
  return (
    <Section title={t("local_election_sec_districts")}>
      <div className="rounded-xl border bg-card">
        <table className="w-full text-sm table-fixed">
          <thead className="text-xs uppercase tracking-wide text-muted-foreground border-b">
            <tr>
              <th className="py-2 px-3 text-left w-1/5">
                {t("local_election_th_district")}
              </th>
              <th className="py-2 px-3 text-left w-1/3">
                {t("local_election_th_candidate")}
              </th>
              <th className="py-2 px-3 text-left">
                {t("local_election_th_party")}
              </th>
              <th className="py-2 px-3 text-right w-20">
                {t("local_election_th_votes")}
              </th>
              <th className="py-2 px-3 text-right w-16">
                {t("local_election_th_pct")}
              </th>
            </tr>
          </thead>
          <tbody>
            {districts.map((d) => {
              // Prefer the round-2-resolved winner: CIK flags both finalists
              // elected in round 1, so candidates.find(isElected) can return
              // the runoff loser.
              const winner =
                d.elected ??
                d.candidates.find((c) => c.isElected) ??
                d.candidates[0];
              return (
                <tr key={d.districtName} className="border-b last:border-b-0">
                  <td className="py-2 px-3 font-medium align-top break-words">
                    {(() => {
                      const govId = districtRayonGovernanceId(
                        obshtinaCode,
                        d.districtName,
                      );
                      return govId ? (
                        <Link
                          to={`/governance/${govId}`}
                          className="hover:underline"
                        >
                          {d.districtName}
                        </Link>
                      ) : (
                        d.districtName
                      );
                    })()}
                  </td>
                  <td className="py-2 px-3 align-top">
                    {winner ? (
                      <div className="flex items-start gap-2 min-w-0">
                        <MpAvatar
                          name={winner.candidateName}
                          mpId={winner.mpId}
                          showPartyRing={false}
                        />
                        <span className="break-words min-w-0">
                          {winner.candidateName}
                        </span>
                      </div>
                    ) : null}
                  </td>
                  <td className="py-2 px-3 text-muted-foreground align-top break-words">
                    {winner?.localPartyName ?? ""}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums align-top">
                    {winner ? formatThousands(winner.votes) : ""}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums align-top">
                    {winner ? `${winner.pctOfValid.toFixed(2)}%` : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
};

// === Chmi history section ================================================

const ChmiKindLabel: FC<{ kind: ChmiHistoryEvent["kind"] }> = ({ kind }) => {
  const { t } = useTranslation();
  const key =
    kind === "kmetstvo_mayor"
      ? "local_election_chmi_kind_kmetstvo"
      : kind === "rayon_mayor"
        ? "local_election_chmi_kind_rayon"
        : kind === "council"
          ? "local_election_chmi_kind_council"
          : "local_election_chmi_kind_obshtina";
  return <>{t(key)}</>;
};

const ChmiHistorySection: FC<{ events: ChmiHistoryEvent[] }> = ({ events }) => {
  const { t } = useTranslation();
  const { colorFor } = useCanonicalParties();
  if (events.length === 0) return null;
  return (
    <Section title={t("local_election_chmi_section")}>
      <div className="rounded-xl border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted-foreground border-b">
            <tr>
              <th className="py-2 px-3 text-left w-28">Дата</th>
              <th className="py-2 px-3 text-left w-36">Вид</th>
              <th className="py-2 px-3 text-left">
                {t("local_election_th_kmetstvo")} /{" "}
                {t("local_election_th_candidate")}
              </th>
              <th className="py-2 px-3 text-left">
                {t("local_election_th_party")}
              </th>
              <th className="py-2 px-3 text-right w-16">
                {t("local_election_th_pct")}
              </th>
            </tr>
          </thead>
          <tbody>
            {events.map((e, i) => {
              const color = e.primaryCanonicalId
                ? colorFor(e.primaryCanonicalId)
                : undefined;
              return (
                <tr
                  key={`${e.cycle}-${e.kmetstvoName ?? "main"}-${i}`}
                  className="border-b last:border-b-0"
                >
                  <td className="py-2 px-3 tabular-nums text-muted-foreground whitespace-nowrap">
                    {e.date}
                  </td>
                  <td className="py-2 px-3 text-muted-foreground">
                    <ChmiKindLabel kind={e.kind} />
                  </td>
                  <td className="py-2 px-3">
                    {e.kind === "council" ? (
                      <span className="font-medium">
                        {t("local_election_chmi_council_seats", {
                          won: e.councilSeatsWon ?? 0,
                          total: e.councilTotalSeats ?? 0,
                        })}
                      </span>
                    ) : (
                      <>
                        {e.kmetstvoName ? (
                          <div className="text-xs text-muted-foreground">
                            {e.kmetstvoName}
                          </div>
                        ) : null}
                        <div className="flex items-center gap-2">
                          <MpAvatar
                            name={e.candidateName}
                            mpId={e.mpId}
                            showPartyRing={false}
                          />
                          <span className="font-medium">{e.candidateName}</span>
                        </div>
                      </>
                    )}
                  </td>
                  <td className="py-2 px-3 text-muted-foreground">
                    <span className="flex items-center gap-1.5 min-w-0">
                      {color ? (
                        <span
                          aria-hidden
                          className="inline-block size-2 rounded-full ring-1 ring-border shrink-0"
                          style={{ backgroundColor: color }}
                        />
                      ) : null}
                      <span className="truncate" title={e.localPartyName}>
                        {e.localPartyName}
                      </span>
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums">
                    {e.pctOfValid.toFixed(1)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
};

// === Per-município screen ===============================================

const MunicipalityResults: FC<{
  cycle: string;
  obshtinaCode: string;
}> = ({ cycle, obshtinaCode }) => {
  const { t } = useTranslation();
  const { colorFor } = useCanonicalParties();
  const { municipality } = useLocalMunicipality(obshtinaCode, cycle);
  const chmiEvents = useChmiHistory(obshtinaCode);
  const { settlements } = useSettlementsInfo();
  const cycleDate = friendlyCycleDate(cycle);
  // Council polling-station shard drives the map shown beside both the mayor
  // and council tiles (Sofia район shards read from the city-wide SOF bundle).
  const { shard, hasCoords } = useLocalSectionShard(cycle, obshtinaCode);
  // Current-aware mayor: a later partial (частичен / нов) mayoral by-election
  // for this place supersedes the regular-cycle winner. Read the newest
  // mayoral event dated after this cycle from the already-as-of-filtered chmi
  // shard, then load that cycle's bundle for the candidates tile + comparison.
  const cycleIso = cycle.replace(/^(\d{4})_(\d{2})_(\d{2}).*/, "$1-$2-$3");
  const latestMayorEvent = useMemo(() => {
    const mayorKinds = new Set(["obshtina_mayor", "rayon_mayor"]);
    return (
      chmiEvents
        .filter((e) => mayorKinds.has(e.kind) && e.date > cycleIso)
        .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null
    );
  }, [chmiEvents, cycleIso]);
  const partialCycle = latestMayorEvent?.cycle ?? null;
  const { municipality: partialBundle } = useLocalMunicipality(
    partialCycle ? obshtinaCode : null,
    partialCycle ?? undefined,
  );
  // Район turnout: a район has no protocol of its own (the bundle carries the
  // city-wide council total), so sum the район-narrowed section shard instead.
  const isRayonPage =
    /^S2\d{3}$/.test(obshtinaCode) || !!findCityRayon(obshtinaCode);
  const rayonTurnout = useMemo(() => {
    if (!isRayonPage || !shard) return null;
    let registered = 0;
    let actual = 0;
    for (const s of shard.sections) {
      registered += s.numRegisteredVoters || 0;
      actual += s.totalActualVoters || 0;
    }
    return registered > 0 ? { registered, actual } : null;
  }, [isRayonPage, shard]);
  // Risk-votes block — present only when this município owns ≥1 flagged
  // "problem section" (most don't). A Sofia район shard's neighborhoods are
  // keyed to the SOF city bundle + the район's 2-digit код (S2511 → "11"), so
  // re-anchor the lookup there to surface them on the район page too.
  const { data: problemReport } = useLocalProblemSections(cycle);
  const problemRayonCode = /^S2\d{3}$/.test(obshtinaCode)
    ? obshtinaCode.slice(-2)
    : undefined;
  const problemParent = problemRayonCode ? "SOF" : obshtinaCode;
  const hasProblemSections =
    problemReport?.neighborhoods.some(
      (n) =>
        n.obshtinaCode === problemParent &&
        (!problemRayonCode || n.rayonCode === problemRayonCode),
    ) ?? false;

  if (!municipality) {
    return (
      <section className="my-4 space-y-4">
        <div className="text-xs text-muted-foreground">
          <Link to={`/local/${cycle}`} className="hover:underline">
            {t("local_election_screen_back")}
          </Link>
        </div>
        <h1 className="text-2xl font-semibold">{obshtinaCode}</h1>
        <p className="text-sm text-muted-foreground">
          {t("local_election_no_data")}
        </p>
      </section>
    );
  }

  const isSofiaRayon = /^S2\d{3}$/.test(municipality.obshtinaCode);
  const isSofiaCity = municipality.obshtinaCode === "SOF";
  // A Sofia район is one "settlement" in the parliamentary/my-area trees
  // (composite EKATTE "68134-NNNN"), so resolve that code to point the
  // switcher at the район's parliamentary + my-area pages rather than at a
  // non-existent S2xxx parliamentary município.
  const rayonEkatte = isSofiaRayon
    ? settlements?.find((s) => s.obshtina === municipality.obshtinaCode)?.ekatte
    : undefined;
  const mayorSectionTitle = isSofiaRayon
    ? t("local_election_sec_mayor_rayon")
    : t("local_election_sec_mayor_obshtina");

  // A newer mayoral by-election supersedes the regular-cycle winner: lead the
  // mayor section + Кмет card with it and relegate the regular results below
  // the timeline. Only when the partial bundle actually carries a mayor race.
  const showPartial =
    !!latestMayorEvent &&
    !!partialBundle &&
    partialBundle.mayor.round1.length > 0;
  const partialDate = partialCycle ? friendlyCycleDate(partialCycle) : "";
  const currentMayor =
    showPartial && partialBundle?.mayor.elected
      ? { name: partialBundle.mayor.elected.candidateName, date: partialDate }
      : null;

  // Per-ballot stats for the two office cards. A район has no protocol of its
  // own (the bundle's protocol is the parent city's city-wide council total),
  // so its turnout and council valid-votes come from the район-narrowed section
  // shard; the council is always the regular cycle being viewed, while the
  // mayor comes from the superseding by-election when one exists.
  const isRayon = isSofiaRayon || !!findCityRayon(obshtinaCode);
  const electionTurnout =
    isRayon && rayonTurnout
      ? `${((rayonTurnout.actual / rayonTurnout.registered) * 100).toFixed(1)}%`
      : !isRayon && municipality.protocol.numRegisteredVoters > 0
        ? `${((municipality.protocol.totalActualVoters / municipality.protocol.numRegisteredVoters) * 100).toFixed(1)}%`
        : null;
  const councilVotes =
    isRayon && shard
      ? shard.sections.reduce((a, s) => a + (s.numValidVotes || 0), 0)
      : municipality.protocol.numValidVotes > 0
        ? municipality.protocol.numValidVotes
        : municipality.council.reduce((a, p) => a + p.totalVotes, 0);
  const regularSource = t("local_election_ballot_source_regular", {
    date: cycleDate,
  });
  const mayorBallotBundle =
    showPartial && partialBundle ? partialBundle.mayor : municipality.mayor;
  const mayorBallot: BallotStat = {
    votes: mayorBallotBundle.round1.reduce((a, m) => a + m.votes, 0),
    // The by-election reports no turnout; a regular-cycle mayor shares the
    // council's turnout (cast on the same day).
    turnout: showPartial ? null : electionTurnout,
    source: showPartial
      ? t("local_election_ballot_source_partial", { date: partialDate })
      : regularSource,
  };
  const councilBallot: BallotStat = {
    votes: councilVotes,
    turnout: electionTurnout,
    source: regularSource,
  };

  // Runoff head-to-head bar for a mayor race that went to round 2.
  const mayorRunoff = (round2?: LocalMayorResult[]) =>
    round2 && round2.length > 0 ? (
      <div className="mb-3">
        <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
          {t("local_election_sec_round_2")}
        </div>
        <LocalMayorRunoffBar round2={round2} />
      </div>
    ) : null;

  // Mayor-candidate legend (ballot list № → name + party colour) for the mayor
  // map, built from the regular-cycle mayor candidates — their list numbers
  // match the КО/КР per-section vote rows.
  const NEUTRAL = "#9ca3af";
  const mayorLegend = new Map<number, { name: string; color: string }>();
  for (const c of municipality.mayor.round1) {
    mayorLegend.set(c.localPartyNum, {
      name: c.candidateName,
      color: c.primaryCanonicalId
        ? (colorFor(c.primaryCanonicalId) ?? NEUTRAL)
        : NEUTRAL,
    });
  }
  // A район reads its own район-mayor ballot (КР); everywhere else the
  // município-mayor ballot (КО).
  const mayorVoteField = isRayon ? "rayonMayorVotes" : "mayorVotes";
  const hasMayorMapData = !!shard?.sections.some(
    (s) => (s[mayorVoteField]?.length ?? 0) > 0,
  );

  // The two station maps. Each self-hides (null) when its data is absent — the
  // council map when stations lack coordinates, the mayor map additionally when
  // the cycle carries no per-section mayor votes (older cycles / by-elections).
  // Sofia city skips both: it shows район choropleths above instead, and would
  // otherwise mount the same heavy ~1,640-marker Leaflet layer twice.
  const councilMap =
    hasCoords && shard && !isSofiaCity ? (
      <LocalSectionsMapTile
        shard={shard}
        cycle={cycle}
        obshtinaCode={obshtinaCode}
        metric="council"
      />
    ) : null;
  const mayorMap =
    hasCoords && shard && !isSofiaCity && hasMayorMapData ? (
      <LocalSectionsMapTile
        shard={shard}
        cycle={cycle}
        obshtinaCode={obshtinaCode}
        metric="mayor"
        mayorLegend={mayorLegend}
        mayorVoteField={mayorVoteField}
      />
    ) : null;

  // A race row: a station map (when present) beside the compact tile, mirroring
  // the parliamentary map + top-parties layout; collapses to the tile alone
  // when the map self-hid.
  const raceRow = (tile: React.ReactNode, map: React.ReactNode) =>
    map ? (
      <div className="grid gap-3 grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {map}
        {tile}
      </div>
    ) : (
      tile
    );

  return (
    <section className="my-4">
      {/* Unified place header with the full three-way switcher (My-Area
          governance / Parliamentary / Local). The Sofia city aggregate now
          has a city-wide My-Area dashboard too, so it gets the same switcher
          as every other município — placeViews maps its SOF code to /sofia
          and /my-area/SOF00. Sofia районs also surface a "→ all of Sofia"
          link. */}
      <PlaceHeader
        active="local"
        level={isSofiaRayon ? "settlement" : "municipality"}
        ekatte={rayonEkatte}
        obshtina={municipality.obshtinaCode}
        fallbackName={municipality.obshtinaName}
        eyebrowTo={`/local/${cycle}`}
        eyebrowSuffix={cycleDate}
        extra={
          isSofiaRayon ? (
            <Link
              to={`/local/${cycle}/SOF`}
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              {t("local_election_sofia_rayon_link")}
              <ArrowRight className="size-3" />
            </Link>
          ) : undefined
        }
        className="mb-4"
      />

      <StatsGrid
        bundle={municipality}
        isRayon={isRayon}
        currentMayor={currentMayor}
        mayorBallot={mayorBallot}
        councilBallot={councilBallot}
      />

      {/* Sofia city: both район choropleths at the top of the page so the
          24-район map reads as the primary geographic view, alongside the
          standard district-mayor table further down. */}
      {isSofiaCity && municipality.districts.length > 0 ? (
        <Section title={t("local_sec_maps")}>
          <div className="grid gap-4 lg:grid-cols-2">
            <LocalSofiaRayonMapTile cycle={cycle} metric="mayor" />
            <LocalSofiaRayonMapTile cycle={cycle} metric="council" />
          </div>
        </Section>
      ) : null}

      {/* Mayor vs council split indicator — hides for Sofia район shards
          (they replicate the city council, so the comparison is meaningless). */}
      {!isSofiaRayon ? (
        <div className="mt-4">
          <MayorVsCouncilTile bundle={municipality} />
        </div>
      ) : null}

      {/* Mayor — the section-vote map beside a compact candidate tile
          (mirrors the parliamentary map + top-parties row); the full candidate
          ranking lives on the dedicated /mayor page the tile links to. For
          runoff races the head-to-head bar leads. */}
      <Section title={mayorSectionTitle}>
        {showPartial && partialBundle && partialCycle ? (
          <>
            {/* Current officeholder — lead with the most recent (partial) vote.
                No station map here: the by-election is HTML-only (no per-section
                results), and the regular-cycle shard's mayor map is a different
                election — that map sits with the regular results below. */}
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
              {t("local_election_partial_eyebrow", { date: partialDate })}
            </div>
            {mayorRunoff(partialBundle.mayor.round2)}
            <TopMayorsTile
              candidates={partialBundle.mayor.round1}
              electedName={partialBundle.mayor.elected?.candidateName ?? null}
              to={`/local/${partialCycle}/${obshtinaCode}/mayor`}
            />
            {/* How the by-election compared to the last full local vote. */}
            <LocalMidtermComparisonTile
              regular={municipality.mayor}
              partial={partialBundle.mayor}
              regularDate={cycleDate}
              partialDate={partialDate}
              className="mt-4"
            />
            {/* Who governed before — newest first; self-hides under two cycles. */}
            <LocalMayorTimelineTile
              obshtinaCode={obshtinaCode}
              className="mt-4"
            />
            {/* Original regular-cycle results, relegated below the timeline. */}
            <div className="mt-6">
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                {t("local_election_regular_results_title", { date: cycleDate })}
              </div>
              {mayorRunoff(municipality.mayor.round2)}
              {raceRow(
                <TopMayorsTile
                  candidates={municipality.mayor.round1}
                  electedName={
                    municipality.mayor.elected?.candidateName ?? null
                  }
                  to={`/local/${cycle}/${obshtinaCode}/mayor`}
                />,
                mayorMap,
              )}
            </div>
          </>
        ) : (
          <>
            {mayorRunoff(municipality.mayor.round2)}
            {raceRow(
              <TopMayorsTile
                candidates={municipality.mayor.round1}
                electedName={municipality.mayor.elected?.candidateName ?? null}
                to={`/local/${cycle}/${obshtinaCode}/mayor`}
              />,
              mayorMap,
            )}
            {/* Who governed before — elected mayor in each prior cycle, newest
                first. Self-hides for municípios with under two cycles of data. */}
            <LocalMayorTimelineTile
              obshtinaCode={obshtinaCode}
              className="mt-4"
            />
          </>
        )}
      </Section>

      {/* Kmetstvo + район mayors — sub-municipal mayor tier, grouped with the
          Municipal mayor section above (not council). Each self-hides when the
          município has no kmetstva / districts. */}
      <KmetstvaSection
        kmetstva={municipality.kmetstva}
        obshtinaCode={obshtinaCode}
        cycle={cycle}
      />
      <DistrictsSection
        obshtinaCode={obshtinaCode}
        districts={municipality.districts}
      />

      {/* Extraordinary (частични / нови) elections held since this regular
          cycle — predominantly fresh mayor by-elections, so the summary sits
          with the mayor tier, above the council block, instead of buried at
          the very bottom of the page. Self-hides when there are no chmi
          events for this município. */}
      <ChmiHistorySection events={chmiEvents} />

      {/* Council — one "Общински съвет" heading (the nested duplicate that
          Sofia район shards used to show is gone). Composition hemicycle, then
          the section-vote map beside the compact parties tile; the full
          party-by-party table lives on the dedicated /council page the tile
          links to; top councillors by preference close the block. */}
      <Section title={t("local_election_sec_council")}>
        {isSofiaRayon ? (
          <p className="text-sm text-muted-foreground mb-3">
            {t("local_election_council_replicated")}
          </p>
        ) : null}
        <div className="mb-3">
          <LocalCouncilHemicycleTile council={municipality.council} />
        </div>
        {raceRow(
          <TopCouncilPartiesTile
            council={municipality.council}
            to={`/local/${cycle}/${obshtinaCode}/council`}
          />,
          councilMap,
        )}
        {/* Top councillors by preference — only when at least one slate
            recorded preferential votes (some pre-2019 cycles do not). */}
        {municipality.council.some((p) =>
          p.candidates.some((c) => c.isElected && c.prefVotes > 0),
        ) ? (
          <div className="mt-4">
            <TopCouncillorsTile bundle={municipality} />
          </div>
        ) : null}
        {/* Council vote share per party across the prior local cycles — the
            place-scoped sibling of the national trend tile. Skipped for Sofia
            район shards (their council replicates the city-wide bundle, so a
            per-район trend would just duplicate the city line). Self-hides
            otherwise when there are under two cycles of council signal. */}
        {!isSofiaRayon ? (
          <LocalCouncilTrendsTile
            obshtinaCode={obshtinaCode}
            className="mt-4"
          />
        ) : null}
      </Section>

      {/* Per-polling-station council results + turnout — self-hides for cycles
          / municípios without an ingested section shard (e.g. Sofia район
          shards, whose sections live under the SOF bundle). */}
      <LocalSectionsTile cycle={cycle} obshtinaCode={obshtinaCode} />

      {/* Risk votes — council-ballot distribution inside the curated Roma-
          neighborhood "problem sections" for this município (local analogue of
          the parliamentary RISK VOTES block). Gated on a real match so no empty
          heading renders. */}
      {hasProblemSections ? (
        <DashboardSection
          id="local-risk-votes"
          title={t("dashboard_section_neighborhoods")}
          icon={ShieldAlert}
        >
          <LocalProblemVotesByPartyTile
            obshtinaCode={problemParent}
            rayonCode={problemRayonCode}
            cycle={cycle}
          />
        </DashboardSection>
      ) : null}

      {/* Supplementary place data — the same geography / finances / current-
          officials tiles the parliamentary município page carries, keyed by the
          shared obshtina code. Each tile self-hides without data; the whole
          block is skipped for Sofia район shards (sub-units, not real
          municipalities for these datasets) AND for the Sofia city aggregate
          (its datasets key on SOF00, not the local SOF code, so every tile here
          would self-hide and leave empty section shells — that geography +
          governance content lives on the city My-Area dashboard, linked from
          the header switcher above). */}
      {!isSofiaRayon && !isSofiaCity ? (
        <>
          <DashboardSection
            id="geography"
            title={t("dashboard_section_geography")}
            icon={MapIcon}
          >
            <CensusDemographicsTile regionCode={obshtinaCode} isMunicipality />
            <IndicatorsTile obshtinaCode={obshtinaCode} />
          </DashboardSection>

          <DashboardSection
            id="local_government"
            title={t("dashboard_section_local_government")}
            icon={Landmark}
          >
            <OfficialsDiffTile obshtinaCode={obshtinaCode} />
            <MunicipalOfficialsRosterTile obshtinaCode={obshtinaCode} />
          </DashboardSection>

          {/* Municipal finances (state-budget transfers, EU funds, capital
              programme, IPOP execution, MP-linked companies) intentionally
              live only on the personal /my-area dashboard now — the place
              switcher in the header above links straight to it. Keeping the
              finances block out of this election-results page avoids the
              duplicate heavy budget/funds fetches on every município view. */}
        </>
      ) : null}
    </section>
  );
};

// === Full mayor / council results sub-pages =============================
// /local/:cycle/:obshtinaCode/mayor and .../council — the complete breakdown
// behind the "see full results" link on each compact tile of the município
// page. The município page itself stays at-a-glance (map + compact tile).

const LocalRaceResults: FC<{
  cycle: string;
  obshtinaCode: string;
  race: "mayor" | "council";
}> = ({ cycle, obshtinaCode, race }) => {
  const { t } = useTranslation();
  const { municipality } = useLocalMunicipality(obshtinaCode, cycle);

  const back = (
    <div className="mb-2 text-xs text-muted-foreground">
      <Link to={`/local/${cycle}`} className="hover:underline">
        {t("local_election_screen_back")}
      </Link>
      <span className="mx-2">·</span>
      <Link to={`/local/${cycle}/${obshtinaCode}`} className="hover:underline">
        {municipality?.obshtinaName ?? obshtinaCode}
      </Link>
      <span className="mx-2">·</span>
      <span>{friendlyCycleDate(cycle)}</span>
    </div>
  );

  if (!municipality) {
    return (
      <section className="my-4">
        {back}
        <p className="text-sm text-muted-foreground">
          {t("local_election_no_data")}
        </p>
      </section>
    );
  }

  const isSofiaRayon = /^S2\d{3}$/.test(municipality.obshtinaCode);
  const hasRound2 =
    !!municipality.mayor.round2 && municipality.mayor.round2.length > 0;
  const title =
    race === "mayor"
      ? isSofiaRayon
        ? t("local_election_sec_mayor_rayon")
        : t("local_election_sec_mayor_obshtina")
      : t("local_election_sec_council");

  return (
    <section className="my-4">
      {back}
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        {municipality.obshtinaName}
      </p>

      {race === "mayor" ? (
        hasRound2 ? (
          <>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
              {t("local_election_sec_round_2")}
            </div>
            <LocalMayorRunoffBar round2={municipality.mayor.round2!} />
            <MayorTable candidates={municipality.mayor.round2!} />
            <div className="text-xs uppercase tracking-wide text-muted-foreground mt-4 mb-2">
              {t("local_election_sec_round_1")}
            </div>
            <MayorTable candidates={municipality.mayor.round1} />
          </>
        ) : (
          <MayorTable candidates={municipality.mayor.round1} />
        )
      ) : (
        <>
          {isSofiaRayon ? (
            <p className="text-sm text-muted-foreground mb-3">
              {t("local_election_council_replicated")}
            </p>
          ) : null}
          <div className="mb-4">
            <LocalCouncilHemicycleTile council={municipality.council} />
          </div>
          <CouncilFullTable bundle={municipality} />
          {municipality.council.some((p) =>
            p.candidates.some((c) => c.isElected && c.prefVotes > 0),
          ) ? (
            <div className="mt-6">
              <TopCouncillorsTile bundle={municipality} />
            </div>
          ) : null}
        </>
      )}
    </section>
  );
};

export const LocalRaceScreen: FC<{ race: "mayor" | "council" }> = ({
  race,
}) => {
  const { cycle, obshtinaCode } = useParams<{
    cycle: string;
    obshtinaCode: string;
  }>();
  if (!cycle || !obshtinaCode) return null;
  return (
    <LocalRaceResults cycle={cycle} obshtinaCode={obshtinaCode} race={race} />
  );
};

// === Country overview ===================================================

const CountryDashboard: FC<{ cycle: string }> = ({ cycle }) => {
  return (
    <section className="my-4 space-y-6">
      {/* Header stays eyebrow + title + switcher only, matching the
          parliamentary (/) and governance (/governance) country headers so
          toggling the view pills doesn't jump the layout. The reconciliation /
          extraordinary / Sofia cross-links that used to sit here are dropped:
          /sverka lives in the reports menu, the extraordinary feed has its own
          dashboard section below, and Sofia city-wide opens from its map tile. */}
      <PlaceHeader
        active="local"
        level="country"
        eyebrowSuffix={friendlyCycleDate(cycle)}
      />
      <LocalCountryDashboardCards cycle={cycle} />
    </section>
  );
};

// === Top-level screen ===================================================

// === Per-район (Пловдив/Варна) local screen =============================
// A sub-city район has a directly-elected районен кмет but no council of its
// own (the общински съвет is city-wide). So its local view is the районен-кмет
// race + район station map, with the council deferred to the parent city page —
// a lean counterpart to a Sofia район's /local/<cycle>/S2xxx page. The районен
// кмет data lives in the parent city bundle's districts[], matched by name.

const RayonLocalResults: FC<{ cycle: string; rayon: CityRayon }> = ({
  cycle,
  rayon,
}) => {
  const { t, i18n } = useTranslation();
  const { colorFor } = useCanonicalParties();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const { municipality } = useLocalMunicipality(rayon.obshtina, cycle);
  const cycleDate = friendlyCycleDate(cycle);
  const { shard, hasCoords } = useLocalSectionShard(cycle, rayon.id);
  const district = useMemo(
    () =>
      municipality?.districts.find(
        (d) =>
          findCityRayonByName(rayon.obshtina, d.districtName)?.id === rayon.id,
      ),
    [municipality, rayon],
  );
  // Mayor-candidate legend for the район-mayor section map — the районен-кмет
  // candidates' ballot numbers match the КР `rayonMayorVotes` rows. So the map
  // colours by leading candidate (not council party). Self-hides when the
  // narrowed shard carries no КР votes (older cycles).
  const mayorLegend = useMemo(() => {
    const m = new Map<number, { name: string; color: string }>();
    for (const c of district?.candidates ?? [])
      m.set(c.localPartyNum, {
        name: c.candidateName,
        color: c.primaryCanonicalId
          ? (colorFor(c.primaryCanonicalId) ?? "#9ca3af")
          : "#9ca3af",
      });
    return m;
  }, [district, colorFor]);
  const hasRayonMayorMap = !!shard?.sections.some(
    (s) => (s.rayonMayorVotes?.length ?? 0) > 0,
  );
  // Risk-votes block — the Roma-neighborhood council-ballot distribution for the
  // flagged sections that fall inside this район (Максуда → район Младост,
  // Столипиново → Източен). Keyed by the parent city bundle + this район's
  // 2-digit код, so a район with no flagged sections renders nothing.
  const { data: problemReport } = useLocalProblemSections(cycle);
  const hasProblemSections =
    problemReport?.neighborhoods.some(
      (n) => n.obshtinaCode === rayon.obshtina && n.rayonCode === rayon.code,
    ) ?? false;
  const cityName = lang === "bg" ? rayon.cityBg : rayon.cityEn;
  const rayonName = lang === "bg" ? rayon.labelBg : rayon.labelEn;

  if (!municipality) {
    return (
      <section className="my-4 space-y-4">
        <div className="text-xs text-muted-foreground">
          <Link to={`/local/${cycle}`} className="hover:underline">
            {t("local_election_screen_back")}
          </Link>
        </div>
        <h1 className="text-2xl font-semibold">{rayonName}</h1>
        <p className="text-sm text-muted-foreground">
          {t("local_election_no_data")}
        </p>
      </section>
    );
  }

  const mayorTile = district ? (
    <TopMayorsTile
      candidates={district.candidates}
      electedName={district.elected?.candidateName ?? null}
      to={`/local/${cycle}/${rayon.obshtina}`}
    />
  ) : null;

  // Район-specific stat tiles, mirroring the Sofia район page: separate
  // mayor / council ballots (район turnout summed from the район-narrowed
  // shard; the council is elected city-wide so its seats come from the parent
  // city bundle, flagged "общоградски вот").
  const rayonReg =
    shard?.sections.reduce((a, s) => a + (s.numRegisteredVoters || 0), 0) ?? 0;
  const rayonAct =
    shard?.sections.reduce((a, s) => a + (s.totalActualVoters || 0), 0) ?? 0;
  const rayonTurnout =
    rayonReg > 0 ? `${((rayonAct / rayonReg) * 100).toFixed(1)}%` : null;
  const rayonCouncilValid =
    shard?.sections.reduce((a, s) => a + (s.numValidVotes || 0), 0) ?? 0;
  const rayonMayorValid = district
    ? district.candidates.reduce((a, c) => a + c.votes, 0)
    : 0;
  const cityCouncilSeats = municipality.council.reduce(
    (a, p) => a + p.mandatesWon,
    0,
  );
  const cityCouncilParties = municipality.council.filter(
    (p) => p.mandatesWon > 0,
  ).length;
  const regularSource = t("local_election_ballot_source_regular", {
    date: cycleDate,
  });

  return (
    <section className="my-4">
      <PlaceHeader
        active="local"
        level="municipality"
        obshtina={rayon.id}
        fallbackName={rayonName}
        eyebrowTo={`/local/${cycle}`}
        eyebrowSuffix={cycleDate}
        className="mb-4"
      />

      {district ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <StatItem
            label={t("local_election_stat_mayor")}
            value={
              district.elected ? (
                <span className="truncate">
                  {district.elected.candidateName}
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">
                  {t("local_election_no_winner")}
                </span>
              )
            }
          />
          <BallotCard
            label={t("local_election_ballot_mayor")}
            stat={{
              votes: rayonMayorValid,
              turnout: rayonTurnout,
              source: regularSource,
            }}
          />
          <StatItem
            label={t("local_election_stat_council_seats")}
            value={
              <span className="tabular-nums">
                {cityCouncilSeats}{" "}
                <span className="text-xs text-muted-foreground font-normal">
                  · {cityCouncilParties}{" "}
                  {t("local_election_stat_council_parties")}
                </span>
              </span>
            }
            sub={t("local_election_stat_council_citywide_sub")}
          />
          <BallotCard
            label={t("local_election_ballot_council")}
            stat={{
              votes: rayonCouncilValid,
              turnout: rayonTurnout,
              source: regularSource,
            }}
          />
        </div>
      ) : null}

      {district ? (
        <Section title={t("local_district_mayor")}>
          {district.round2 && district.round2.length > 0 ? (
            <div className="mb-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                {t("local_election_sec_round_2")}
              </div>
              <LocalMayorRunoffBar round2={district.round2} />
            </div>
          ) : null}
          {hasCoords && shard && hasRayonMayorMap ? (
            <div className="grid gap-3 grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <LocalSectionsMapTile
                shard={shard}
                cycle={cycle}
                obshtinaCode={rayon.obshtina}
                metric="mayor"
                mayorLegend={mayorLegend}
                mayorVoteField="rayonMayorVotes"
              />
              {mayorTile}
            </div>
          ) : (
            mayorTile
          )}
        </Section>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("local_election_no_data")}
        </p>
      )}

      {/* Council is elected city-wide — районите don't have one of their own,
          so link to the parent Община's council instead of duplicating it. */}
      <Section title={t("local_election_sec_council")}>
        <p className="text-sm text-muted-foreground">
          {lang === "bg"
            ? "Общинският съвет е общоградски — районите нямат собствен съвет. "
            : "The municipal council is elected city-wide — districts have none of their own. "}
          <Link
            to={`/local/${cycle}/${rayon.obshtina}/council`}
            className="text-primary hover:underline"
          >
            {lang === "bg"
              ? `Виж съвета на Община ${cityName} →`
              : `See the ${cityName} municipality council →`}
          </Link>
        </p>
      </Section>

      {/* Risk votes — council-ballot distribution inside the curated Roma-
          neighborhood "problem sections" that sit in this район (e.g. Максуда
          in район Младост). Gated on a real match so no empty heading renders. */}
      {hasProblemSections ? (
        <DashboardSection
          id="local-risk-votes"
          title={t("dashboard_section_neighborhoods")}
          icon={ShieldAlert}
        >
          <LocalProblemVotesByPartyTile
            obshtinaCode={rayon.obshtina}
            rayonCode={rayon.code}
            cycle={cycle}
          />
        </DashboardSection>
      ) : null}
    </section>
  );
};

export const LocalElectionScreen: FC = () => {
  const { cycle, obshtinaCode } = useParams<{
    cycle: string;
    obshtinaCode?: string;
  }>();
  if (!cycle) return null;
  if (obshtinaCode) {
    // Пловдив/Варна район ids ("VAR06-02") get their own lean район view; every
    // other code is a real local município bundle.
    const cityRayon = findCityRayon(obshtinaCode);
    if (cityRayon) {
      return <RayonLocalResults cycle={cycle} rayon={cityRayon} />;
    }
    return <MunicipalityResults cycle={cycle} obshtinaCode={obshtinaCode} />;
  }
  return <CountryDashboard cycle={cycle} />;
};
