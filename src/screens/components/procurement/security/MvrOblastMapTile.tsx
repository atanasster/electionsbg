// "МВР по области — € на глава" — the regionally-attributable МВР spend per
// resident, the Vera-flagship per-capita metric (plan §7 tile 7 / §7b.D). Only the
// units whose seat IS an oblast are mapped — the 28 ОДМВР (police) and the РДПБЗН
// (fire), plus Sofia-city СДВР/СДПБЗН; the national buyers (ministry, ГД Гранична
// полиция, ДУССД, Медицински институт …) are booked centrally and are NOT regional,
// so they are deliberately off the map (named in the footnote). Reuses the shared
// OblastChoropleth + fetchPopulation — no new fetch (aggregates the pack's `units`),
// so the map reacts to the universe segment (police → ОДМВР, fire → РДПБЗН, …).

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { MapPinned, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur, formatEurCompact } from "@/lib/currency";
import { fetchPopulation } from "@/data/procurement/useProcurementByOblast";
import { OblastChoropleth } from "@/screens/components/procurement/OblastChoropleth";
import type { MvrUnitAgg } from "@/data/procurement/useMvr";
import { unitOblastCanon } from "./securityOblast";

type Metric = "perCapita" | "total";

// A police slate sequential ramp (light → dark), distinct from the procurement
// teal / culture violet. Lowest bucket is a pale slate — NOT hsl(var(--muted)),
// which OblastChoropleth reserves for no-data oblasts.
const SECURITY_RAMP = [
  "hsl(222 24% 92%)",
  "hsl(222 26% 82%)",
  "hsl(222 28% 70%)",
  "hsl(222 30% 58%)",
  "hsl(222 32% 46%)",
  "hsl(222 34% 36%)",
] as const;

