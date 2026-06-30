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
import { ArrowRight, Crown, Landmark, TrendingUp } from "lucide-react";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { useLocalSettlement } from "@/data/local/useLocalSettlement";
import { useLocalPlaceTrend } from "@/data/local/useLocalPlaceTrends";
import { LocalPlaceTrendsTile } from "./LocalPlaceTrendsTile";
import { useChmiHistory } from "@/data/local/useChmiHistory";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { formatThousands } from "@/data/utils";
import { titleCaseName } from "@/lib/utils";
import type {
  LocalKmetstvoResult,
  LocalMunicipalityBundle,
} from "@/data/local/types";
import { StatCard } from "../StatCard";
import { DashboardSection } from "../DashboardSection";
import { PartyChip } from "@/screens/components/local/LocalRankedBar";

const normalize = (s: string): string =>
  s.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();

// Village-mayor (kметство) candidate ranking.
const KmetstvoMayorCard: FC<{ kmetstvo: LocalKmetstvoResult }> = ({
  kmetstvo,
}) => {
  const { t } = useTranslation();
  const { colorFor } = useCanonicalParties();
  const sorted = useMemo(
    () =>
      // When the seat went to a runoff, show the round-2 (final) table — its
      // single elected row is the real winner. Round 1 marks both finalists
      // elected, which would bold two candidates with misleading round-1 votes.
      [
        ...(kmetstvo.round2?.length ? kmetstvo.round2 : kmetstvo.candidates),
      ].sort((a, b) => b.votes - a.votes),
    [kmetstvo],
  );
  return (
    <StatCard
      label={
        <div className="flex items-center gap-2">
          <Crown className="h-4 w-4" />
          <span>{t("local_settlement_kmetstvo_mayor")}</span>
        </div>
      }
    >
      <div className="mt-1 flex flex-col divide-y">
        {sorted.map((c) => {
          const color = c.primaryCanonicalId
            ? colorFor(c.primaryCanonicalId)
            : undefined;
          return (
            <div
              key={`${c.localPartyNum}-${c.candidateName}`}
              className={`flex items-center gap-2 py-2 ${c.isElected ? "font-medium" : ""}`}
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
              {c.isElected ? (
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
  const { colorFor } = useCanonicalParties();

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
        {kmetstvo ? (
          <KmetstvoMayorCard kmetstvo={kmetstvo} />
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

      {kmetstvoEvents.length > 0 ? (
        <DashboardSection
          id="local-history"
          title={t("local_election_chmi_section")}
        >
          <StatCard label={t("local_election_chmi_section")}>
            <ul className="mt-1 flex flex-col divide-y">
              {kmetstvoEvents.map((e, i) => {
                const color = e.primaryCanonicalId
                  ? colorFor(e.primaryCanonicalId)
                  : undefined;
                return (
                  <li
                    key={`${e.cycle}-${i}`}
                    className="flex items-center gap-2 py-2 text-sm"
                  >
                    <span className="text-xs text-muted-foreground tabular-nums w-20 shrink-0">
                      {e.date}
                    </span>
                    <MpAvatar
                      name={e.candidateName}
                      mpId={e.mpId}
                      showPartyRing={false}
                    />
                    <span className="font-medium truncate">
                      {titleCaseName(e.candidateName)}
                    </span>
                    <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
                      {color ? (
                        <span
                          aria-hidden
                          className="inline-block size-2 rounded-full ring-1 ring-border shrink-0"
                          style={{ backgroundColor: color }}
                        />
                      ) : null}
                      <span className="truncate">{e.localPartyName}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </StatCard>
        </DashboardSection>
      ) : null}
    </div>
  );
};
