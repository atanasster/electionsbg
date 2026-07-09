// Entity-scoped buyer→supplier money-flow tile for /awarder/:eik and
// /company/:eik. Renders the top-N flows out of (awarder) / into (contractor)
// the entity via the shared ProcurementFlowSankey, with the MP overlay drawn in
// when any counterparty is tied to a parliamentarian. The graph is built
// client-side from the rollup already loaded by the page (see entityFlow.ts) —
// no extra fetch.
//
// A sankey only earns its keep when there's fan-out (one payer split across
// many payees) or the MP cross-link column. A 1-to-1 relationship with no MP
// overlay degenerates into a single thick band that conveys less than a
// sentence — so that case renders a compact relationship statement instead.

import { FC, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowRight, GitFork } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur } from "@/lib/currency";
import {
  buildEntityFlowGraph,
  type EntityFlowCounterparty,
  type EntityFlowMpEdge,
  type EntityFlowRole,
} from "@/data/procurement/entityFlow";
import { ProcurementFlowSankey } from "./ProcurementFlowSankey";
import { useFlowColors } from "./chartColors";

const HEIGHT = 480;
const MIN_DIAGRAM_WIDTH = 720;
const TOP_LIMIT = 18;

// Node palette comes from the shared theme-aware flow colors (slate = awarder,
// orange = contractor) so the dots stay legible on the dark background too.

export const EntityFlowTile: FC<{
  role: EntityFlowRole;
  centerEik: string;
  centerName: string;
  counterparties: EntityFlowCounterparty[];
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
  const funded = counterparties.filter((c) => c.totalEur > 0);

  // 1-to-1 with no MP overlay: the sankey would be a single band. Show a
  // relationship statement (payer → amount → payee) instead.
  if (!hasMp && funded.length === 1) {
    return (
      <EntityFlowSolo
        role={role}
        centerName={centerName}
        counterparty={funded[0]}
      />
    );
  }

  return (
    // data-og: OG-card anchor for awarders without a domain pack, e.g. ДФЗ
    // (scripts/og/capture-screens.ts).
    <Card className="my-4" data-og="awarder-flow">
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

// One entity box in the relationship statement. The center entity is the page
// you're already on, so it renders as plain text; the counterparty links out.
const SoloNode: FC<{
  name: string;
  kind: "awarder" | "contractor";
  href?: string;
}> = ({ name, kind, href }) => {
  const flowColors = useFlowColors();
  const inner = (
    <span className="inline-flex items-start gap-2 min-w-0">
      <span
        className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm"
        style={{ backgroundColor: flowColors[kind] }}
      />
      <span className="font-medium break-words">{name}</span>
    </span>
  );
  return (
    <div className="flex-1 min-w-0 rounded-md border bg-card px-3 py-2.5 text-sm">
      {href ? (
        <Link to={href} className="hover:underline">
          {inner}
        </Link>
      ) : (
        inner
      )}
    </div>
  );
};

// Compact buyer→supplier statement shown when one entity pays exactly one
// counterparty (and no MP overlay). Money always flows awarder→contractor; the
// center role decides which side is the clickable counterparty.
const EntityFlowSolo: FC<{
  role: EntityFlowRole;
  centerName: string;
  counterparty: EntityFlowCounterparty;
}> = ({ role, centerName, counterparty }) => {
  const { t } = useTranslation();
  const isAwarderRole = role === "awarder";
  const payerName = isAwarderRole ? centerName : counterparty.name;
  const payerHref = isAwarderRole ? undefined : `/awarder/${counterparty.eik}`;
  const payeeName = isAwarderRole ? counterparty.name : centerName;
  const payeeHref = isAwarderRole ? `/company/${counterparty.eik}` : undefined;

  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <ArrowRight className="h-4 w-4" />
          {isAwarderRole
            ? t("entity_flow_awarder_title") || "Where the money goes"
            : t("entity_flow_contractor_title") || "Where the money comes from"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
          <SoloNode name={payerName} kind="awarder" href={payerHref} />
          <div className="flex shrink-0 flex-col items-center justify-center px-1 sm:px-2">
            <span className="text-base md:text-lg font-bold tabular-nums">
              {formatEur(counterparty.totalEur)}
            </span>
            <ArrowRight className="h-5 w-5 rotate-90 text-muted-foreground sm:rotate-0" />
          </div>
          <SoloNode name={payeeName} kind="contractor" href={payeeHref} />
        </div>
        <p className="mt-2 text-center text-[11px] text-muted-foreground/80 sm:text-left">
          {isAwarderRole
            ? t("entity_flow_solo_awarder") ||
              "All of it goes to a single contractor"
            : t("entity_flow_solo_contractor") ||
              "All of it comes from a single awarder"}
        </p>
      </CardContent>
    </Card>
  );
};
