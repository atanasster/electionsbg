// "Разход срещу престъпност" — the signature Phase-3 spend-vs-outcome view (plan
// §7 tile 9 / §7b.D). A per-oblast scatter: x = МВР procurement € per resident
// (the regional ОДМВР/РДПБЗН units), y = recorded theft rate per 100k (Eurostat via
// data/regional.json — ALREADY ingested, no new fetch). Median quadrant lines split
// the field; a couple of outliers are labelled. Honest framing: spend and crime are
// correlated with many confounders (population density, reporting) — this is context,
// not causation. Sofia city is dropped (its theft series is МИР-sharded S23/S24/S25).

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ScatterChart } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur } from "@/lib/currency";
import { dataUrl } from "@/data/dataUrl";
import { fetchPopulation } from "@/data/procurement/useProcurementByOblast";
import type { MvrUnitAgg } from "@/data/procurement/useMvr";
import { unitOblastCanon } from "./securityOblast";

interface RegionalFile {
  series?: { theftRate?: Record<string, { year: number; value: number }[]> };
}

const useTheftRate = () =>
  useQuery({
    queryKey: ["security", "theft_rate"] as const,
    queryFn: async (): Promise<Record<string, number>> => {
      const r = await fetch(dataUrl("/regional.json"));
      if (!r.ok) return {};
      const d = (await r.json()) as RegionalFile;
      const t = d.series?.theftRate ?? {};
      const out: Record<string, number> = {};
      for (const [canon, arr] of Object.entries(t)) {
        const last = arr[arr.length - 1];
        if (last) out[canon] = last.value;
      }
      return out;
    },
    staleTime: Infinity,
  });

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const W = 320;
const H = 240;
const PAD = { l: 40, r: 12, t: 12, b: 30 };

