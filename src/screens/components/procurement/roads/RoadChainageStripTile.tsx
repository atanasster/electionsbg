// Chainage coverage strip — per major motorway, a kilometre axis heat-mapped by
// contracted spend density, so the reader sees which stretches have been worked
// and where the gaps are (the classic "Хемус missing middle"). Scoped to the
// named motorways only: contracts whose title carries an absolute "от км A до км
// B" chainage (~a third of the corpus) are placed on their motorway's axis; the
// rest can't be located and are intentionally not shown here.
//
// Re-parses lengthOf(title) per row (cheap, ~2k rows) using the kmFrom/kmTo the
// parser now returns — no change to the shared RoadContract shape.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Waypoints } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { lengthOf, type RoadContract } from "@/lib/roadAttributes";

// Named motorways with a coherent single km axis (the generic "Автомагистрала"
// fallback has no specific corridor, so it's excluded), each with its plausible
// built/planned length (km). The length also rejects km markers a
// title borrowed from a cross-referenced road — e.g. a "км 442" from Път I-1
// (which shadows Струма up western BG) must not stretch Струма's ~150 km axis.
// These are stable physical facts, so a hard cap is more honest than a
// percentile heuristic (the borrowed markers are too common to be "outliers").
const MOTORWAY_MAX_KM: Record<string, number> = {
  Тракия: 380,
  Хемус: 430,
  Струма: 165,
  Марица: 120,
  "Черно море": 110,
  Люлин: 25,
  Европа: 95,
};
const MOTORWAYS = new Set(Object.keys(MOTORWAY_MAX_KM));

const BINS = 44;

interface Strip {
  name: string;
  from: number;
  to: number;
  bins: number[]; // € density per bin
  maxBin: number;
  totalEur: number;
  contracts: number;
  coveredPct: number;
}

export const RoadChainageStripTile: FC<{ rows: RoadContract[] }> = ({
  rows,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;

  const strips = useMemo<Strip[]>(() => {
    const byM = new Map<
      string,
      { segs: { from: number; to: number; eur: number }[] }
    >();
    for (const r of rows) {
      if (!r.ref?.isMotorway || !MOTORWAYS.has(r.ref.corridor)) continue;
      const len = lengthOf(r.c.title);
      if (len?.kmFrom == null || len.kmTo == null) continue;
      let from = len.kmFrom;
      let to = len.kmTo;
      if (to < from) [from, to] = [to, from];
      // Sane chainage only: within this motorway's plausible length (rejects km
      // markers borrowed from a cross-referenced road), non-degenerate.
      if (from < 0 || to > MOTORWAY_MAX_KM[r.ref.corridor]) continue;
      if (to - from < 0.2 || to - from > 200) continue;
      const m = byM.get(r.ref.corridor) ?? { segs: [] };
      m.segs.push({ from, to, eur: r.amountEur });
      byM.set(r.ref.corridor, m);
    }

    const out: Strip[] = [];
    for (const [name, { segs }] of byM) {
      if (segs.length < 3) continue;
      const axisMin = Math.min(...segs.map((s) => s.from));
      const axisMax = Math.max(...segs.map((s) => s.to));
      const span = axisMax - axisMin;
      if (span < 5) continue;
      const binW = span / BINS;
      const bins = new Array<number>(BINS).fill(0);
      for (const s of segs) {
        const perKm = s.eur / Math.max(0.1, s.to - s.from);
        const b0 = Math.floor((s.from - axisMin) / binW);
        const b1 = Math.min(BINS - 1, Math.floor((s.to - axisMin) / binW));
        for (let b = Math.max(0, b0); b <= b1; b++) {
          const binStart = axisMin + b * binW;
          const binEnd = binStart + binW;
          const overlap = Math.min(s.to, binEnd) - Math.max(s.from, binStart);
          if (overlap > 0) bins[b] += perKm * overlap;
        }
      }
      const maxBin = Math.max(...bins, 1);
      const covered = bins.filter((v) => v > 0).length;
      out.push({
        name,
        from: axisMin,
        to: axisMax,
        bins,
        maxBin,
        totalEur: segs.reduce((a, s) => a + s.eur, 0),
        contracts: segs.length,
        coveredPct: covered / BINS,
      });
    }
    return out.sort((a, b) => b.totalEur - a.totalEur);
  }, [rows]);

  if (strips.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Waypoints className="h-4 w-4" />
          {lang === "bg"
            ? "Покритие по километри"
            : "Coverage along the kilometre axis"}
          <span className="text-xs font-normal text-muted-foreground">
            {lang === "bg" ? "магистрали" : "motorways"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-4">
        {strips.map((s) => (
          <div key={s.name}>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="font-medium">{s.name}</span>
              <span className="text-muted-foreground tabular-nums">
                {formatEurCompact(s.totalEur, lang)} · {s.contracts}{" "}
                {lang === "bg" ? "договора" : "contracts"} ·{" "}
                {Math.round(s.coveredPct * 100)}%{" "}
                {lang === "bg" ? "покритие" : "covered"}
              </span>
            </div>
            <div className="mt-1 flex gap-px h-3 rounded overflow-hidden bg-muted">
              {s.bins.map((v, i) => (
                <span
                  key={i}
                  className="flex-1"
                  style={
                    v > 0
                      ? {
                          backgroundColor: "hsl(var(--primary))",
                          opacity: 0.2 + 0.8 * (v / s.maxBin),
                        }
                      : undefined
                  }
                  title={
                    v > 0
                      ? `${(s.from + (i / BINS) * (s.to - s.from)).toFixed(0)} км · ${formatEurCompact(v, lang)}`
                      : undefined
                  }
                />
              ))}
            </div>
            <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground tabular-nums">
              <span>км {s.from.toFixed(0)}</span>
              <span>км {s.to.toFixed(0)}</span>
            </div>
          </div>
        ))}
        <p className="text-[11px] text-muted-foreground/80">
          {lang === "bg"
            ? "Само договори с абсолютна километрична референция по именувана магистрала и поне 3 локализирани договора на магистрала. По-тъмното означава повече вложени средства на този участък; празното — липса на договори (не непременно липса на път)."
            : "Only contracts with an absolute km reference on a named motorway, and at least 3 locatable contracts per motorway. Darker = more € spent on that stretch; empty = no contracts (not necessarily no road)."}
        </p>
      </CardContent>
    </Card>
  );
};
