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
import { TreemapCell } from "./treemapCell";
import { treemapCellColor } from "./treemapPalette";

type Cell = { eik: string; name: string; size: number; color: string };

export const ProcurementTreemapTile: FC<{
  entity: "contractor" | "awarder";
  items: Array<{ eik: string; name: string; totalEur: number }>;
}> = ({ entity, items }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const data = useMemo<Cell[]>(() => {
    const ranked = [...items]
      .filter((i) => i.totalEur > 0)
      .sort((a, b) => b.totalEur - a.totalEur)
      .slice(0, 24);
    return ranked.map((i, idx) => ({
      eik: i.eik,
      name: i.name,
      size: i.totalEur,
      color: treemapCellColor(idx, ranked.length),
    }));
  }, [items]);

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
              content={<TreemapCell />}
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
