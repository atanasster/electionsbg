import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Wallet,
  Home as HomeIcon,
  Car,
  Banknote,
  Landmark,
  TrendingUp,
  FileText,
  HandCoins,
  AlertCircle,
  ExternalLink,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  Coins,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useMpAssets } from "@/data/parliament/useMpAssets";
import { useMpDeclarations } from "@/data/parliament/useMpDeclarations";
import type { MpAsset, MpAssetCategory } from "@/data/dataTypes";

type Props = { name: string };

const CATEGORY_ICONS: Record<
  MpAssetCategory,
  React.ComponentType<{ className?: string }>
> = {
  real_estate: HomeIcon,
  vehicle: Car,
  cash: Banknote,
  bank: Landmark,
  receivable: HandCoins,
  debt: AlertCircle,
  investment: TrendingUp,
  security: FileText,
};

const CATEGORY_KEYS: Record<MpAssetCategory, string> = {
  real_estate: "asset_category_real_estate",
  vehicle: "asset_category_vehicle",
  cash: "asset_category_cash",
  bank: "asset_category_bank",
  receivable: "asset_category_receivable",
  debt: "asset_category_debt",
  investment: "asset_category_investment",
  security: "asset_category_security",
};

const CATEGORY_FALLBACKS: Record<MpAssetCategory, string> = {
  real_estate: "Real estate",
  vehicle: "Vehicles",
  cash: "Cash",
  bank: "Bank accounts",
  receivable: "Receivables",
  debt: "Debts",
  investment: "Investments",
  security: "Securities & shares",
};

const formatBgn = (n: number, lang: string): string => {
  const locale = lang === "bg" ? "bg-BG" : "en-GB";
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
    Math.round(n),
  );
};

const ORDER: MpAssetCategory[] = [
  "real_estate",
  "bank",
  "cash",
  "security",
  "investment",
  "vehicle",
  "receivable",
  "debt",
];

