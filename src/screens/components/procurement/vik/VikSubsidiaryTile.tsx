// "Дружествата в групата" — the consolidated ВиК-холдинг group: each operator's
// ЗОП spend in scope, € desc, linking to its own /awarder/:eik page. This is the
// tile that makes the point the holding's own per-EIK header cannot: the parent
// (206086428) procures almost nothing; the money is in the ~26 regional
// operators. Pure from VikOperatorAgg (useVik). Tier-A — renders off the existing
// corpus with no new ingest. See docs/plans/water-view-v1.md §4.1c.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Network } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import {
  VIK_HOLDING_EIK,
  type WaterOperatorType,
} from "@/lib/vikReferenceData";
import { operatorByEik } from "@/lib/vikReferenceData";
import type { VikOperatorAgg } from "@/data/procurement/useVik";

const TYPE_LABEL: Record<WaterOperatorType, { bg: string; en: string }> = {
  holding_parent: { bg: "холдинг", en: "holding" },
  holding_sub: { bg: "дъщерно", en: "subsidiary" },
  municipal: { bg: "общинско", en: "municipal" },
  concession: { bg: "концесия", en: "concession" },
  irrigation: { bg: "напояване", en: "irrigation" },
};

const TOP_N = 12;

export const VikSubsidiaryTile: FC<{ operators: VikOperatorAgg[] }> = ({
  operators,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const rows = operators.filter((o) => o.totalEur > 0);
  if (rows.length < 2) return null;
  const max = Math.max(...rows.map((o) => o.totalEur));
  const shown = rows.slice(0, TOP_N);
  const rest = rows.slice(TOP_N);
  const restEur = rest.reduce((s, o) => s + o.totalEur, 0);

  return (
    <Card id="group">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Network className="h-4 w-4" />
          {bg ? "Дружествата в групата" : "Operators in the group"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-2">
        {shown.map((o) => {
          const type = operatorByEik(o.eik)?.type;
          return (
            <div key={o.eik} className="text-xs">
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="min-w-0 truncate font-medium">
                  {o.eik === VIK_HOLDING_EIK ? (
                    o.name
                  ) : (
                    <Link
                      to={`/awarder/${o.eik}`}
                      className="hover:text-primary hover:underline"
                    >
                      {o.name}
                    </Link>
                  )}
                  {o.oblast && (
                    <span className="ml-1 font-normal text-muted-foreground/70">
                      · {o.oblast}
                    </span>
                  )}
                  {type && type !== "holding_sub" && (
                    <span className="ml-1 rounded-full border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                      {bg ? TYPE_LABEL[type].bg : TYPE_LABEL[type].en}
                    </span>
                  )}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatEurCompact(o.totalEur, lang)}
                  <span className="ml-1 text-muted-foreground/70">
                    {o.contractCount}
                  </span>
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-sky-500"
                  style={{ width: `${Math.max(2, (o.totalEur / max) * 100)}%` }}
                />
              </div>
            </div>
          );
        })}
        {rest.length > 0 && (
          <p className="pt-1 text-[11px] text-muted-foreground">
            {bg
              ? `+ още ${rest.length} дружества · ${formatEurCompact(restEur, lang)}`
              : `+ ${rest.length} more operators · ${formatEurCompact(restEur, lang)}`}
          </p>
        )}
        <p className="pt-1 text-[11px] text-muted-foreground/80">
          {bg
            ? "Консолидиран изглед по всички дружества в групата (АОП/ЦАИС ЕОП). Числото до сумата е броят договори. Принадлежността към холдинга е ориентировъчна — подлежи на сверка с vikholding.bg."
            : "Consolidated across every operator in the group (АОП/ЦАИС ЕОП). The number by the amount is the contract count. Holding membership is indicative — pending reconciliation with vikholding.bg."}
        </p>
      </CardContent>
    </Card>
  );
};
