// Region (oblast / MIR) Local-control tile.
//
// Rolls up the per-município local-elections bundles for every município
// in the region:
//   - Mayors won by canonical party (this region's slice of the country
//     mayor distribution).
//   - Council seats by canonical party (sum of mandatesWon across all
//     municípios in the region).
//   - Per-município mini-list with mayor party-color swatch + a swing
//     arrow showing how the leading council party's seats changed vs the
//     prior cycle.
//
// Mounts under a new "local_government" section on RegionDashboardCards.
// Data is fanned out through useLocalMunicipalitiesByRegion which shares
// queryKeys with useLocalMunicipality, so a user who already viewed (or
// later views) any município in this region reads from the React-Query
// cache.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowRight, Landmark } from "lucide-react";
import { useLocalMunicipalitiesByRegion } from "@/data/local/useLocalMunicipalitiesByRegion";
import { useLatestLocalCycle } from "@/data/local/useLatestLocalCycle";
import { usePriorLocalCycle } from "@/data/local/useLocalCycles";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import {
  friendlyCycleDate,
  UNRESOLVED_PARTY_COLOR,
} from "@/data/local/cycleDate";
import type { LocalCouncilParty, LocalMayorResult } from "@/data/local/types";
import { StatCard } from "./StatCard";

type Props = {
  regionCode: string;
  className?: string;
};

const groupKey = (mayor: LocalMayorResult): string =>
  mayor.primaryCanonicalId ??
  (mayor.isIndependent
    ? "__indep__"
    : `__name__:${mayor.localPartyName.toLocaleLowerCase("bg")}`);

const councilGroupKey = (p: LocalCouncilParty): string =>
  p.primaryCanonicalId ??
  (p.isIndependent
    ? "__indep__"
    : `__name__:${p.localPartyName.toLocaleLowerCase("bg")}`);

