// Културата по области — where Bulgaria's state cultural institutes sit, and how
// much public procurement they run per resident. Reliable geography (the
// institutes are awarders with EIKs — unlike the film producers, plan §6), drawn
// on the shared OblastChoropleth with an adjacent ranked list (the "pair the map
// with a bar list" convention, §3.1d) and click-to-filter.

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { MapPinned, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur } from "@/lib/currency";
import {
  provinceToCanon,
  fetchPopulation,
} from "@/data/procurement/useProcurementByOblast";
import { OblastChoropleth } from "@/screens/components/procurement/OblastChoropleth";
import { useCultureOblast } from "@/data/culture/useCulture";

type Metric = "count" | "perCapita";

// A culture-violet sequential ramp (light → dark), distinct from the procurement
// teal so the two maps don't read as the same dataset. The lowest bucket is a
// pale violet — NOT hsl(var(--muted)), which OblastChoropleth reserves for
// no-data oblasts, so a lowest-bucket province stays distinguishable from blank.
const CULTURE_RAMP = [
  "hsl(262 45% 95%)",
  "hsl(262 60% 90%)",
  "hsl(262 60% 78%)",
  "hsl(262 62% 66%)",
  "hsl(262 64% 54%)",
  "hsl(262 66% 45%)",
] as const;

export const CultureOblastMapTile: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const { data } = useCultureOblast();
  const { data: population } = useQuery({
    queryKey: ["population"] as const,
    queryFn: fetchPopulation,
    staleTime: Infinity,
  });
  const [metric, setMetric] = useState<Metric>("count");
  const [active, setActive] = useState<string | null>(null);

  // Map each oblast bucket to a canonical code once; keep the ones that resolve.
  const rows = useMemo(() => {
    if (!data) return [];
    return data.oblasts
      .map((o) => {
        const canon = provinceToCanon(o.oblast);
        const pop = canon && population ? population[canon] : undefined;
        const perCapita = pop && pop > 0 ? o.procurementEur / pop : undefined;
        return { ...o, canon, pop, perCapita };
      })
      .filter((r) => r.canon);
  }, [data, population]);

  const values = useMemo(() => {
    const m = new Map<string, number | undefined>();
    for (const r of rows)
      m.set(
        r.canon as string,
        metric === "count" ? r.instituteCount : r.perCapita,
      );
    return m;
  }, [rows, metric]);

  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) m.set(r.canon as string, r.oblast);
    return m;
  }, [rows]);

  // National per-capita mean, for the comparator-by-default framing (§3.1e).
  const natMean = useMemo(() => {
    const totEur = rows.reduce((s, r) => s + r.procurementEur, 0);
    const totPop = rows.reduce((s, r) => s + (r.pop ?? 0), 0);
    return totPop > 0 ? totEur / totPop : undefined;
  }, [rows]);

  if (!data || rows.length === 0) return null;

  const fmtVal = (v: number | undefined): string => {
    if (v == null) return "—";
    return metric === "count"
      ? `${v} ${bg ? "институт." : "inst."}`
      : `${formatEur(v)}${bg ? "/жит." : "/cap"}`;
  };

  const ranked = [...rows].sort((a, b) =>
    metric === "count"
      ? b.instituteCount - a.instituteCount
      : (b.perCapita ?? 0) - (a.perCapita ?? 0),
  );
  const maxRank =
    metric === "count"
      ? Math.max(1, ...ranked.map((r) => r.instituteCount))
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
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <MapPinned className="h-4 w-4" />
            {bg ? "Културата по области" : "Culture across Bulgaria"}
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
            {pill("count", bg ? "Брой институти" : "Institutes")}
            {pill("perCapita", bg ? "Поръчки на жител" : "Procurement/cap")}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <OblastChoropleth
            values={values}
            names={names}
            ramp={CULTURE_RAMP}
            formatValue={fmtVal}
            tooltipExtra={(canon) => {
              const r = rows.find((x) => x.canon === canon);
              if (!r) return null;
              return metric === "count"
                ? `${formatEur(r.procurementEur)} ${bg ? "поръчки" : "procurement"}`
                : `${r.instituteCount} ${bg ? "институт." : "inst."}`;
            }}
            activeCanon={active}
            onSelectOblast={(canon) =>
              setActive((cur) => (cur === canon ? null : canon))
            }
            ariaLabel={
              bg
                ? "Държавни културни институти по област"
                : "State cultural institutes by oblast"
            }
          />
          <div>
            <ul className="space-y-1.5">
              {ranked.map((r) => {
                const val =
                  metric === "count" ? r.instituteCount : (r.perCapita ?? 0);
                const isActive = active === r.canon;
                return (
                  <li key={r.canon}>
                    <button
                      type="button"
                      onClick={() =>
                        setActive((cur) =>
                          cur === r.canon ? null : (r.canon as string),
                        )
                      }
                      className={`flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-sm transition-colors hover:bg-accent/40 ${
                        isActive ? "bg-accent/50" : ""
                      }`}
                    >
                      <span className="w-24 shrink-0 truncate">{r.oblast}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block h-1.5 w-full rounded-full bg-muted">
                          <span
                            className="block h-1.5 rounded-full bg-primary"
                            style={{ width: `${(val / maxRank) * 100}%` }}
                          />
                        </span>
                      </span>
                      <span className="w-24 shrink-0 text-right tabular-nums text-muted-foreground">
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
                  ? `Средно за страната: ${formatEur(natMean)}/жител.`
                  : `National average: ${formatEur(natMean)}/resident.`}
              </p>
            )}
          </div>
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground/80">
          {bg
            ? `${data.resolvedInstitutes} от ${data.totalInstitutes} държавни културни института, локализирани по седалище (ТР). Показани са обществените им поръчки (АОП/ЦАИС ЕОП) — субсидиите за филми и грантовете се плащат извън ЗОП. Филмовата продукция не е картирана: продуцентите нямат ЕИК в регистъра.`
            : `${data.resolvedInstitutes} of ${data.totalInstitutes} state cultural institutes located by registered seat (TR). Shown is their public procurement (АОП/ЦАИС ЕОП) — film subsidies and grants are paid outside procurement. Film production is not mapped: producers carry no company ID in the register.`}
        </p>
      </CardContent>
    </Card>
  );
};
