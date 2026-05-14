// Wraps ProcurementFlowSankey with:
//  - Width detection via ResizeObserver
//  - Amount-threshold slider (filters out small links to keep the диаграмата
//    readable as the corpus grows)
//  - Legend
//  - A light source-attribution footer
//
// Embedded as a stacked section on /procurement.

import { FC, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { GitFork } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useProcurementFlow } from "@/data/procurement/useProcurementFlow";
import { ProcurementFlowSankey } from "./ProcurementFlowSankey";
import { formatEur } from "@/lib/currency";

const HEIGHT = 820;
// Below this width the 3 columns can't fit their labels without overlap.
// Mobile viewports get a horizontal scrollbar; desktop renders flush.
const MIN_DIAGRAM_WIDTH = 900;
const MIN_LINKS_TO_RENDER = 1;
// Aim for ~30 visible links by default — empirically the limit where labels
// remain readable. The diagram remains hidden behind a scroll on narrow
// viewports; the slider lets the operator pull the threshold down to zero
// to inspect the long tail.
const DEFAULT_VISIBLE_LINKS = 30;

const pickDefaultThreshold = (
  values: number[],
  targetCount: number,
): number => {
  if (values.length <= targetCount) return 0;
  const sorted = [...values].sort((a, b) => b - a);
  // Threshold is the (targetCount+1)-th largest, rounded down — i.e. the
  // smallest link we want to keep visible at the default. Floor so the
  // displayed slider snaps to a whole-currency-unit value.
  return Math.max(0, Math.floor(sorted[targetCount] ?? 0));
};

export const ProcurementFlowTile: FC = () => {
  const { t } = useTranslation();
  const { data, isLoading } = useProcurementFlow();
  // null = not yet initialised (data still loading). Once data arrives, the
  // effect below computes a sensible default that filters out the long tail
  // of small links. Operators can drag the slider down to 0 to see everything.
  const [threshold, setThreshold] = useState<number | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  // Measures the scroll box's usable content area. Width drives the layout;
  // height keeps the SVG flush with the box so it never overflows — a fixed
  // pixel height would fight the box's border (and, on mobile, the horizontal
  // scrollbar) and surface a stray vertical scrollbar.
  const containerRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    setSize({ width: el.clientWidth, height: el.clientHeight });
    const ro = new ResizeObserver((entries) => {
      for (const ent of entries)
        setSize({
          width: ent.contentRect.width,
          height: ent.contentRect.height,
        });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const maxValue = useMemo(
    () => data?.links.reduce((m, l) => Math.max(m, l.valueEur), 0) ?? 0,
    [data],
  );
  // Initialise the threshold to the value that keeps DEFAULT_VISIBLE_LINKS
  // visible. Effect (not useMemo) so the operator's manual slider drag
  // persists across re-renders of the same data.
  useEffect(() => {
    if (!data || threshold !== null) return;
    setThreshold(
      pickDefaultThreshold(
        data.links.map((l) => l.valueEur),
        DEFAULT_VISIBLE_LINKS,
      ),
    );
  }, [data, threshold]);

  const effectiveThreshold = threshold ?? 0;
  const filtered = useMemo(() => {
    if (!data) return { nodes: [], links: [] };
    const links = data.links.filter((l) => l.valueEur >= effectiveThreshold);
    // Drop nodes with no surviving links.
    const keep = new Set<string>();
    for (const l of links) {
      keep.add(l.source);
      keep.add(l.target);
    }
    const nodes = data.nodes.filter((n) => keep.has(n.id));
    return { nodes, links };
  }, [data, effectiveThreshold]);

  // Hide tile entirely when there's nothing to show (procurement data exists
  // but no MP-tied flows yet).
  if (!isLoading && (!data || data.links.length === 0)) return null;

  return (
    <Card className="my-4" data-og="procurement-flow">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <GitFork className="h-4 w-4" />
          {t("procurement_flow_title") ||
            "MP-tied money flow (awarder → company → MP)"}
          {data ? (
            <span className="text-xs text-muted-foreground font-normal ml-1">
              {filtered.links.length}/{data.links.length}{" "}
              {t("procurement_flow_links") || "link(s)"}
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        {isLoading ? (
          <div className="min-h-[400px]" aria-hidden />
        ) : (
          <>
            <div className="flex items-center gap-3 text-xs flex-wrap">
              <label className="flex items-center gap-2">
                <span className="text-muted-foreground">
                  {t("procurement_flow_threshold") || "Min link"}
                </span>
                <input
                  type="range"
                  min={0}
                  max={Math.ceil(maxValue)}
                  step={Math.max(1, Math.floor(maxValue / 200))}
                  value={effectiveThreshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  className="accent-primary w-40"
                />
                <span className="font-medium tabular-nums">
                  {formatEur(effectiveThreshold)}
                </span>
              </label>
              <Legend />
            </div>

            <div
              ref={containerRef}
              className="rounded-md border bg-card overflow-x-auto"
              style={{ height: HEIGHT }}
            >
              {/* min-width keeps the 3-column diagram legible on mobile, where
                  fitting it to the viewport would collide the labels; the box
                  scrolls horizontally to reach the overflow. */}
              <div
                style={{
                  minWidth: MIN_DIAGRAM_WIDTH,
                  height: size.height || HEIGHT,
                }}
              >
                {filtered.links.length >= MIN_LINKS_TO_RENDER &&
                size.width > 0 ? (
                  <ProcurementFlowSankey
                    nodes={filtered.nodes}
                    links={filtered.links}
                    width={Math.max(size.width, MIN_DIAGRAM_WIDTH)}
                    height={size.height || HEIGHT}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-sm text-muted-foreground p-4 text-center">
                    {t("procurement_flow_empty") ||
                      "No flows above the current threshold. Lower the slider to reveal more."}
                  </div>
                )}
              </div>
            </div>

            <div className="text-xs text-muted-foreground">
              <strong className="text-foreground">
                {t("procurement_flow_hint_label")}
              </strong>
              : {t("procurement_flow_hint")}
            </div>

            <p className="text-[11px] text-muted-foreground/80">
              <strong className="text-foreground">
                {t("procurement_flow_scope_label")}
              </strong>
              : {t("procurement_flow_source_hint")}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
};

const Legend: FC = () => {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground ml-auto">
      <LegendDot
        color="#475569"
        label={t("procurement_flow_legend_awarder") || "Awarder"}
      />
      <LegendDot
        color="#d97706"
        label={t("procurement_flow_legend_contractor") || "Contractor"}
      />
      <LegendDot
        color="#2563eb"
        label={t("procurement_flow_legend_mp") || "MP"}
      />
    </div>
  );
};

const LegendDot: FC<{ color: string; label: string }> = ({ color, label }) => (
  <span className="inline-flex items-center gap-1">
    <span
      className="inline-block h-2.5 w-2.5 rounded-sm"
      style={{ backgroundColor: color }}
    />
    {label}
  </span>
);