export const RegionLocalControlTile: FC<Props> = ({
  regionCode,
  className,
}) => {
  const { t } = useTranslation();
  const cycle = useLatestLocalCycle();
  const priorCycle = usePriorLocalCycle(cycle);
  const { rows, isLoading } = useLocalMunicipalitiesByRegion(
    regionCode,
    priorCycle,
  );
  const { byId: canonicalById } = useCanonicalParties();
  const { findMunicipality } = useMunicipalities();

  const { topMayors, topCouncil, totalMayors, totalSeats } = useMemo(() => {
    const mayorAgg = new Map<
      string,
      {
        displayName: string;
        color: string;
        count: number;
        canonicalId: string | null;
      }
    >();
    const seatAgg = new Map<
      string,
      {
        displayName: string;
        color: string;
        seats: number;
        canonicalId: string | null;
      }
    >();

    for (const r of rows) {
      const bundle = r.bundle;
      if (!bundle) continue;
      const mayor = bundle.mayor.elected;
      if (mayor) {
        const key = groupKey(mayor);
        const canonical = mayor.primaryCanonicalId
          ? canonicalById.get(mayor.primaryCanonicalId)
          : undefined;
        const existing = mayorAgg.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          mayorAgg.set(key, {
            displayName: canonical?.displayName ?? mayor.localPartyName,
            color: canonical?.color ?? UNRESOLVED_PARTY_COLOR,
            canonicalId: mayor.primaryCanonicalId ?? null,
            count: 1,
          });
        }
      }
      for (const p of bundle.council) {
        if (p.mandatesWon <= 0) continue;
        const key = councilGroupKey(p);
        const canonical = p.primaryCanonicalId
          ? canonicalById.get(p.primaryCanonicalId)
          : undefined;
        const existing = seatAgg.get(key);
        if (existing) {
          existing.seats += p.mandatesWon;
        } else {
          seatAgg.set(key, {
            displayName: canonical?.displayName ?? p.localPartyName,
            color: canonical?.color ?? UNRESOLVED_PARTY_COLOR,
            canonicalId: p.primaryCanonicalId ?? null,
            seats: p.mandatesWon,
          });
        }
      }
    }

    const mayorList = [...mayorAgg.values()].sort((a, b) => b.count - a.count);
    const seatList = [...seatAgg.values()].sort((a, b) => b.seats - a.seats);
    const totalM = mayorList.reduce((acc, m) => acc + m.count, 0);
    const totalS = seatList.reduce((acc, s) => acc + s.seats, 0);
    return {
      topMayors: mayorList.slice(0, 5),
      topCouncil: seatList.slice(0, 5),
      totalMayors: totalM,
      totalSeats: totalS,
    };
  }, [rows, canonicalById]);

  // Per-município mini-list rows with a "leading council party Δ vs prior
  // cycle" swing arrow. Sorted by current-cycle total seats desc so the
  // biggest municípios surface first.
  const muniRows = useMemo(() => {
    return rows
      .filter((r) => r.bundle)
      .map((r) => {
        const bundle = r.bundle!;
        const mayor = bundle.mayor.elected;
        const leader = [...bundle.council]
          .filter((p) => p.mandatesWon > 0)
          .sort((a, b) => b.mandatesWon - a.mandatesWon)[0];
        // Aggregate delta is only shown when BOTH sides resolve to the
        // same primary canonical id — local-party name fallbacks
        // produce spurious "↑+N / ↓-N" arrows on coalition rebrands
        // ("Местна коалиция ГЕРБ /СДС/" ↔ "ПП ГЕРБ") at oblast scale.
        // Phase 1's município tile already takes this conservative
        // stance; mirror it here.
        let leaderDelta: number | undefined;
        if (leader?.primaryCanonicalId && r.priorBundle?.council) {
          const priorMatch = r.priorBundle.council.find(
            (p) => p.primaryCanonicalId === leader.primaryCanonicalId,
          );
          if (priorMatch)
            leaderDelta = leader.mandatesWon - priorMatch.mandatesWon;
        }
        const mayorCanonical = mayor?.primaryCanonicalId
          ? canonicalById.get(mayor.primaryCanonicalId)
          : undefined;
        const totalCouncilSeats = bundle.council.reduce(
          (acc, p) => acc + p.mandatesWon,
          0,
        );
        return {
          obshtinaCode: bundle.obshtinaCode,
          obshtinaName: bundle.obshtinaName,
          mayorName: mayor?.candidateName ?? null,
          mayorColor: mayorCanonical?.color ?? UNRESOLVED_PARTY_COLOR,
          leaderName: leader
            ? leader.primaryCanonicalId
              ? (canonicalById.get(leader.primaryCanonicalId)?.displayName ??
                leader.localPartyName)
              : leader.localPartyName
            : null,
          leaderSeats: leader?.mandatesWon ?? 0,
          leaderDelta,
          totalCouncilSeats,
        };
      })
      .sort((a, b) => b.totalCouncilSeats - a.totalCouncilSeats);
  }, [rows, canonicalById]);

  if (isLoading) {
    return (
      <StatCard
        className={className}
        label={
          <div className="flex items-center gap-2">
            <Landmark className="h-4 w-4" />
            <span>{t("region_local_control_title")}</span>
          </div>
        }
      >
        <div className="mt-1 h-24 animate-pulse rounded bg-muted/40" />
      </StatCard>
    );
  }

  // Empty fallback — Sofia MIRs (parliamentary 23/24/25) and other
  // regions where useMunicipalitiesByRegion returns no rows that have a
  // local-elections bundle. We only need at least one rendered muni
  // row; totalMayors can be 0 when the prior cycle was a partial that
  // didn't elect a mayor — keep the council half visible in that case.
  if (muniRows.length === 0) return null;

  const cycleDate = friendlyCycleDate(cycle);
  // Resolve human muni names for tooltips on the rare case where the
  // bundle's obshtinaName is missing/abbreviated; falls back to the bundle name.
  const muniDisplay = (code: string, fallback: string): string => {
    return findMunicipality(code)?.name ?? fallback;
  };

  return (
    <StatCard
      className={className}
      label={
        <div className="flex items-center justify-between w-full gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Landmark className="h-4 w-4 shrink-0" />
            <span className="truncate">
              {t("region_local_control_title")} · {cycleDate}
            </span>
          </div>
          <Link
            to={`/local/${cycle}/region/${regionCode}`}
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline normal-case shrink-0"
          >
            {t("local_election_view_details")}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      }
    >
      <div className="mt-1 grid grid-cols-1 md:grid-cols-2 gap-3">
        {topMayors.length > 0 ? (
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {t("region_local_control_mayors_label", { count: totalMayors })}
            </div>
            <ul className="mt-1.5 flex flex-col gap-1">
              {topMayors.map((m, i) => (
                <li
                  key={m.canonicalId ?? `m-${i}`}
                  className="flex items-center gap-2 text-[12px]"
                >
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
                    style={{ backgroundColor: m.color }}
                    aria-hidden
                  />
                  <span className="truncate flex-1" title={m.displayName}>
                    {m.displayName}
                  </span>
                  <span className="tabular-nums font-semibold">{m.count}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {topCouncil.length > 0 ? (
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {t("region_local_control_seats_label", { count: totalSeats })}
            </div>
            <ul className="mt-1.5 flex flex-col gap-1">
              {topCouncil.map((p, i) => (
                <li
                  key={p.canonicalId ?? `s-${i}`}
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
                  <span className="tabular-nums font-semibold">{p.seats}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {/* Per-município list — leading council party + swing arrow. Caps
          at 12 rows on mobile to keep the tile scrollable; full
          breakdowns live on /local/<cycle>/<muni>. */}
      <div className="mt-3 pt-2 border-t">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {t("region_local_control_munis_label", { count: muniRows.length })}
        </div>
        <ul className="mt-1.5 flex flex-col gap-1 max-h-72 overflow-y-auto">
          {muniRows.map((r) => (
            <li key={r.obshtinaCode} className="text-[12px]">
              <Link
                to={`/local/${cycle}/${r.obshtinaCode}`}
                className="flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-muted/50 transition"
                aria-label={
                  r.mayorName
                    ? `${muniDisplay(r.obshtinaCode, r.obshtinaName)} — ${r.mayorName}`
                    : muniDisplay(r.obshtinaCode, r.obshtinaName)
                }
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
                  style={{ backgroundColor: r.mayorColor }}
                  aria-hidden
                  title={r.mayorName ?? ""}
                />
                <span className="truncate flex-1 font-medium text-foreground">
                  {muniDisplay(r.obshtinaCode, r.obshtinaName)}
                </span>
                {r.leaderName ? (
                  <span
                    className="truncate max-w-[140px] text-muted-foreground"
                    title={r.leaderName}
                  >
                    {r.leaderName} · {r.leaderSeats}
                  </span>
                ) : null}
                {r.leaderDelta !== undefined && r.leaderDelta !== 0 ? (
                  <span
                    className={
                      r.leaderDelta > 0
                        ? "text-emerald-600 font-medium tabular-nums"
                        : "text-rose-600 font-medium tabular-nums"
                    }
                  >
                    {r.leaderDelta > 0
                      ? `↑+${r.leaderDelta}`
                      : `↓${r.leaderDelta}`}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </StatCard>
  );
};
