// Local-election tile — shows the most recent município mayor and the
// council seat split for the latest local cycle.
//
// Appears unconditionally on every município dashboard regardless of which
// election the user has selected in the header (per the design decision:
// users landing on a município page usually want to know who actually
// governs it, not who's selected upstream).
//
// Reads from data/<latestLocalCycle>/municipalities/<obshtinaCode>.json
// via useLocalMunicipality. The cycle is hardcoded to mi2023 in step 1;
// step 3 will pick from a discovered list of cycles.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowRight, Landmark } from "lucide-react";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { useLocalMunicipality } from "@/data/local/useLocalMunicipality";
import { usePriorLocalCycle } from "@/data/local/useLocalCycles";
import { useChmiHistory } from "@/data/local/useChmiHistory";
import { StatCard } from "./StatCard";

type Props = {
  obshtinaCode: string;
  className?: string;
};

// "2023_10_29_mi" → "29.10.2023"
const friendlyCycleDate = (cycle: string): string => {
  const m = cycle.match(/^(\d{4})_(\d{2})_(\d{2})/);
  if (!m) return cycle;
  return `${m[3]}.${m[2]}.${m[1]}`;
};

export const MunicipalElectionTile: FC<Props> = ({
  obshtinaCode,
  className,
}) => {
  const { t } = useTranslation();
  const { municipality, cycle } = useLocalMunicipality(obshtinaCode);
  // Cross-cycle comparison: load the same município from the prior local
  // cycle (mi2019 for the mi2023 default) so we can show "Преди това: X
  // (Y)" beneath the current mayor and flag canonical-party flips.
  const priorCycle = usePriorLocalCycle(cycle);
  const { municipality: priorBundle } = useLocalMunicipality(
    obshtinaCode,
    priorCycle,
  );
  // Extraordinary elections (chmi/nov) that touched this município
  // between the regular cycles. Per the design choice, partials never
  // appear in the elections selector — they surface contextually here.
  const chmiEvents = useChmiHistory(obshtinaCode);

  const topCouncilParties = useMemo(() => {
    if (!municipality?.council) return [];
    return [...municipality.council]
      .filter((p) => p.mandatesWon > 0)
      .sort((a, b) => b.mandatesWon - a.mandatesWon)
      .slice(0, 3);
  }, [municipality]);

  const totalSeats = useMemo(
    () => municipality?.council.reduce((acc, p) => acc + p.mandatesWon, 0) ?? 0,
    [municipality],
  );

  const mayor = municipality?.mayor.elected;
  const priorMayor = priorBundle?.mayor.elected ?? null;
  // A "flip" is a change in the political affiliation between cycles.
  // Tiered comparison:
  //   1. If both have a canonical primary party id → flip when they differ.
  //   2. Else, if one is independent / Инициативен комитет and the other
  //      isn't → flip.
  //   3. Else, compare normalised local_party_name strings — only flag a
  //      flip when both have the same canonical id OR when neither has one
  //      and the names diverge meaningfully (avoid spurious "flips" on
  //      coalition rebrands like "Местна коалиция ГЕРБ /СДС/" ↔ "ПП ГЕРБ").
  const partyFlipped = useMemo(() => {
    if (!mayor || !priorMayor) return false;
    const curIndep = mayor.isIndependent;
    const prevIndep = priorMayor.isIndependent;
    if (curIndep !== prevIndep) return true;
    if (mayor.primaryCanonicalId && priorMayor.primaryCanonicalId) {
      return mayor.primaryCanonicalId !== priorMayor.primaryCanonicalId;
    }
    // Both unresolved canonicals — fall back to a normalised
    // local-party-name comparison. We can only be confident this is a flip
    // if neither side mentions the other's party string.
    const curName = mayor.localPartyName.toLocaleLowerCase("bg");
    const prevName = priorMayor.localPartyName.toLocaleLowerCase("bg");
    if (curName === prevName) return false;
    // Conservative: treat as "unknown" rather than guessing — return false.
    return false;
  }, [mayor, priorMayor]);
  const cycleDate = friendlyCycleDate(cycle);
  const priorCycleDate = priorCycle ? friendlyCycleDate(priorCycle) : "";

  return (
    <StatCard
      className={className}
      label={
        <div className="flex items-center justify-between w-full gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Landmark className="h-4 w-4 shrink-0" />
            <span className="truncate">
              {t("local_election_card_title")} · {cycleDate}
            </span>
          </div>
          {municipality ? (
            <Link
              to={`/local/${cycle}/${obshtinaCode}`}
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline normal-case shrink-0"
            >
              {t("local_election_view_details")}
              <ArrowRight className="h-3 w-3" />
            </Link>
          ) : null}
        </div>
      }
    >
      {!municipality ? (
        <div className="mt-1 text-sm text-muted-foreground">
          {t("local_election_no_data")}
        </div>
      ) : (
        <>
          {/* Mayor row */}
          {mayor ? (
            <div className="mt-1 flex items-start gap-2">
              <MpAvatar
                name={mayor.candidateName}
                mpId={mayor.mpId}
                showPartyRing={false}
              />
              <div className="min-w-0">
                <div className="text-sm font-semibold leading-tight">
                  {mayor.candidateName}
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  <span className="truncate">
                    {mayor.isIndependent
                      ? t("local_election_independent")
                      : mayor.localPartyName}
                  </span>
                  <span className="mx-1.5">·</span>
                  <span className="tabular-nums">
                    {t("local_election_elected_round", {
                      round:
                        mayor.round === 2
                          ? t("local_election_round_2")
                          : t("local_election_round_1"),
                    })}{" "}
                    · {mayor.pctOfValid.toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>
          ) : null}

          {/* Prior-cycle line — shown when we have data for the same
              município in the previous local cycle. Surfaces party flips
              with a small pill. */}
          {priorMayor ? (
            <div className="mt-2 text-[11px] text-muted-foreground">
              <span className="uppercase tracking-wide">
                {t("local_election_prior_mandate")}
              </span>{" "}
              <span className="tabular-nums">({priorCycleDate})</span>:{" "}
              <span className="font-medium text-foreground">
                {priorMayor.candidateName}
              </span>
              <span className="mx-1">·</span>
              <span title={priorMayor.localPartyName}>
                {priorMayor.isIndependent
                  ? t("local_election_independent")
                  : priorMayor.localPartyName.length > 30
                    ? `${priorMayor.localPartyName.slice(0, 30)}…`
                    : priorMayor.localPartyName}
              </span>
              {partyFlipped ? (
                <span className="ml-1.5 inline-flex items-center rounded-md border border-amber-500/40 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700">
                  {t("local_election_party_flipped")}
                </span>
              ) : null}
            </div>
          ) : null}

          {/* Extraordinary elections (chmi) — surface here since they
              don't appear in the elections selector. */}
          {chmiEvents.length > 0 ? (
            <div className="mt-2 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center rounded-md border border-blue-500/40 bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-700 mr-1.5">
                {t("local_election_chmi_section")}
              </span>
              <span>
                {t("local_election_chmi_count", {
                  count: chmiEvents.length,
                })}
              </span>
            </div>
          ) : null}

          {/* Council seat split — top 3 parties */}
          {topCouncilParties.length > 0 ? (
            <div className="mt-3 pt-2 border-t">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {t("local_election_council_label")} ·{" "}
                {t("local_election_council_seats", { count: totalSeats })}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {topCouncilParties.map((p) => (
                  <span
                    key={p.localPartyNum}
                    className="inline-flex items-center gap-1 rounded-md border bg-card px-1.5 py-0.5 text-[11px] tabular-nums"
                    title={p.localPartyName}
                  >
                    <span className="truncate max-w-[140px]">
                      {p.localPartyName}
                    </span>
                    <span className="font-semibold">{p.mandatesWon}</span>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </StatCard>
  );
};
