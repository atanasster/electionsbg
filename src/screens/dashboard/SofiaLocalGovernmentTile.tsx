// Sofia city-wide local-government tile.
//
// Surfaces the SOF bundle (city-wide mayor R1+R2 + 61-mandate SGS
// council composition) plus a 24-район strip — each район shown with
// the elected район-mayor's party color and a click-through to the
// dedicated /local/<cycle>/<S2XXX> page.
//
// Single-fetch design: useLocalMunicipality("SOF") returns the SOF
// bundle whose `districts[]` carries every район's elected mayor,
// so the 24-район strip costs zero extra HTTP — no per-район fan-out.
// The dedicated per-район pages each have their own S2XXX bundle for
// drill-downs; clicking a chip lazy-loads it.
//
// Mounted under a new local_government section on SofiaDashboardCards.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowRight, Landmark } from "lucide-react";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { useLocalMunicipality } from "@/data/local/useLocalMunicipality";
import { usePriorLocalCycle } from "@/data/local/useLocalCycles";
import { useChmiHistory } from "@/data/local/useChmiHistory";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { SOFIA_RAYONS } from "@/data/budget/sofiaRayons";
import {
  friendlyCycleDate,
  UNRESOLVED_PARTY_COLOR,
} from "@/data/local/cycleDate";
import type { LocalCouncilParty, LocalMayorResult } from "@/data/local/types";
import { StatCard } from "./StatCard";

type Props = { className?: string };

const norm = (s: string): string =>
  s.trim().toLocaleLowerCase("bg").replace(/\s+/g, " ");

