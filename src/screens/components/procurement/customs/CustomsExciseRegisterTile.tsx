// Licensed excise-warehouse register — the top operators (лицензирани
// складодържатели) by their public-procurement footprint, each linking to its
// /company/:eik page. A summary strip splits the active operators by excise-goods
// category. "Виж всички" drills to the full standalone register. Source: Агенция
// „Митници" BACIS, joined with contracts_list at ingest.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import {
  EXCISE_CATEGORIES,
  EXCISE_REGISTER_PATH,
  exciseCategoryColor,
  exciseCategoryLabel,
} from "@/lib/customsReferenceData";
import type { ExciseRegisterFile } from "@/data/procurement/useCustoms";

const TOP_N = 10;

export const CustomsExciseRegisterTile: FC<{ data: ExciseRegisterFile }> = ({
  data,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const eur = (v: number) => formatEurCompact(v, lang);

  const active = data.operators.filter((o) => o.active);
  const byCat = EXCISE_CATEGORIES.map((c) => ({
    ...c,
    n: active.filter((o) => o.categories.includes(c.id)).length,
  })).filter((c) => c.n > 0);
  const top = active.slice(0, TOP_N);

  return (
    <Card>
      <CardContent className="p-3 md:p-4 space-y-3">
        {/* Category split of the active operators */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {byCat.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: c.color }}
              />
              <span className="text-muted-foreground">
                {exciseCategoryLabel(c.id, lang)}
              </span>
              <span className="font-medium tabular-nums">{c.n}</span>
            </span>
          ))}
        </div>

        {/* Top operators by public-contract footprint */}
        <ul className="divide-y">
          {top.map((o) => (
            <li key={o.eik} className="py-1.5 text-xs">
              <div className="flex items-baseline justify-between gap-2">
                <Link
                  to={`/company/${o.eik}`}
                  className="min-w-0 truncate font-medium hover:text-primary hover:underline"
                >
                  {o.name}
                </Link>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {o.procurementEur > 0 ? eur(o.procurementEur) : "—"}
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                {o.categories.map((cat) => (
                  <span key={cat} className="inline-flex items-center gap-1">
                    <span
                      className="h-2 w-2 rounded-sm"
                      style={{ backgroundColor: exciseCategoryColor(cat) }}
                    />
                    {exciseCategoryLabel(cat, lang)}
                  </span>
                ))}
                <span>
                  · {o.warehouses}{" "}
                  {bg
                    ? o.warehouses === 1
                      ? "склад"
                      : "склада"
                    : "warehouses"}
                </span>
                {o.contractCount > 0 && (
                  <span>
                    ·{" "}
                    {bg
                      ? `${o.contractCount} обществени поръчки`
                      : `${o.contractCount} public contracts`}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-between gap-2 pt-1">
          <p className="text-[11px] text-muted-foreground/80">
            {bg
              ? `Подредени по стойност на спечелените обществени поръчки. Източник: Агенция „Митници“ (BACIS), към ${new Date(data.generatedAt).toLocaleDateString("bg-BG")}.`
              : `Ranked by public-contract value won. Source: Customs Agency (BACIS), as of ${new Date(data.generatedAt).toLocaleDateString("en-GB")}.`}
          </p>
          <Link
            to={EXCISE_REGISTER_PATH}
            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            {bg
              ? `Виж всички ${data.activeOperators}`
              : `See all ${data.activeOperators}`}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
};
