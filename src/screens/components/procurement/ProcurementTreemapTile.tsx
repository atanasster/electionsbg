// Ranking treemap for the /procurement landing page. Unlike CompanyPortfolioTreemap
// (which shows one entity's counterparties on its detail page), this ranks the
// largest contractors OR the largest awarders across the whole election slice —
// each tile is one company/institution, sized by total awarded value, linking to
// its own page. Mirrors the terracotta→slate palette of the portfolio treemap.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Building2, Receipt } from "lucide-react";
import { ResponsiveContainer, Treemap, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur } from "@/lib/currency";

type Cell = { eik: string; name: string; size: number };

// Largest cells most saturated (terracotta), tail fades to slate.
const RAMP = [
  "#b45309",
  "#c2710c",
  "#d97706",
  "#e08a1e",
  "#e8a23d",
  "#efb968",
  "#a8a29e",
  "#94a3b8",
];

const CellContent: FC<{
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  index?: number;
  name?: string;
}> = ({ x = 0, y = 0, width = 0, height = 0, index = 0, name = "" }) => {
  const fill = RAMP[Math.min(index, RAMP.length - 1)];
  const showLabel = width > 56 && height > 24;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={fill}
        stroke="var(--background)"
        strokeWidth={2}
      />
      {showLabel ? (
        <text
          x={x + 6}
          y={y + 16}
          fontSize={11}
          className="fill-white"
          style={{ pointerEvents: "none" }}
        >
          {name.length > Math.floor(width / 7)
            ? `${name.slice(0, Math.max(0, Math.floor(width / 7) - 1))}…`
            : name}
        </text>
      ) : null}
    </g>
  );
};

export const ProcurementTreemapTile: FC<{
  entity: "contractor" | "awarder";
  items: Array<{ eik: string; name: string; totalEur: number }>;
}> = ({ entity, items }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const data = useMemo<Cell[]>(
    () =>
      [...items]
        .filter((i) => i.totalEur > 0)
        .sort((a, b) => b.totalEur - a.totalEur)
        .slice(0, 24)
        .map((i) => ({ eik: i.eik, name: i.name, size: i.totalEur })),
    [items],
  );

  if (data.length < 2) return null;

  const isContractor = entity === "contractor";
  const linkBase = isContractor ? "/company" : "/awarder";
  const seeAllHref = isContractor
    ? "/procurement/contractors"
    : "/procurement/awarders";
  const Icon = isContractor ? Receipt : Building2;
  const title = isContractor
    ? t("procurement_treemap_contractors") || "Largest contractors"
    : t("procurement_treemap_awarders") || "Largest awarders";
  const subtitle = isContractor
    ? t("procurement_treemap_contractors_subtitle") ||
      "Companies ranked by total contract value won."
    : t("procurement_treemap_awarders_subtitle") ||
      "State buyers ranked by total contract value awarded.";

  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Icon className="h-4 w-4" />
          {title}
          <span className="text-xs text-muted-foreground font-normal ml-1">
            {subtitle}
          </span>
          <Link
            to={seeAllHref}
            className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline font-normal"
          >
            {t("procurement_tile_see_all") || "See all"}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <div style={{ height: 300, width: "100%" }}>
          <ResponsiveContainer width="100%" height="100%">
            <Treemap
              data={data}
              dataKey="size"
              nameKey="name"
              stroke="var(--background)"
              isAnimationActive={false}
              content={<CellContent />}
              onClick={(node: unknown) => {
                const eik = (node as { eik?: string })?.eik;
                if (eik) navigate(`${linkBase}/${eik}`);
              }}
            >
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const p = payload[0].payload as Cell;
                  return (
                    <div className="rounded-md border bg-popover px-2 py-1 text-xs shadow-sm">
                      <div className="font-medium max-w-[260px] whitespace-normal break-words">
                        {p.name}
                      </div>
                      <div className="tabular-nums">{formatEur(p.size)}</div>
                    </div>
                  );
                }}
              />
            </Treemap>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground/80">
          {t("procurement_treemap_hint") ||
            "Each tile is one entity, sized by total awarded value. Click to open its page."}
        </p>
      </CardContent>
    </Card>
  );
};