export const SofiaLocalGovernmentTile: FC<Props> = ({ className }) => {
  const { t, i18n } = useTranslation();
  const { municipality, cycle } = useLocalMunicipality("SOF");
  const priorCycle = usePriorLocalCycle(cycle);
  const { municipality: prior } = useLocalMunicipality("SOF", priorCycle);
  const { byId: canonicalById } = useCanonicalParties();
  const chmiEvents = useChmiHistory("SOF");

  // Top 5 SGS council parties with Δ seats vs prior cycle. Same match
  // strategy as Phase 1 município tile.
  const topCouncil = useMemo(() => {
    if (!municipality?.council) return [];
    const findPrior = (p: LocalCouncilParty): LocalCouncilParty | undefined => {
      if (!prior?.council) return undefined;
      if (p.primaryCanonicalId) {
        const m = prior.council.find(
          (q) => q.primaryCanonicalId === p.primaryCanonicalId,
        );
        if (m) return m;
      }
      return prior.council.find(
        (q) => norm(q.localPartyName) === norm(p.localPartyName),
      );
    };
    return [...municipality.council]
      .filter((p) => p.mandatesWon > 0)
      .sort((a, b) => b.mandatesWon - a.mandatesWon)
      .slice(0, 5)
      .map((p) => {
        const canonical = p.primaryCanonicalId
          ? canonicalById.get(p.primaryCanonicalId)
          : undefined;
        const priorMatch = findPrior(p);
        return {
          ...p,
          color: canonical?.color ?? UNRESOLVED_PARTY_COLOR,
          displayName: canonical?.displayName ?? p.localPartyName,
          delta: priorMatch
            ? p.mandatesWon - priorMatch.mandatesWon
            : undefined,
        };
      });
  }, [municipality, prior, canonicalById]);

  const totalSeats = useMemo(
    () => municipality?.council.reduce((acc, p) => acc + p.mandatesWon, 0) ?? 0,
    [municipality],
  );

  // 24-район strip. For each canonical район row (sourced from
  // SOFIA_RAYONS so the order is stable), find the matching district in
  // SOF.districts and resolve the elected mayor + party color.
  const rayonRows = useMemo(() => {
    if (!municipality?.districts) return [];
    const byName = new Map<string, (typeof municipality.districts)[number]>();
    for (const d of municipality.districts) {
      byName.set(norm(d.districtName), d);
    }
    return SOFIA_RAYONS.map((r) => {
      const d = byName.get(norm(r.labelBg));
      // Prefer the round-2-resolved winner — both runoff finalists carry
      // isElected in round 1, so the raw find can return the loser.
      const elected: LocalMayorResult | undefined =
        d?.elected ?? d?.candidates.find((c) => c.isElected) ?? undefined;
      const canonical = elected?.primaryCanonicalId
        ? canonicalById.get(elected.primaryCanonicalId)
        : undefined;
      return {
        code: r.obshtinaCode,
        label: i18n.language === "bg" ? r.labelBg : r.labelEn,
        mayorName: elected?.candidateName ?? null,
        partyName: canonical?.displayName ?? elected?.localPartyName ?? "",
        color: canonical?.color ?? UNRESOLVED_PARTY_COLOR,
      };
    });
  }, [municipality, canonicalById, i18n.language]);

  if (!municipality) return null;
  const mayor = municipality.mayor.elected;
  const cycleDate = friendlyCycleDate(cycle);

  return (
    <StatCard
      className={className}
      label={
        <div className="flex items-center justify-between w-full gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Landmark className="h-4 w-4 shrink-0" />
            <span className="truncate">
              {t("sofia_local_gov_title")} · {cycleDate}
            </span>
          </div>
          <Link
            to={`/local/${cycle}/SOF`}
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline normal-case shrink-0"
          >
            {t("local_election_view_details")}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      }
    >
      {/* City mayor row */}
      {mayor ? (
        <div className="mt-1 flex items-start gap-2">
          <MpAvatar
            name={mayor.candidateName}
            mpId={mayor.mpId}
            showPartyRing={false}
          />
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {t("sofia_local_gov_city_mayor_label")}
            </div>
            <div className="text-sm font-semibold leading-tight">
              {mayor.candidateName}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground truncate">
              {mayor.isIndependent
                ? t("local_election_independent")
                : mayor.localPartyName}
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

      {/* SGS council composition with Δ seats */}
      {topCouncil.length > 0 ? (
        <div className="mt-3 pt-2 border-t">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("sofia_local_gov_sgs_label", { count: totalSeats })}
          </div>
          <ul className="mt-1.5 flex flex-col gap-1">
            {topCouncil.map((p) => (
              <li
                key={p.localPartyNum}
                className="flex items-center gap-2 text-[12px]"
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
                  style={{ backgroundColor: p.color }}
                  aria-hidden
                />
                <span className="truncate flex-1" title={p.displayName}>
                  {p.displayName}
                </span>
                <span className="tabular-nums font-semibold">
                  {p.mandatesWon}
                </span>
                {p.delta !== undefined && p.delta !== 0 ? (
                  <span
                    className={
                      p.delta > 0
                        ? "text-emerald-600 font-medium tabular-nums"
                        : "text-rose-600 font-medium tabular-nums"
                    }
                  >
                    {p.delta > 0 ? `↑+${p.delta}` : `↓${p.delta}`}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* 24 districts strip */}
      {rayonRows.length > 0 ? (
        <div className="mt-3 pt-2 border-t">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("sofia_local_gov_rayons_label", { count: rayonRows.length })}
          </div>
          <ul className="mt-1.5 grid grid-cols-2 sm:grid-cols-3 gap-1">
            {rayonRows.map((r) => (
              <li key={r.code}>
                <Link
                  to={`/local/${cycle}/${r.code}`}
                  className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] hover:bg-muted/50 transition"
                  title={r.mayorName ? `${r.label} · ${r.mayorName}` : r.label}
                  aria-label={
                    r.mayorName ? `${r.label} — ${r.mayorName}` : r.label
                  }
                >
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
                    style={{ backgroundColor: r.color }}
                    aria-hidden
                  />
                  <span className="truncate flex-1">{r.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* chmi pin */}
      {chmiEvents.length > 0 ? (
        <div className="mt-3 pt-2 border-t text-[11px] text-muted-foreground">
          <span className="inline-flex items-center rounded-md border border-blue-500/40 bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-700 mr-1.5">
            {t("local_election_chmi_section")}
          </span>
          <span>
            {t("local_election_chmi_count", { count: chmiEvents.length })}
          </span>
        </div>
      ) : null}
    </StatCard>
  );
};