export const MvrOblastMapTile: FC<{
  units: MvrUnitAgg[];
  /** Human label for the active scope's year span (e.g. "2026" / "2011–2026"),
   *  so a sparse partial-period map reads as scoped, not broken. */
  periodLabel?: string | null;
}> = ({ units, periodLabel }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const { data: population } = useQuery({
    queryKey: ["population"] as const,
    queryFn: fetchPopulation,
    staleTime: Infinity,
  });
  const [metric, setMetric] = useState<Metric>("perCapita");
  const [active, setActive] = useState<string | null>(null);

  // Population per canon, with Sofia-city (SOFIA_CITY) taken as the MAX of its three
  // МИР shards — the population series keys Sofia city as S23/S24/S25 each holding
  // the FULL city population (duplicates, not thirds), so summing triples it and the
  // per-capita comes out 3× too low. Mirrors useProcurementByOblast.ts.
  const pop = useMemo(() => {
    if (!population) return null;
    const m: Record<string, number> = { ...population };
    const sofia = Math.max(
      population.S23 ?? 0,
      population.S24 ?? 0,
      population.S25 ?? 0,
    );
    if (sofia > 0) m.SOFIA_CITY = sofia;
    return m;
  }, [population]);

  // Aggregate the regionally-attributable units to their oblast canon.
  const rows = useMemo(() => {
    const byCanon = new Map<
      string,
      { canon: string; name: string; totalEur: number; unitN: number }
    >();
    for (const u of units) {
      const canon = unitOblastCanon(u.name);
      if (!canon) continue; // national unit — not regional
      const cur = byCanon.get(canon) ?? {
        canon,
        name: canon,
        totalEur: 0,
        unitN: 0,
      };
      cur.totalEur += u.totalEur;
      cur.unitN += 1;
      byCanon.set(canon, cur);
    }
    return [...byCanon.values()].map((r) => {
      const p = pop ? pop[r.canon] : undefined;
      return {
        ...r,
        pop: p,
        perCapita: p && p > 0 ? r.totalEur / p : undefined,
      };
    });
  }, [units, pop]);

  const values = useMemo(() => {
    const m = new Map<string, number | undefined>();
    for (const r of rows)
      m.set(r.canon, metric === "total" ? r.totalEur : r.perCapita);
    return m;
  }, [rows, metric]);

  // Oblast display names — reuse the region-map's own labels via the population
  // fetch's sibling; but the canon is enough as a fallback. We keep the ОДМВР's
  // trailing token where possible for a friendly label.
  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of units) {
      const canon = unitOblastCanon(u.name);
      if (!canon || m.has(canon)) continue;
      const token = /Столична/.test(u.name)
        ? bg
          ? "София (столица)"
          : "Sofia city"
        : (u.name.match(/—\s*(.+?)\s*$/)?.[1] ?? canon);
      m.set(canon, token);
    }
    return m;
  }, [units, bg]);

  const natMean = useMemo(() => {
    const totEur = rows.reduce((s, r) => s + r.totalEur, 0);
    const totPop = rows.reduce((s, r) => s + (r.pop ?? 0), 0);
    return totPop > 0 ? totEur / totPop : undefined;
  }, [rows]);

  if (rows.length === 0) return null;

  // Regional per-capita spend is small — cents in a partial window, a few € over
  // all history. Rounding to whole euros (formatEur's default) shows "€0" for most
  // oblasts; show decimals for small values so they stay legible.
  const fmtPerCapita = (v: number): string => {
    const d = v >= 10 ? 0 : v >= 1 ? 1 : 2;
    return `${formatEur(v, lang, { decimals: d })}${bg ? "/жит." : "/cap"}`;
  };
  const fmtVal = (v: number | undefined): string => {
    if (v == null) return "—";
    return metric === "total" ? formatEurCompact(v, lang) : fmtPerCapita(v);
  };

  const ranked = [...rows].sort((a, b) =>
    metric === "total"
      ? b.totalEur - a.totalEur
      : (b.perCapita ?? 0) - (a.perCapita ?? 0),
  );
  const maxRank =
    metric === "total"
      ? Math.max(1, ...ranked.map((r) => r.totalEur))
      : Math.max(1, ...ranked.map((r) => r.perCapita ?? 0));

  const pill = (m: Metric, label: string) => (
    <button
      type="button"
      onClick={() => setMetric(m)}
      aria-pressed={metric === m}
      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
        metric === m
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-background text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );

  return (
    <Card id="by-oblast">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <MapPinned className="h-4 w-4" />
            {bg ? "МВР по области" : "МВР across Bulgaria"}
            {periodLabel && (
              <span className="text-xs font-normal text-muted-foreground">
                · {periodLabel}
              </span>
            )}
            {active ? (
              <button
                type="button"
                onClick={() => setActive(null)}
                className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
              >
                {names.get(active) ?? active}
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </CardTitle>
          <div
            role="group"
            aria-label={bg ? "Показател" : "Metric"}
            className="flex gap-1.5"
          >
            {pill("perCapita", bg ? "На жител" : "Per resident")}
            {pill("total", bg ? "Общо" : "Total")}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <OblastChoropleth
            values={values}
            names={names}
            ramp={SECURITY_RAMP}
            formatValue={fmtVal}
            tooltipExtra={(canon) => {
              const r = rows.find((x) => x.canon === canon);
              if (!r) return null;
              return metric === "total"
                ? r.perCapita != null
                  ? `${formatEur(r.perCapita, lang)}${bg ? "/жит." : "/cap"}`
                  : null
                : formatEurCompact(r.totalEur, lang);
            }}
            activeCanon={active}
            onSelectOblast={(canon) =>
              setActive((cur) => (cur === canon ? null : canon))
            }
            ariaLabel={
              bg
                ? "Обществени поръчки на МВР по област"
                : "МВР procurement by oblast"
            }
          />
          <div>
            <ul className="space-y-1.5">
              {ranked.map((r) => {
                const val =
                  metric === "total" ? r.totalEur : (r.perCapita ?? 0);
                const isActive = active === r.canon;
                return (
                  <li key={r.canon}>
                    <button
                      type="button"
                      onClick={() =>
                        setActive((cur) => (cur === r.canon ? null : r.canon))
                      }
                      className={`flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-sm transition-colors hover:bg-accent/40 ${
                        isActive ? "bg-accent/50" : ""
                      }`}
                    >
                      <span className="w-24 shrink-0 truncate">
                        {names.get(r.canon) ?? r.canon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block h-1.5 w-full rounded-full bg-muted">
                          <span
                            className="block h-1.5 rounded-full bg-primary"
                            style={{ width: `${(val / maxRank) * 100}%` }}
                          />
                        </span>
                      </span>
                      <span className="w-20 shrink-0 text-right tabular-nums text-muted-foreground">
                        {fmtVal(val)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {metric === "perCapita" && natMean != null && (
              <p className="mt-2 text-xs text-muted-foreground">
                {bg
                  ? `Средно за картираните области: ${fmtPerCapita(natMean)}`
                  : `Mapped-oblast average: ${fmtPerCapita(natMean)}`}
              </p>
            )}
          </div>
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground/80">
          {periodLabel &&
            (bg
              ? `Данните са за избрания период (${periodLabel}) — затова малко области имат договори; за пълната регионална картина изберете „Всички години“. `
              : `Data covers the selected period (${periodLabel}) — hence few oblasts have contracts; pick "All years" for the full regional picture. `)}
          {bg
            ? "Картирани са само структурите със седалище в областта — областните дирекции (ОДМВР) и районните пожарни (РДПБЗН), плюс СДВР/СДПБЗН за столицата. Националните възложители (централа, Гранична полиция, ДУССД, Медицински институт) се водят централно и не са на картата. Население: НСИ (regional.json). Поръчки: АОП/ЦАИС ЕОП."
            : "Only units seated in an oblast are mapped — the regional police directorates (ОДМВР) and fire directorates (РДПБЗН), plus СДВР/СДПБЗН for the capital. National buyers (HQ, Border Police, ДУССД, Medical Institute) are booked centrally and are off the map. Population: НСИ (regional.json). Procurement: АОП/ЦАИС ЕОП."}
        </p>
      </CardContent>
    </Card>
  );
};