export const MvrCrimeScatterTile: FC<{ units: MvrUnitAgg[] }> = ({ units }) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const { data: population } = useQuery({
    queryKey: ["population"] as const,
    queryFn: fetchPopulation,
    staleTime: Infinity,
  });
  const { data: theft } = useTheftRate();

  const points = useMemo(() => {
    if (!population || !theft) return [];
    // Aggregate regional units → per-oblast €, then €/capita, join theft rate.
    const eurByCanon = new Map<string, number>();
    const nameByCanon = new Map<string, string>();
    for (const u of units) {
      const canon = unitOblastCanon(u.name);
      if (!canon) continue;
      eurByCanon.set(canon, (eurByCanon.get(canon) ?? 0) + u.totalEur);
      if (!nameByCanon.has(canon)) {
        const token = /Столична/.test(u.name)
          ? "София"
          : (u.name.match(/—\s*(.+?)\s*$/)?.[1] ?? canon);
        nameByCanon.set(canon, token);
      }
    }
    const out: {
      canon: string;
      name: string;
      perCapita: number;
      theft: number;
    }[] = [];
    for (const [canon, eur] of eurByCanon) {
      const pop = population[canon];
      const th = theft[canon];
      if (!pop || pop <= 0 || th == null) continue; // Sofia city has no direct theft series
      out.push({
        canon,
        name: nameByCanon.get(canon) ?? canon,
        perCapita: eur / pop,
        theft: th,
      });
    }
    return out;
  }, [units, population, theft]);

  const geom = useMemo(() => {
    if (points.length < 4) return null;
    const xs = points.map((p) => p.perCapita);
    const ys = points.map((p) => p.theft);
    const xMin = 0;
    const xMax = Math.max(...xs) * 1.08;
    const yMin = 0;
    const yMax = Math.max(...ys) * 1.08;
    const sx = (v: number) =>
      PAD.l + ((v - xMin) / (xMax - xMin || 1)) * (W - PAD.l - PAD.r);
    const sy = (v: number) =>
      H - PAD.b - ((v - yMin) / (yMax - yMin || 1)) * (H - PAD.t - PAD.b);
    const xMed = median(xs);
    const yMed = median(ys);
    // Label the two most extreme points (highest crime, highest spend).
    const hiCrime = [...points].sort((a, b) => b.theft - a.theft)[0];
    const hiSpend = [...points].sort((a, b) => b.perCapita - a.perCapita)[0];
    const labelled = new Set([hiCrime.canon, hiSpend.canon]);
    return { sx, sy, xMed, yMed, labelled };
  }, [points]);

  if (!geom || points.length < 4) return null;
  const { sx, sy, xMed, yMed, labelled } = geom;

  return (
    <Card id="crime-scatter">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <ScatterChart className="h-4 w-4" />
          {bg ? "Разход срещу престъпност" : "Spend vs crime"}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {bg
            ? "Всяка точка е област: разход на МВР на жител спрямо регистрирани кражби на 100 000 души."
            : "Each dot is an oblast: МВР spend per resident vs recorded theft per 100k."}
        </p>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <div className="w-full overflow-x-auto">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full"
            style={{ maxWidth: 480 }}
            role="img"
            aria-label={
              bg
                ? "Разсейка: разход на МВР на жител спрямо престъпност по области"
                : "Scatter: МВР spend per resident vs crime by oblast"
            }
          >
            {/* median quadrant lines */}
            <line
              x1={sx(xMed)}
              y1={PAD.t}
              x2={sx(xMed)}
              y2={H - PAD.b}
              stroke="hsl(var(--border))"
              strokeDasharray="3 3"
            />
            <line
              x1={PAD.l}
              y1={sy(yMed)}
              x2={W - PAD.r}
              y2={sy(yMed)}
              stroke="hsl(var(--border))"
              strokeDasharray="3 3"
            />
            {/* axes */}
            <line
              x1={PAD.l}
              y1={H - PAD.b}
              x2={W - PAD.r}
              y2={H - PAD.b}
              stroke="hsl(var(--muted-foreground))"
              strokeWidth="0.75"
            />
            <line
              x1={PAD.l}
              y1={PAD.t}
              x2={PAD.l}
              y2={H - PAD.b}
              stroke="hsl(var(--muted-foreground))"
              strokeWidth="0.75"
            />
            {/* points */}
            {points.map((p) => (
              <g key={p.canon}>
                <circle
                  cx={sx(p.perCapita)}
                  cy={sy(p.theft)}
                  r={3.4}
                  fill="hsl(222 32% 46%)"
                  fillOpacity={0.8}
                >
                  <title>{`${p.name}: ${formatEur(p.perCapita, i18n.language)}/${bg ? "жит." : "cap"}, ${Math.round(p.theft)} ${bg ? "кражби/100к" : "theft/100k"}`}</title>
                </circle>
                {labelled.has(p.canon) &&
                  (() => {
                    // Right-half points anchor their label leftward so it can't
                    // clip the SVG edge (mobile-narrow safe).
                    const rightHalf = sx(p.perCapita) > (W - PAD.r + PAD.l) / 2;
                    return (
                      <text
                        x={sx(p.perCapita) + (rightHalf ? -5 : 5)}
                        y={sy(p.theft) - 4}
                        textAnchor={rightHalf ? "end" : "start"}
                        className="fill-muted-foreground"
                        style={{ fontSize: 9 }}
                      >
                        {p.name}
                      </text>
                    );
                  })()}
              </g>
            ))}
            {/* axis labels */}
            <text
              x={(PAD.l + W - PAD.r) / 2}
              y={H - 4}
              textAnchor="middle"
              className="fill-muted-foreground"
              style={{ fontSize: 9 }}
            >
              {bg ? "€ на жител →" : "€ per resident →"}
            </text>
            <text
              x={-(PAD.t + H - PAD.b) / 2}
              y={11}
              transform="rotate(-90)"
              textAnchor="middle"
              className="fill-muted-foreground"
              style={{ fontSize: 9 }}
            >
              {bg ? "кражби / 100к →" : "theft / 100k →"}
            </text>
          </svg>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground/80">
          {bg
            ? `${points.length} области. Пунктирът е медианата. Разходът и престъпността зависят от много фактори (гъстота, отчетност) — контекст, не причина. Столицата отпада (кражбите ѝ са по райони). Кражби: Eurostat/НСИ (regional.json). Поръчки: АОП/ЦАИС ЕОП.`
            : `${points.length} oblasts. Dashed lines are the medians. Spend and crime have many confounders (density, reporting) — context, not causation. The capital is dropped (its theft series is district-sharded). Theft: Eurostat/НСИ (regional.json). Procurement: АОП/ЦАИС ЕОП.`}
        </p>
      </CardContent>
    </Card>
  );
};
