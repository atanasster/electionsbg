// Entity-scoped buyer→supplier money-flow tile for /awarder/:eik and
// /company/:eik. Renders the top-N flows out of (awarder) / into (contractor)
// the entity via the shared ProcurementFlowSankey, with the MP overlay drawn in
// when any counterparty is tied to a parliamentarian. The graph is built
// client-side from the rollup already loaded by the page (see entityFlow.ts) —
// no extra fetch.

import { FC, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { GitFork } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import {
  buildEntityFlowGraph,
  type EntityFlowMpEdge,
  type EntityFlowRole,
} from "@/data/procurement/entityFlow";
import { ProcurementFlowSankey } from "./ProcurementFlowSankey";

const HEIGHT = 480;
const MIN_DIAGRAM_WIDTH = 720;
const TOP_LIMIT = 18;

export const EntityFlowTile: FC<{
  role: EntityFlowRole;
  centerEik: string;
  centerName: string;
  counterparties: Array<{ eik: string; name: string; totalEur: number }>;
  mpEdges?: EntityFlowMpEdge[];
}> = ({ role, centerEik, centerName, counterparties, mpEdges }) => {
  const { t } = useTranslation();
  const [size, setSize] = useState({ width: 0, height: 0 });

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

  const graph = useMemo(
    () =>
      buildEntityFlowGraph({
        role,
        centerEik,
        centerName,
        counterparties,
        mpEdges,
        limit: TOP_LIMIT,
      }),
    [role, centerEik, centerName, counterparties, mpEdges],
  );

  if (graph.links.length === 0) return null;

  const hasMp = graph.nodes.some((n) => n.type === "mp");

  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <GitFork className="h-4 w-4" />
          {role === "awarder"
            ? t("entity_flow_awarder_title") || "Where the money goes"
            : t("entity_flow_contractor_title") || "Where the money comes from"}
          <span className="text-xs text-muted-foreground font-normal ml-1">
            {t("entity_flow_top_n", { n: TOP_LIMIT }) ||
              `top ${TOP_LIMIT} by value`}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-2">
        <div
          ref={containerRef}
          className="rounded-md border bg-card overflow-x-auto"
          style={{ height: HEIGHT }}
        >
          <div style={{ minWidth: MIN_DIAGRAM_WIDTH, height: HEIGHT }}>
            {size.width > 0 ? (
              <ProcurementFlowSankey
                nodes={graph.nodes}
                links={graph.links}
                width={Math.max(size.width, MIN_DIAGRAM_WIDTH)}
                height={HEIGHT}
              />
            ) : null}
          </div>
        </div>
        {hasMp ? (
          <p className="text-[11px] text-muted-foreground/80">
            {t("entity_flow_mp_hint") ||
              "Blue nodes mark suppliers tied to a sitting or former MP (declared officer / owner)."}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
};
