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
import { ArrowRight, ChevronDown, ChevronRight } from "lucide-react";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { useLocalElectionIndex } from "@/data/local/useLocalElectionIndex";
import { useLocalMunicipality } from "@/data/local/useLocalMunicipality";
import { useLocalRegionsSummary } from "@/data/local/useLocalRegionsSummary";
import { useChmiHistory } from "@/data/local/useChmiHistory";
import type { ChmiHistoryEvent } from "@/data/local/useChmiHistory";
import { useKmetstvoEkatte } from "@/data/local/useKmetstvoEkatte";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { useRegions } from "@/data/regions/useRegions";
import { LocalMayorsControlMapTile } from "./dashboard/local/LocalMayorsControlMapTile";
import { PartyChip, RankedBar } from "./components/local/LocalRankedBar";
import { MyAreaCouncilTile } from "./myarea/MyAreaCouncilTile";
import { formatThousands } from "@/data/utils";
import {
  LocalCouncilParty,
  LocalKmetstvoResult,
  LocalDistrictMayorResult,
  LocalMayorResult,
  LocalMunicipalityBundle,
} from "@/data/local/types";

// "2023_10_29_mi" → "29.10.2023"
const friendlyCycleDate = (cycle: string): string => {
  const m = cycle.match(/^(\d{4})_(\d{2})_(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : cycle;
};

// === Stats grid ===========================================================

const StatItem: FC<{ label: string; value: React.ReactNode }> = ({
  label,
  value,
}) => (
  <div className="rounded-xl border bg-card p-4 shadow-sm">
    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {label}
    </div>
    <div className="mt-1 text-base font-semibold leading-tight">{value}</div>
  </div>
);

const StatsGrid: FC<{ bundle: LocalMunicipalityBundle }> = ({ bundle }) => {
  const { t } = useTranslation();
  const totalSeats = bundle.council.reduce((a, p) => a + p.mandatesWon, 0);
  const partiesWithSeats = bundle.council.filter(
    (p) => p.mandatesWon > 0,
  ).length;
  // CIK's rezultati HTML page doesn't carry voter-registration / turnout
  // totals — those live on a separate "Активност" page that isn't ingested
  // yet. Hide the tile rather than show "—" until that ingest lands.
  const turnoutPct =
    bundle.protocol.numRegisteredVoters > 0
      ? `${((bundle.protocol.totalActualVoters / bundle.protocol.numRegisteredVoters) * 100).toFixed(1)}%`
      : null;
  // Valid votes: prefer the ingested protocol total; otherwise derive from
  // the dominant ballot on this page. Sofia район shards replicate the
  // city-wide council, so their район-specific denominator is the round-1
  // mayor sum; everywhere else the council ballot is the canonical total.
  const isSofiaRayon = /^S2\d{3}$/.test(bundle.obshtinaCode);
  const derivedValidVotes = isSofiaRayon
    ? bundle.mayor.round1.reduce((a, m) => a + m.votes, 0)
    : bundle.council.reduce((a, p) => a + p.totalVotes, 0);
  const validVotes =
    bundle.protocol.numValidVotes > 0
      ? bundle.protocol.numValidVotes
      : derivedValidVotes;
  const mayor = bundle.mayor.elected;
  const cols = turnoutPct ? "md:grid-cols-4" : "md:grid-cols-3";
  return (
    <div className={`grid grid-cols-2 ${cols} gap-3`}>
      <StatItem
        label={t("local_election_stat_mayor")}
        value={
          mayor ? (
            <span className="flex items-center gap-1.5">
              <span className="truncate">{mayor.candidateName}</span>
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">
              {t("local_election_no_winner")}
            </span>
          )
        }
      />
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
      />
      {turnoutPct ? (
        <StatItem
          label={t("local_election_stat_turnout")}
          value={<span className="tabular-nums">{turnoutPct}</span>}
        />
      ) : null}
      {validVotes > 0 ? (
        <StatItem
          label={t("local_election_stat_valid_votes")}
          value={
            <span className="tabular-nums">{formatThousands(validVotes)}</span>
          }
        />
      ) : null}
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

const CouncilSection: FC<{ bundle: LocalMunicipalityBundle }> = ({
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
    <Section title={t("local_election_sec_council")}>
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
    </Section>
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
  cycle: string;
  districts: LocalDistrictMayorResult[];
}> = ({ cycle, districts }) => {
  const { t } = useTranslation();
  if (districts.length === 0) return null;
  // For each district, find the matching S2*** obshtinaCode by name so the
  // row links to the district shard's full results.
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
                    <Link
                      to={`/local/${cycle}/by-name/${encodeURIComponent(d.districtName)}`}
                      className="hover:underline"
                    >
                      {d.districtName}
                    </Link>
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
  const { municipality } = useLocalMunicipality(obshtinaCode, cycle);
  const chmiEvents = useChmiHistory(obshtinaCode);
  const cycleDate = friendlyCycleDate(cycle);

  if (!municipality) {
    return (
      <main className="container mx-auto px-4 py-6 space-y-4">
        <div className="text-xs text-muted-foreground">
          <Link to={`/local/${cycle}`} className="hover:underline">
            {t("local_election_screen_back")}
          </Link>
        </div>
        <h1 className="text-2xl font-semibold">{obshtinaCode}</h1>
        <p className="text-sm text-muted-foreground">
          {t("local_election_no_data")}
        </p>
      </main>
    );
  }

  const isSofiaRayon = /^S2\d{3}$/.test(municipality.obshtinaCode);
  const mayorSectionTitle = isSofiaRayon
    ? t("local_election_sec_mayor_rayon")
    : t("local_election_sec_mayor_obshtina");

  return (
    <main className="container mx-auto px-4 py-6">
      <div className="text-xs text-muted-foreground mb-2">
        <Link to={`/local/${cycle}`} className="hover:underline">
          {t("local_election_screen_back")}
        </Link>
        <span className="mx-2">·</span>
        <span>{cycleDate}</span>
      </div>
      <h1 className="text-2xl font-semibold mb-1">
        {municipality.obshtinaName}
      </h1>
      {isSofiaRayon ? (
        <div className="mb-4">
          <Link
            to={`/local/${cycle}/SOF`}
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            {t("local_election_sofia_rayon_link")}
            <ArrowRight className="size-3" />
          </Link>
        </div>
      ) : null}

      <StatsGrid bundle={municipality} />

      {/* Mayor: round 1 always; round 2 if present. */}
      <Section title={mayorSectionTitle}>
        {municipality.mayor.round2 && municipality.mayor.round2.length > 0 ? (
          <>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
              {t("local_election_sec_round_2")}
            </div>
            <MayorTable candidates={municipality.mayor.round2} />
            <div className="text-xs uppercase tracking-wide text-muted-foreground mt-4 mb-2">
              {t("local_election_sec_round_1")}
            </div>
            <MayorTable candidates={municipality.mayor.round1} />
          </>
        ) : (
          <MayorTable candidates={municipality.mayor.round1} />
        )}
      </Section>

      {isSofiaRayon ? (
        <Section title={t("local_election_sec_council")}>
          <p className="text-sm text-muted-foreground">
            {t("local_election_council_replicated")}
          </p>
          <div className="mt-3">
            <CouncilSection bundle={municipality} />
          </div>
        </Section>
      ) : (
        <CouncilSection bundle={municipality} />
      )}

      {/* Council activity tile — same unified surface as MyAreaCouncilTile,
          showing recent council decisions + per-councillor named-vote
          breakdowns where ingested. Auto-hides for municípios whose council
          ingest hasn't run yet (most of the 265 общини today). For the 9
          wired municipalities the per-councillor avatars sit alongside the
          slate results above, letting the public-facing per-município page
          answer both "who got elected" and "how have they been voting since". */}
      <div className="mt-4">
        <MyAreaCouncilTile obshtina={obshtinaCode} />
      </div>

      <KmetstvaSection
        kmetstva={municipality.kmetstva}
        obshtinaCode={obshtinaCode}
        cycle={cycle}
      />
      <DistrictsSection cycle={cycle} districts={municipality.districts} />
      <ChmiHistorySection events={chmiEvents} />
    </main>
  );
};

// === Cycle overview =====================================================

// National top-regions table: which party controls each oblast's mayoralties.
const TopRegionsTable: FC<{ cycle: string }> = ({ cycle }) => {
  const { t, i18n } = useTranslation();
  const { data: summary } = useLocalRegionsSummary(cycle);
  const { findRegion } = useRegions();
  const rows = useMemo(
    () =>
      summary
        ? [...summary.regions].sort(
            (a, b) => b.municipalityCount - a.municipalityCount,
          )
        : [],
    [summary],
  );
  if (rows.length === 0) return null;
  const regionName = (code: string): string => {
    const info = findRegion(code);
    if (!info) return code === "SOF" ? t("local_region_sofia_city") : code;
    return (
      (i18n.language === "bg"
        ? info.long_name || info.name
        : info.long_name_en || info.name_en) || code
    );
  };
  const regionPath = (code: string): string =>
    code === "SOF" ? `/local/${cycle}/SOF` : `/local/${cycle}/region/${code}`;
  return (
    <section>
      <h2 className="text-lg font-semibold mb-3">
        {t("local_national_regions_section")}
      </h2>
      <div className="rounded-xl border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted-foreground border-b">
            <tr>
              <th className="py-2 px-3 text-left">
                {t("local_region_th_region")}
              </th>
              <th className="py-2 px-3 text-left">
                {t("local_region_th_control")}
              </th>
              <th className="hidden py-2 px-3 text-right w-20 sm:table-cell">
                {t("local_election_stat_council_seats")}
              </th>
              <th className="py-2 px-3 text-right w-16">
                {t("local_region_th_municipalities")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.oblast} className="border-b last:border-b-0">
                <td className="py-2 px-3">
                  <Link
                    to={regionPath(r.oblast)}
                    className="font-medium hover:underline"
                  >
                    {regionName(r.oblast)}
                  </Link>
                </td>
                <td className="py-2 px-3">
                  {r.topMayor ? (
                    <PartyChip
                      name={r.topMayor.displayName}
                      color={r.topMayor.color}
                      suffix={t("local_region_mayors_count", {
                        count: r.topMayor.count,
                      })}
                    />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="hidden py-2 px-3 text-right tabular-nums sm:table-cell">
                  {formatThousands(r.totalCouncilSeats)}
                </td>
                <td className="py-2 px-3 text-right tabular-nums">
                  {r.municipalityCount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

const CycleOverview: FC<{ cycle: string }> = ({ cycle }) => {
  const { t } = useTranslation();
  const { data: index } = useLocalElectionIndex(cycle);
  // Município-mayor runoffs only — exclude the 24 Sofia район shards (район
  // mayor balotage isn't a "община с балотаж"); keeps the count consistent
  // with the per-oblast region rollups.
  const runoffCount = useMemo(
    () =>
      index?.municipalities.filter(
        (m) => m.hadRound2 && !/^S2\d{3}$/.test(m.obshtinaCode),
      ).length ?? 0,
    [index],
  );
  // Real município count excludes the 24 replicated Sofia район shards.
  const municipalityCount = useMemo(
    () =>
      index
        ? index.municipalities.filter((m) => !/^S2\d{3}$/.test(m.obshtinaCode))
            .length
        : 0,
    [index],
  );
  const topMayors = useMemo(
    () => (index ? index.mayorsByCanonical.slice(0, 8) : []),
    [index],
  );
  const topMayorLeader = topMayors[0]?.count ?? 0;
  const topCouncil = useMemo(
    () => (index ? index.councilVoteShare.slice(0, 10) : []),
    [index],
  );
  const topCouncilLeader = topCouncil[0]?.totalVotes ?? 0;

  return (
    <main className="container mx-auto px-4 py-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">
          {t("local_election_cycle_stub_title")} · {friendlyCycleDate(cycle)}
        </h1>
        {index ? (
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
            {t("local_cycle_overview_municipalities", {
              count: municipalityCount,
            })}{" "}
            · {t("local_cycle_overview_runoffs", { count: runoffCount })}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-4">
          <Link
            to="/sverka"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            {t("local_cycle_overview_sverka_link")}
          </Link>
          <Link
            to="/local/chmi"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            {t("chmi_feed_title")} →
          </Link>
          {/* Sofia city-wide synthetic shard isn't in the catalogue's
              município list (it's not in data/municipalities.json) — link
              to it explicitly so users can reach the city-wide council +
              mayor + all 24 districts from here. */}
          {index?.municipalities.some((m) => m.obshtinaCode === "SOF") ? (
            <Link
              to={`/local/${cycle}/SOF`}
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              {t("local_cycle_overview_sof_link")}
            </Link>
          ) : null}
        </div>
      </header>

      {/* Stat header */}
      {index ? (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <StatItem
            label={t("local_national_top_mayor_party")}
            value={
              topMayors[0] ? (
                <PartyChip
                  name={topMayors[0].displayName}
                  color={topMayors[0].color}
                  suffix={t("local_region_mayors_count", {
                    count: topMayors[0].count,
                  })}
                />
              ) : (
                "—"
              )
            }
          />
          <StatItem
            label={t("local_national_top_council_party")}
            value={
              topCouncil[0] ? (
                <PartyChip
                  name={topCouncil[0].displayName}
                  color={topCouncil[0].color}
                  suffix={`${topCouncil[0].pctOfValid.toFixed(1)}%`}
                />
              ) : (
                "—"
              )
            }
          />
          <StatItem
            label={t("local_national_municipalities")}
            value={<span className="tabular-nums">{municipalityCount}</span>}
          />
          <StatItem
            label={t("local_national_runoffs")}
            value={<span className="tabular-nums">{runoffCount}</span>}
          />
        </div>
      ) : null}

      {/* Mayors-control choropleth: which party holds each oblast. */}
      <LocalMayorsControlMapTile cycle={cycle} />

      {/* Top regions by município count + controlling party. */}
      <TopRegionsTable cycle={cycle} />

      {topMayors.length > 0 ? (
        <section>
          <h2 className="text-lg font-semibold mb-3">
            {t("local_cycle_overview_mayors_section")}
          </h2>
          <ul className="rounded-xl border bg-card p-3">
            {topMayors.map((p) => (
              <RankedBar
                key={p.canonicalId}
                label={p.displayName}
                value={p.count}
                pct={
                  index
                    ? (p.count /
                        index.mayorsByCanonical.reduce(
                          (a, x) => a + x.count,
                          0,
                        )) *
                      100
                    : 0
                }
                leaderValue={topMayorLeader}
                color={p.color}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {topCouncil.length > 0 ? (
        <section>
          <h2 className="text-lg font-semibold mb-3">
            {t("local_cycle_overview_council_section")}
          </h2>
          <ul className="rounded-xl border bg-card p-3">
            {topCouncil.map((p) => (
              <RankedBar
                key={p.canonicalId}
                label={p.displayName}
                value={p.totalVotes}
                pct={p.pctOfValid}
                leaderValue={topCouncilLeader}
                color={p.color}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {index?.municipalities.length ? (
        <section>
          <h2 className="text-lg font-semibold mb-3">
            {t("local_cycle_overview_municipalities_section")}
          </h2>
          <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1 text-sm">
            {index.municipalities
              .slice()
              .sort((a, b) =>
                // Pin SOF first so the city-wide entry stands out from
                // its 24 район shards.
                a.obshtinaCode === "SOF"
                  ? -1
                  : b.obshtinaCode === "SOF"
                    ? 1
                    : a.name.localeCompare(b.name, "bg"),
              )
              .map((m) => (
                <li key={m.obshtinaCode}>
                  <Link
                    to={`/local/${cycle}/${m.obshtinaCode}`}
                    className={`block py-1 px-2 rounded hover:bg-accent hover:underline ${
                      m.obshtinaCode === "SOF"
                        ? "font-semibold text-primary"
                        : ""
                    }`}
                  >
                    {m.name}
                    {m.obshtinaCode === "SOF" ? (
                      <span className="ml-1 inline-flex items-center rounded-md border border-primary/40 bg-primary/10 px-1 py-0 text-[9px] font-medium uppercase tracking-wide text-primary">
                        {t("local_cycle_overview_sof_badge")}
                      </span>
                    ) : null}
                    {m.hadRound2 ? (
                      <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                        II
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
};

// === Top-level screen ===================================================

export const LocalElectionScreen: FC = () => {
  const { cycle, obshtinaCode } = useParams<{
    cycle: string;
    obshtinaCode?: string;
  }>();
  if (!cycle) return null;
  if (obshtinaCode) {
    return <MunicipalityResults cycle={cycle} obshtinaCode={obshtinaCode} />;
  }
  return <CycleOverview cycle={cycle} />;
};
