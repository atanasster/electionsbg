// /funds — focus-themes tile listing the available editorial lenses.
// Loads only the slim themes index (~1 KB).

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useFundsThemesIndex } from "@/data/funds/useFundsThemes";
import { formatEur } from "@/lib/currency";

const numFmt = new Intl.NumberFormat("bg-BG");

export const FundsFocusTile: FC = () => {
  const { t, i18n } = useTranslation();
  const { data, isLoading } = useFundsThemesIndex();
  const lang = i18n.language;

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {t("focus_tile_title") || "Focus themes"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 md:p-4">
          <div className="h-24 animate-pulse rounded bg-muted" />
        </CardContent>
      </Card>
    );
  }

  if (!data || data.themes.length === 0) return null;

  // Hide themes that come back empty after a re-ingest (e.g. keywords matched
  // nothing) so the tile doesn't show dead links.
  const themes = data.themes.filter((th) => th.contractCount > 0);
  if (themes.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-amber-600" />
          {t("focus_tile_title") || "Focus themes"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <p className="mb-3 text-xs text-muted-foreground">
          {t("focus_tile_intro") ||
            "Editorial lenses across the EU-funds corpus — guest houses, roads, agriculture, schools, municipal infrastructure. Each opens a focused dashboard with top beneficiaries, programmes, geography and investigative-journalism sources."}
        </p>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {themes.map((th) => (
            <li key={th.slug}>
              <Link
                to={`/funds/focus/${th.slug}`}
                className="block rounded-md border border-border p-3 text-sm transition-colors hover:border-amber-300 hover:bg-amber-50/30 dark:hover:bg-amber-900/10"
              >
                <div className="font-medium">
                  {lang === "bg" ? th.labelBg : th.labelEn}
                </div>
                <div className="text-[11px] text-muted-foreground tabular-nums">
                  {numFmt.format(th.contractCount)}{" "}
                  {t("funds_index_contracts") || "contracts"} ·{" "}
                  {numFmt.format(th.beneficiaryCount)}{" "}
                  {t("funds_political_companies") || "companies"} ·{" "}
                  {formatEur(th.totalEur)}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
};
