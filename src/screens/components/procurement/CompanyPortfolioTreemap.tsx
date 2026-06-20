// Portfolio treemap — the right chart for static composition. On /company/:eik
// it shows which buyers a supplier's revenue comes from; on /awarder/:eik it
// shows which suppliers a buyer's spend goes to. Sized by euro total. Built
// from the rollup's byAwarder / byContractor list already on the page.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { PieChart } from "lucide-react";
import { ResponsiveContainer, Treemap, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur } from "@/lib/currency";

type Cell = { eik: string; name: string; size: number };

// Terracotta → slate ramp, matching the procurement palette. Index by rank so
// the largest cells are the most saturated.
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

export const CompanyPortfolioTreemap: FC<{
  role: "awarder" | "contractor";
  items: Array<{ eik: string; name: string; totalEur: number }>;
}> = ({ role, items }) => {
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

  // On the awarder page the cells are contractors → /company/:eik; on the
  // company page the cells are awarders → /awarder/:eik.
  const linkBase = role === "awarder" ? "/company" : "/awarder";

  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <PieChart className="h-4 w-4" />
          {role === "awarder"
            ? t("portfolio_treemap_awarder") || "Spend by supplier"
            : t("portfolio_treemap_contractor") || "Revenue by buyer"}
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
                      <div className="font-medium max-w-[220px] truncate">
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
          {t("portfolio_treemap_hint") ||
            "Each tile is one counterparty, sized by euro total. Click to open its page."}
        </p>
      </CardContent>
    </Card>
  );
};
