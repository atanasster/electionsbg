// „Стигат ли парите до най-бедните области?" — the regional-convergence scatter, the
// beat-the-competitor tile (regionalprofiles.bg shows the outcome, cohesiondata shows the
// money; nobody joins them — §2). Each dot is an oblast: x = GDP/capita (regional.json,
// the wealth axis), y = ИСУН absorbed € per resident (muni-map). Median quadrant lines
// split the field. The question: do the POOR oblasts (left) get MORE money per head (top),
// i.e. is the allocation convergent/progressive, or regressive?
//
// Honest framing (§0b): the EU allocates largely by GDP/capita, so poorer regions SHOULD
// receive more per head — the residual reveals whether BG's INTERNAL distribution follows
// that logic. Money is all-ИСУН and Sofia city is dropped (HQ-attribution outlier). Adapted
// from MvrCrimeScatterTile (median lines + mobile-safe outlier labels).

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ScatterChart } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur } from "@/lib/currency";
import type { RegionalOblastAgg } from "@/data/procurement/useRegionalOblast";

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const W = 320;
const H = 240;
const PAD = { l: 44, r: 12, t: 12, b: 30 };

export const RegionalConvergenceTile: FC<{ oblasts: RegionalOblastAgg[] }> = ({
  oblasts,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";

  const points = useMemo(
    () =>
      oblasts
        // Drop Sofia city (HQ-attribution outlier) + rows missing either axis.
        .filter(
          (o) =>
            o.canon !== "SOFIA_CITY" &&
            o.gdpPerCapita != null &&
            o.gdpPerCapita > 0 &&
            o.population > 0 &&
            o.paidPerCapitaEur > 0,
        )
        .map((o) => ({
          canon: o.canon,
          name: o.name,
          gdp: o.gdpPerCapita as number,
          perCapita: o.paidPerCapitaEur,
        })),
    [oblasts],
  );

  const geom = useMemo(() => {
    if (points.length < 4) return null;
    const xs = points.map((p) => p.gdp);
    const ys = points.map((p) => p.perCapita);
    const xMax = Math.max(...xs) * 1.08;
    const yMax = Math.max(...ys) * 1.08;
    const sx = (v: number) => PAD.l + (v / (xMax || 1)) * (W - PAD.l - PAD.r);
    const sy = (v: number) =>
      H - PAD.b - (v / (yMax || 1)) * (H - PAD.t - PAD.b);
    const xMed = median(xs);
    const yMed = median(ys);
    // Label the poorest oblast and the highest-€/capita oblast.
    const poorest = [...points].sort((a, b) => a.gdp - b.gdp)[0];
    const hiSpend = [...points].sort((a, b) => b.perCapita - a.perCapita)[0];
    const labelled = new Set([poorest.canon, hiSpend.canon]);
    return { sx, sy, xMed, yMed, labelled };
  }, [points]);

  if (!geom || points.length < 4) return null;
  const { sx, sy, xMed, yMed, labelled } = geom;

  return (
    <Card id="convergence">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <ScatterChart className="h-4 w-4" />
          {bg
            ? "Стигат ли парите до най-бедните области?"
            : "Does the money reach the poorest oblasts?"}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {bg
            ? "Всяка точка е област: БВП на човек (богатство) спрямо усвоени европейски средства на жител."
            : "Each dot is an oblast: GDP per capita (wealth) vs EU funds absorbed per resident."}
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
                ? "Разсейка: БВП на човек спрямо европейски средства на жител по области"
                : "Scatter: GDP per capita vs EU funds per resident by oblast"
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
                  cx={sx(p.gdp)}
                  cy={sy(p.perCapita)}
                  r={3.4}
                  fill="hsl(96 30% 42%)"
                  fillOpacity={0.82}
                >
                  <title>{`${p.name}: ${formatEur(p.gdp, lang)}/${bg ? "жит. БВП" : "cap GDP"}, ${formatEur(p.perCapita, lang)}/${bg ? "жит. ЕС" : "cap EU"}`}</title>
                </circle>
                {labelled.has(p.canon) &&
                  (() => {
                    // Right-half points anchor their label leftward so it can't
                    // clip the SVG edge (mobile-narrow safe).
                    const rightHalf = sx(p.gdp) > (W - PAD.r + PAD.l) / 2;
                    return (
                      <text
                        x={sx(p.gdp) + (rightHalf ? -5 : 5)}
                        y={sy(p.perCapita) - 4}
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
              {bg ? "БВП на човек →" : "GDP per capita →"}
            </text>
            <text
              x={-(PAD.t + H - PAD.b) / 2}
              y={11}
              transform="rotate(-90)"
              textAnchor="middle"
              className="fill-muted-foreground"
              style={{ fontSize: 9 }}
            >
              {bg ? "€ ЕС / жител →" : "€ EU / resident →"}
            </text>
          </svg>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground/80">
          {bg
            ? `${points.length} области (столицата отпада — завишена от национални програми). Пунктирът е медианата. Точки горе-вляво = бедни области с много пари на човек (сближаване); долу-вдясно = богати с малко. ЕС разпределя предимно спрямо БВП на човек, така че по-бедните региони би трябвало да получават повече — разсейката показва дали вътрешното разпределение следва тази логика. Всички фондове по ИСУН; контекст, не причинност. Източници: regional.json (БВП), ИСУН (муни-карта).`
            : `${points.length} oblasts (the capital is dropped — inflated by national programmes). Dashed lines are the medians. Top-left dots = poor oblasts with high € per head (convergence); bottom-right = rich with little. The EU allocates largely by GDP/capita, so poorer regions should receive more — the scatter shows whether the internal distribution follows that logic. All ИСУН funds; context, not causation. Sources: regional.json (GDP), ИСУН (muni-map).`}
        </p>
      </CardContent>
    </Card>
  );
};
