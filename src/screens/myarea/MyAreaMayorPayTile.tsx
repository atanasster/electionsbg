// "Заплата на кмета" — built auditing gospodari.com's 2026-08-24 kmet-salaries
// article against our own declarations corpus: every figure it cited checked
// out, but nothing on the site let a reader see the comparison for themselves.
// Plan: docs/plans/mayor-salary-transparency-v1.md (T2, UI option D).
//
// Two rules govern this tile:
//
//   1. **`income_eur` is the mayor's OWN labor-income row, never a household
//      total.** `mayor_pay_by_obshtina()` deliberately excludes rent,
//      dividends and a spouse's income — see the migration header. This tile
//      must never add anything to the figure it is handed.
//   2. **A rank is STATED, never styled as an alarm.** Same "Rule 4" as
//      `MyAreaMunicipalFiscalTile`'s чл. 130д note: the ratio this tile shows
//      is a fact about declared pay relative to population, not a verdict —
//      a município ranking high here has a REASON worth reading about
//      (resort/seasonal load, a tiny population, a mid-term vacancy), which
//      this tile cannot see and must not imply.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Banknote, ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Link } from "@/ux/Link";
import { useMayorPay } from "@/data/officials/useMayorPay";
import { formatEur, formatCount } from "@/lib/currency";

type MayorPayCardProps = {
  obshtina: string;
  /**
   * A person page may retain historic offices.  A declaration is only shown
   * there when the API identifies that same person as the municipality's
   * current mayor, rather than silently assigning a successor's filing to
   * the former officeholder.
   */
  expectedMayorSlug?: string;
  /** A settlement is governed by the parent municipality's mayor, not one of
   * its own unless it has a separate kmetstvo office. */
  scope?: "municipality" | "parentMunicipality";
};

export const MayorPayCard: FC<MayorPayCardProps> = ({
  obshtina,
  expectedMayorSlug,
  scope = "municipality",
}) => {
  const { t, i18n } = useTranslation();
  const { data } = useMayorPay(obshtina);

  // Self-suppress rather than render an empty card: a município this function
  // does not resolve (a within-city район, a currently-ambiguous mid-term
  // seat) and one whose corpus simply is not loaded look the same from here,
  // and neither is worth a placeholder on 265 dashboards.
  if (!data || (expectedMayorSlug && data.mayor_slug !== expectedMayorSlug)) {
    return null;
  }

  const locale = i18n.language;

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-1">
        <Banknote className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-semibold">
          {t(
            scope === "parentMunicipality"
              ? "mp_tile_parent_municipality_title"
              : "mp_tile_title",
          )}
        </h3>
      </div>

      {data.income_eur == null ? (
        <p className="text-sm text-muted-foreground">{t("mp_tile_no_data")}</p>
      ) : (
        <>
          <div className="text-2xl font-semibold tabular-nums">
            {formatEur(data.income_eur, locale)}
          </div>
          <div className="text-xs text-muted-foreground">
            {t("mp_tile_income_label", {
              year: data.fiscal_year ?? "",
              name: data.mayor_name,
            })}
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            {data.population != null && (
              <>
                {t("mp_tile_population", {
                  population: formatCount(data.population, locale),
                })}
              </>
            )}
            {data.rank != null && (
              <>
                {" · "}
                {t("mp_tile_rank", {
                  rank: data.rank,
                  total: data.ranked_count,
                })}
              </>
            )}
          </div>
        </>
      )}

      <p className="text-[11px] text-muted-foreground mt-3">
        {data.source_url && (
          <a
            href={data.source_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 hover:underline"
          >
            {t("mp_tile_source")}
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {data.source_url && " · "}
        <Link to="/governance/mayor-pay">{t("mp_tile_compare")}</Link>
      </p>
    </Card>
  );
};

// Backwards-compatible My Area name. The same verified contextual card is
// deliberately shared by person and local-election pages.
export const MyAreaMayorPayTile = MayorPayCard;