export const MpAssetsSummary: FC<Props> = ({ name }) => {
  const { t, i18n } = useTranslation();
  const { rollup } = useMpAssets(name);
  const { declarations } = useMpDeclarations(name);

  if (!rollup) return null;

  const lang = i18n.language;
  const declarantName = declarations[0]?.declarantName ?? null;
  // Pull the asset rows from the latest declaration (the one the rollup
  // covers) so we can list unvalued items underneath the header.
  const latestDecl = declarations.find(
    (d) => d.declarationYear === rollup.latestDeclarationYear,
  );
  const unvaluedItems: MpAsset[] = (latestDecl?.assets ?? []).filter(
    (a) => a.category !== "debt" && a.valueBgn == null,
  );

  // Income from Table 12 of the same declaration. Only rows where at least
  // one party (declarant or spouse) has a non-zero amount are kept.
  const incomeRows = (latestDecl?.income ?? []).filter(
    (r) => (r.amountBgnDeclarant ?? 0) !== 0 || (r.amountBgnSpouse ?? 0) !== 0,
  );
  const incomeTotalDeclarant = incomeRows.reduce(
    (s, r) => s + (r.amountBgnDeclarant ?? 0),
    0,
  );
  const incomeTotalSpouse = incomeRows.reduce(
    (s, r) => s + (r.amountBgnSpouse ?? 0),
    0,
  );

  const delta = rollup.previous
    ? {
        absolute: rollup.netWorthBgn - rollup.previous.netWorthBgn,
        previousYear: rollup.previous.year,
      }
    : null;

  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Wallet className="h-4 w-4" />
          {t("mp_assets_title") || "Declared assets"}
          <span className="text-xs font-normal text-muted-foreground">
            ·{" "}
            {rollup.fiscalYear
              ? `${t("fiscal_year") || "fiscal year"} ${rollup.fiscalYear}`
              : `${rollup.latestDeclarationYear}`}
          </span>
          <Link
            to={`/candidate/${encodeURIComponent(name)}/assets`}
            className="ml-auto inline-flex items-center gap-1 text-xs font-normal text-primary hover:underline normal-case"
          >
            {t("dashboard_see_details") || "See details"}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 mb-4">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("mp_assets_total") || "Total assets"}
            </div>
            <div className="text-2xl font-bold tabular-nums">
              {formatBgn(rollup.totalAssetsBgn, lang)}{" "}
              <span className="text-base font-normal text-muted-foreground">
                лв
              </span>
            </div>
          </div>
          {rollup.totalDebtsBgn > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {t("mp_assets_debts") || "Debts"}
              </div>
              <div className="text-lg font-semibold tabular-nums text-red-600">
                −{formatBgn(rollup.totalDebtsBgn, lang)}{" "}
                <span className="text-sm font-normal">лв</span>
              </div>
            </div>
          )}
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("mp_assets_net_worth") || "Net worth"}
            </div>
            <div className="text-2xl font-bold tabular-nums">
              {formatBgn(rollup.netWorthBgn, lang)}{" "}
              <span className="text-base font-normal text-muted-foreground">
                лв
              </span>
            </div>
          </div>
          {delta && delta.absolute !== 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {t("mp_assets_yoy") || "vs"} {delta.previousYear}
              </div>
              <div
                className={`text-lg font-semibold tabular-nums inline-flex items-center gap-1 ${
                  delta.absolute > 0 ? "text-green-600" : "text-red-600"
                }`}
              >
                {delta.absolute > 0 ? (
                  <ArrowUp className="h-4 w-4" />
                ) : (
                  <ArrowDown className="h-4 w-4" />
                )}
                {delta.absolute > 0 ? "+" : "−"}
                {formatBgn(Math.abs(delta.absolute), lang)}{" "}
                <span className="text-sm font-normal">лв</span>
              </div>
            </div>
          )}
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {ORDER.filter((c) => rollup.byCategory[c].count > 0).map((c) => {
            const r = rollup.byCategory[c];
            const Icon = CATEGORY_ICONS[c];
            const isDebt = c === "debt";
            return (
              <div
                key={c}
                className="rounded-md border bg-muted/30 p-2 flex items-start gap-2"
              >
                <Icon
                  className={`h-4 w-4 shrink-0 mt-0.5 ${isDebt ? "text-red-600" : "text-muted-foreground"}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">
                    {t(CATEGORY_KEYS[c]) || CATEGORY_FALLBACKS[c]}
                  </div>
                  <div className="text-sm font-semibold tabular-nums">
                    {r.totalBgn > 0 ? `${formatBgn(r.totalBgn, lang)} лв` : "—"}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {r.count}{" "}
                    {r.count === 1
                      ? t("mp_assets_item") || "item"
                      : t("mp_assets_items") || "items"}
                    {r.count > r.valuedCount &&
                      ` · ${r.count - r.valuedCount} ${t("mp_assets_unvalued") || "unvalued"}`}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {incomeRows.length > 0 && (
          <div className="mt-4 pt-3 border-t">
            <div className="text-xs font-medium mb-2 flex items-center gap-2">
              <Coins className="h-3.5 w-3.5" />
              {t("mp_income_heading") || "Annual income"}
              <span className="text-muted-foreground font-normal">
                · {t("total") || "Total"}{" "}
                {formatBgn(incomeTotalDeclarant + incomeTotalSpouse, lang)} лв
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="text-left font-normal py-1 pr-2">
                      {t("mp_income_category") || "Category"}
                    </th>
                    <th className="text-right font-normal py-1 px-2 tabular-nums">
                      {t("mp_income_declarant") || "Declarant"}
                    </th>
                    <th className="text-right font-normal py-1 pl-2 tabular-nums">
                      {t("mp_income_spouse") || "Spouse"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {incomeRows.map((r, i) => (
                    <tr key={i} className="border-b border-border/30">
                      <td className="py-1 pr-2">{r.category ?? "—"}</td>
                      <td className="py-1 px-2 text-right tabular-nums font-mono">
                        {r.amountBgnDeclarant
                          ? `${formatBgn(r.amountBgnDeclarant, lang)} лв`
                          : "—"}
                      </td>
                      <td className="py-1 pl-2 text-right tabular-nums font-mono">
                        {r.amountBgnSpouse
                          ? `${formatBgn(r.amountBgnSpouse, lang)} лв`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {unvaluedItems.length > 0 && (
          <div className="mt-4 pt-3 border-t">
            <div className="text-xs font-medium mb-1.5">
              {t("mp_assets_unvalued_heading") ||
                "Items declared without value"}
            </div>
            <ul className="text-xs text-muted-foreground space-y-0.5">
              {unvaluedItems.slice(0, 12).map((a, i) => {
                const parts: string[] = [];
                // Real estate has rich description; cash/bank/investment
                // rows usually have only a category and currency, so fall
                // back to a category label so the bullet is never empty.
                if (a.description) {
                  parts.push(a.description);
                } else {
                  parts.push(
                    t(CATEGORY_KEYS[a.category]) ||
                      CATEGORY_FALLBACKS[a.category],
                  );
                }
                if (a.detail && a.detail !== a.description)
                  parts.push(a.detail);
                if (a.location) parts.push(a.location);
                if (a.areaSqm) parts.push(`${a.areaSqm} m²`);
                if (a.amount != null && a.currency && a.currency !== "BGN") {
                  parts.push(`${a.amount} ${a.currency}`);
                } else if (a.amount != null && a.currency === "BGN") {
                  parts.push(`${a.amount} лв`);
                }
                if (a.share) parts.push(`(${a.share})`);
                if (a.acquiredYear) parts.push(`${a.acquiredYear}`);
                const Icon = CATEGORY_ICONS[a.category];
                return (
                  <li key={i} className="flex items-start gap-2">
                    <Icon className="h-3 w-3 shrink-0 mt-0.5 text-muted-foreground/60" />
                    <span className="flex-1">{parts.join(" · ")}</span>
                    {a.isSpouse && declarantName && (
                      <span className="italic shrink-0">
                        {t("mp_assets_spouse") || "spouse"}
                      </span>
                    )}
                  </li>
                );
              })}
              {unvaluedItems.length > 12 && (
                <li className="italic">
                  +{unvaluedItems.length - 12} {t("mp_assets_more") || "more"}
                </li>
              )}
            </ul>
          </div>
        )}

        <div className="text-xs text-muted-foreground mt-3 pt-3 border-t flex flex-wrap items-center gap-x-2">
          <a
            href={rollup.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            register.cacbg.bg · {rollup.latestDeclarationYear}
            <ExternalLink className="h-3 w-3" />
          </a>
          <span>
            ·{" "}
            {t("mp_assets_source_note") ||
              "Combined declarant and spouse holdings; source: Court of Audit."}
          </span>
        </div>
      </CardContent>
    </Card>
  );
};
