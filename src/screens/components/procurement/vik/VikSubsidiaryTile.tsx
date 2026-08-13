// Each operator's ЗОП spend in scope, € desc, linking to its own /awarder/:eik
// page. This is the tile that makes the point a single per-EIK header cannot:
// the holding parent (206086428) procures almost nothing; the money is in the
// regional operators. Pure from VikOperatorAgg. Tier-A — renders off the existing
// corpus with no new ingest. See docs/plans/water-view-v1.md §4.1c.
//
// It serves TWO universes and says which one it is showing — see the derivation
// note at HOLDING_EIKS below, and docs/plans/water-sector-audit-v1.md.

import { FC } from "react";
import { AwarderLink } from "@/screens/components/procurement/AwarderLink";
import { useTranslation } from "react-i18next";
import { Network } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import {
  VIK_HOLDING_EIK,
  VIK_HOLDING_SUB_EIKS,
  operatorByEik,
  type WaterOperatorType,
} from "@/lib/vikReferenceData";
import type { VikOperatorAgg } from "@/data/procurement/useVik";

const TYPE_LABEL: Record<WaterOperatorType, { bg: string; en: string }> = {
  holding_parent: { bg: "холдинг", en: "holding" },
  holding_sub: { bg: "дъщерно", en: "subsidiary" },
  municipal: { bg: "общинско", en: "municipal" },
  concession: { bg: "концесия", en: "concession" },
  irrigation: { bg: "напояване", en: "irrigation" },
  dams: { bg: "язовири", en: "dams" },
};

const TOP_N = 12;

// This tile is fed TWO different universes — the holding group on
// /awarder/206086428, and the whole water sector on /water and
// /procurement/contracts?sector=water — so its framing is DERIVED, never passed
// in. A `variant: "holding" | "sector"` prop would be one more thing a caller can
// get wrong, and the caller getting it wrong IS the defect: before 2026-08-13 the
// sector set rendered under the group heading, so the page asserted that Софийска
// вода (a Veolia concession the reference data says in capitals is never a
// subsidiary) and ДП УСЯ (a dam enterprise) were companies in Български ВиК
// холдинг. `universeEiks` is not that prop — the caller states which EIKs it
// ASKED for, a fact it cannot be wrong about, and the tile still decides.
//
// Deriving from `universeEiks` rather than from the rendered rows matters because
// the rows are already scope-filtered: under a narrow ?pscope a window in which
// only holding members happened to trade would flip /water back to the group
// framing with nothing to signal it. The row-based check remains the fallback for
// a caller with no set to declare.
const HOLDING_EIKS = new Set([VIK_HOLDING_EIK, ...VIK_HOLDING_SUB_EIKS]);

export const VikSubsidiaryTile: FC<{
  operators: VikOperatorAgg[];
  /** The EIK universe the caller aggregated — scope-independent, so an empty
   *  window cannot invert the tile's central claim. */
  universeEiks?: readonly string[];
}> = ({ operators, universeEiks }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const rows = operators.filter((o) => o.totalEur > 0);
  if (rows.length < 2) return null;
  const isSector = (universeEiks ?? rows.map((o) => o.eik)).some(
    (e) => !HOLDING_EIKS.has(e),
  );
  const max = Math.max(...rows.map((o) => o.totalEur));
  const shown = rows.slice(0, TOP_N);
  const rest = rows.slice(TOP_N);
  const restEur = rest.reduce((s, o) => s + o.totalEur, 0);

  return (
    <Card id="group">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Network className="h-4 w-4" />
          {isSector
            ? bg
              ? "Дружествата във водния сектор"
              : "Operators in the water sector"
            : bg
              ? "Дружествата в групата"
              : "Operators in the group"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-2">
        {shown.map((o) => {
          const type = operatorByEik(o.eik)?.type;
          return (
            <div key={o.eik} className="text-xs">
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="min-w-0 truncate font-medium">
                  {/* The self-link is suppressed only on the holding's OWN
                      page. In the sector view the holding is just another row —
                      and the one a reader is most likely to click. */}
                  {!isSector && o.eik === VIK_HOLDING_EIK ? (
                    o.name
                  ) : (
                    <AwarderLink
                      eik={o.eik}
                      className="hover:text-primary hover:underline"
                    >
                      {o.name}
                    </AwarderLink>
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
              ? `+ още ${rest.length} ${isSector ? "оператора" : "дружества"} · ${formatEurCompact(restEur, lang)}`
              : `+ ${rest.length} more operators · ${formatEurCompact(restEur, lang)}`}
          </p>
        )}
        <p className="pt-1 text-[11px] text-muted-foreground/80">
          {isSector
            ? bg
              ? "Консолидиран изглед по всички оператори във водния сектор (АОП/ЦАИС ЕОП) — регионалните ВиК дружества, общинските оператори, концесията за София, Напоителни системи и язовирите. Не всички са част от холдинга. Числото до сумата е броят договори."
              : "Consolidated across every operator in the water sector (АОП/ЦАИС ЕОП) — the regional water companies, the municipal operators, the Sofia concession, the irrigation enterprise and the dams. Not all are part of the holding. The number by the amount is the contract count."
            : bg
              ? "Консолидиран изглед по всички дружества в групата (АОП/ЦАИС ЕОП). Числото до сумата е броят договори. Принадлежността към холдинга е ориентировъчна — подлежи на сверка с vikholding.bg."
              : "Consolidated across every operator in the group (АОП/ЦАИС ЕОП). The number by the amount is the contract count. Holding membership is indicative — pending reconciliation with vikholding.bg."}
        </p>
      </CardContent>
    </Card>
  );
};
