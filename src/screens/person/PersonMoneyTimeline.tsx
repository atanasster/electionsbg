// The "money vs power" timeline: public contracts won by the person's companies, bucketed by
// which cabinet was in power (person-candidate-merge). EIK-exact via person_money() (082) —
// lazily loaded here so the heavier contracts range-join stays off person_by_slug's hot path.
//
// Rendered as a SMALL time-axis chart: one bar per cabinet the person's companies won under,
// positioned across its tenure window and height ∝ € won, sitting directly above the shared
// government strip (ChartCabinetStrip) so the coloured cabinet bands + PM labels line up with
// the bars on the same time axis.
//
// FRAMING (defamation-safe): this is money the person's COMPANIES won while a cabinet governed
// — a national-timeline overlay, NOT a claim the person directed it. The hint says so.

import { FC, ReactNode, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Landmark } from "lucide-react";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { Card, CardContent } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { useTooltip } from "@/ux/useTooltip";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { toFractionalYear } from "@/screens/components/governments/governmentTimelineUtils";
import { ChartCabinetStrip } from "@/screens/components/governments/ChartCabinetStrip";

type Bucket = {
  id: string;
  pm: string;
  parties: string[] | null;
  start: string;
  end: string | null;
  type: string;
  contracts: number;
  eur: number;
};

const PLOT_H = 92; // px — a small chart, per the design ask
const COL_W = 2.2; // uniform column width (% of plot) — height is the ONLY magnitude cue, so
//                    bars stay comparable regardless of how long the cabinet governed.
const NO_PARTY = "#94a3b8"; // slate fallback when the cabinet's party has no canonical colour

const fmtYear = (d?: string | null): string =>
  d ? (/^(\d{4})/.exec(d)?.[1] ?? d) : "";

export const PersonMoneyTimeline: FC<{ slug: string }> = ({ slug }) => {
  const { t } = useTranslation();
  const { colorFor } = useCanonicalParties();
  const { tooltip, onMouseEnter, onMouseMove, onMouseLeave } = useTooltip({
    maxHeight: 220,
    maxWidth: 260,
  });
  const [buckets, setBuckets] = useState<Bucket[] | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/db/person-money?slug=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((j: Bucket[]) => live && setBuckets(Array.isArray(j) ? j : []))
      .catch(() => live && setBuckets([]));
    return () => {
      live = false;
    };
  }, [slug]);

  const model = useMemo(() => {
    if (!buckets || buckets.length === 0) return null;
    const nowIso = new Date().toISOString();
    const startFy = (b: Bucket) => toFractionalYear(b.start);
    const endFy = (b: Bucket) => toFractionalYear(b.end ?? nowIso);
    const x0 = Math.min(...buckets.map(startFy));
    const x1 = Math.max(...buckets.map(endFy));
    const span = x1 - x0 || 1;
    const max = Math.max(...buckets.map((b) => b.eur), 1);
    // The window the government strip should span — earliest start → latest end (now if the
    // last cabinet is still in office), so the shared strip's domain matches the bars'.
    const fromDate = buckets.reduce(
      (m, b) => (b.start < m ? b.start : m),
      buckets[0].start,
    );
    const toDate = buckets
      .map((b) => b.end ?? nowIso)
      .reduce((m, e) => (e > m ? e : m), buckets[0].end ?? nowIso);
    // One uniform-width column per cabinet, CENTERED over its band on the same time axis, so
    // the strip's coloured band sits directly beneath each bar. Width is capped to 70% of a
    // (short caretaker) band so a slim band never overflows.
    const bars = buckets.map((b) => {
      const s = startFy(b);
      const e = endFy(b);
      const bandPct = ((e - s) / span) * 100;
      const midPct = (((s + e) / 2 - x0) / span) * 100;
      const w = Math.min(COL_W, Math.max(bandPct * 0.7, 0.6));
      return {
        ...b,
        widthPct: w,
        leftPct: Math.max(0, Math.min(100 - w, midPct - w / 2)),
        heightPct: Math.max((b.eur / max) * 100, 4),
        color: (b.parties?.[0] && colorFor(b.parties[0])) || NO_PARTY,
      };
    });
    return { bars, fromDate, toDate, max };
  }, [buckets, colorFor]);

  if (!model) return null;

  const tip = (b: Bucket): ReactNode => (
    <div className="text-xs">
      <div className="font-semibold">{b.pm}</div>
      <div className="text-muted-foreground">
        {fmtYear(b.start)}–{fmtYear(b.end) || "…"}
        {b.parties?.length ? ` · ${b.parties.join(", ")}` : ""}
      </div>
      <div className="mt-1 tabular-nums">
        {formatEurCompact(b.eur)} ·{" "}
        {t("pp_in_contracts", { count: b.contracts })}
      </div>
    </div>
  );

  return (
    <DashboardSection
      id="person-money"
      title={t("pp_money_by_cabinet")}
      icon={Landmark}
      subtitle={t("pp_money_by_cabinet_hint")}
    >
      <Card>
        <CardContent className="pt-6">
          {/* Money columns — height ∝ €, colour = the cabinet's party. They sit on the chart's
              own baseline; the government strip is a separate band below (not glued). */}
          <div className="relative w-full" style={{ height: PLOT_H }}>
            <div className="absolute left-0 top-0 text-[10px] tabular-nums text-muted-foreground">
              {formatEurCompact(model.max)}
            </div>
            <div className="absolute inset-x-0 bottom-0 h-px bg-border" />
            {model.bars.map((b) => (
              <div
                key={b.id}
                className="absolute bottom-0 rounded-t transition-opacity hover:opacity-80"
                style={{
                  left: `${b.leftPct}%`,
                  width: `${b.widthPct}%`,
                  minWidth: 3,
                  height: `${b.heightPct}%`,
                  backgroundColor: b.color,
                }}
                onMouseEnter={(e) =>
                  onMouseEnter({ pageX: e.pageX, pageY: e.pageY }, tip(b))
                }
                onMouseMove={(e) =>
                  onMouseMove({ pageX: e.pageX, pageY: e.pageY })
                }
                onMouseLeave={onMouseLeave}
              />
            ))}
          </div>
          {/* Shared government strip (small/compact) — a separate context band below the chart
              (mt gap so it isn't glued to the columns); same window → each band still lines up
              under its column. */}
          <ChartCabinetStrip
            fromDate={model.fromDate}
            toDate={model.toDate}
            compact
            className="mt-3"
          />
          {/* Shared tooltip — a sibling of the relative plot, never inside it (house rule:
              it's position:absolute against the nearest non-static ancestor; CardContent is
              static, so page coords resolve correctly). */}
          {tooltip}
        </CardContent>
      </Card>
    </DashboardSection>
  );
};
