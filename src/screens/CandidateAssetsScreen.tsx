import { FC, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
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
  ArrowLeft,
  Coins,
} from "lucide-react";
import { Title } from "@/ux/Title";
import { useMpAssets } from "@/data/parliament/useMpAssets";
import { useMpDeclarations } from "@/data/parliament/useMpDeclarations";
import { useResolvedCandidateName } from "@/data/candidates/useResolvedCandidate";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import type { MpAsset, MpAssetCategory, MpDeclaration } from "@/data/dataTypes";

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

const ORDER: MpAssetCategory[] = [
  "real_estate",
  "vehicle",
  "bank",
  "cash",
  "investment",
  "security",
  "receivable",
  "debt",
];

const formatBgn = (n: number | null | undefined, lang: string): string => {
  if (n == null) return "—";
  const locale = lang === "bg" ? "bg-BG" : "en-GB";
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
    Math.round(n),
  );
};

type CategorySection = {
  category: MpAssetCategory;
  rows: MpAsset[];
};

const groupByCategory = (assets: MpAsset[]): CategorySection[] => {
  const groups = new Map<MpAssetCategory, MpAsset[]>();
  for (const a of assets) {
    const arr = groups.get(a.category) ?? [];
    arr.push(a);
    groups.set(a.category, arr);
  }
  return ORDER.filter((c) => groups.has(c)).map((c) => ({
    category: c,
    rows: groups.get(c)!,
  }));
};

const AssetTable: FC<{
  category: MpAssetCategory;
  rows: MpAsset[];
  lang: string;
}> = ({ category, rows, lang }) => {
  const { t } = useTranslation();
  const Icon = CATEGORY_ICONS[category];
  const isDebt = category === "debt";
  const isRealEstate = category === "real_estate";
  const isVehicle = category === "vehicle";

  const totalBgn = rows.reduce((s, r) => s + (r.valueBgn ?? 0), 0);

  return (
    <div className="rounded-lg border bg-card mb-6">
      <div className="px-4 py-3 border-b flex items-center gap-3 bg-muted/30">
        <Icon
          className={`h-5 w-5 ${isDebt ? "text-red-600" : "text-muted-foreground"}`}
        />
        <h2 className="text-base font-semibold">
          {t(CATEGORY_KEYS[category]) || CATEGORY_FALLBACKS[category]}
        </h2>
        <span className="text-xs text-muted-foreground">
          · {rows.length}{" "}
          {rows.length === 1
            ? t("mp_assets_item") || "item"
            : t("mp_assets_items") || "items"}
        </span>
        <span
          className={`ml-auto font-mono tabular-nums ${isDebt ? "text-red-600" : ""}`}
        >
          {totalBgn > 0 ? `${formatBgn(totalBgn, lang)} лв` : "—"}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[11px] text-muted-foreground uppercase tracking-wide">
            <tr className="border-b bg-muted/10">
              <th className="text-left font-normal px-3 py-2 w-8">#</th>
              <th className="text-left font-normal px-3 py-2">
                {t("mp_assets_col_description") || "Type / description"}
              </th>
              {(isRealEstate || isVehicle) && (
                <th className="text-left font-normal px-3 py-2">
                  {isRealEstate
                    ? t("mp_assets_col_location") || "Location"
                    : t("mp_assets_col_brand") || "Brand"}
                </th>
              )}
              {isRealEstate && (
                <th className="text-right font-normal px-3 py-2">
                  {t("mp_assets_col_area") || "Area (m²)"}
                </th>
              )}
              <th className="text-right font-normal px-3 py-2">
                {t("mp_assets_col_year") || "Year"}
              </th>
              <th className="text-left font-normal px-3 py-2">
                {t("mp_assets_col_holder") || "Holder"}
              </th>
              <th className="text-right font-normal px-3 py-2">
                {t("mp_assets_col_share") || "Share"}
              </th>
              <th className="text-right font-normal px-3 py-2">
                {t("mp_assets_col_amount") || "Amount"}
              </th>
              <th className="text-right font-normal px-3 py-2">BGN</th>
              <th className="text-left font-normal px-3 py-2">
                {t("mp_assets_col_legal_basis") || "Legal basis"}
              </th>
              <th className="text-left font-normal px-3 py-2">
                {t("mp_assets_col_origin") || "Origin of funds"}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={i % 2 === 0 ? "" : "bg-muted/10"}>
                <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">
                  {i + 1}
                </td>
                <td className="px-3 py-2">{r.description ?? "—"}</td>
                {(isRealEstate || isVehicle) && (
                  <td className="px-3 py-2 text-muted-foreground">
                    {isRealEstate
                      ? [r.location, r.municipality]
                          .filter(Boolean)
                          .join(" · ") || "—"
                      : (r.detail ?? "—")}
                  </td>
                )}
                {isRealEstate && (
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.areaSqm ?? "—"}
                  </td>
                )}
                <td className="px-3 py-2 text-right text-xs tabular-nums">
                  {r.acquiredYear ?? "—"}
                </td>
                <td className="px-3 py-2 text-xs">
                  {r.holderName ? (
                    <span>
                      {r.holderName}
                      {r.isSpouse && (
                        <span className="ml-1 italic text-muted-foreground">
                          ({t("mp_assets_spouse") || "spouse"})
                        </span>
                      )}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2 text-right text-xs">
                  {r.share ?? "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-mono text-xs">
                  {r.amount != null
                    ? `${formatBgn(r.amount, lang)} ${r.currency ?? ""}`.trim()
                    : "—"}
                </td>
                <td
                  className={`px-3 py-2 text-right tabular-nums font-mono ${isDebt ? "text-red-600" : ""}`}
                >
                  {formatBgn(r.valueBgn, lang)}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {r.legalBasis ?? "—"}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground max-w-[280px]">
                  {r.fundsOrigin ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const IncomeTable: FC<{ decl: MpDeclaration; lang: string }> = ({
  decl,
  lang,
}) => {
  const { t } = useTranslation();
  const rows = decl.income.filter(
    (r) => (r.amountBgnDeclarant ?? 0) !== 0 || (r.amountBgnSpouse ?? 0) !== 0,
  );
  if (rows.length === 0) return null;
  const totalDecl = rows.reduce((s, r) => s + (r.amountBgnDeclarant ?? 0), 0);
  const totalSpouse = rows.reduce((s, r) => s + (r.amountBgnSpouse ?? 0), 0);
  return (
    <div className="rounded-lg border bg-card mb-6">
      <div className="px-4 py-3 border-b flex items-center gap-3 bg-muted/30">
        <Coins className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-base font-semibold">
          {t("mp_income_heading") || "Annual income"}
        </h2>
        <span className="text-xs text-muted-foreground">
          · {rows.length}{" "}
          {rows.length === 1
            ? t("mp_income_row") || "row"
            : t("mp_income_rows") || "rows"}
        </span>
        <span className="ml-auto font-mono tabular-nums">
          {formatBgn(totalDecl + totalSpouse, lang)} лв
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[11px] text-muted-foreground uppercase tracking-wide">
            <tr className="border-b bg-muted/10">
              <th className="text-left font-normal px-3 py-2 w-8">#</th>
              <th className="text-left font-normal px-3 py-2">
                {t("mp_income_category") || "Category"}
              </th>
              <th className="text-right font-normal px-3 py-2">
                {t("mp_income_declarant") || "Declarant"} (лв)
              </th>
              <th className="text-right font-normal px-3 py-2">
                {t("mp_income_spouse") || "Spouse"} (лв)
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={i % 2 === 0 ? "" : "bg-muted/10"}>
                <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">
                  {i + 1}
                </td>
                <td className="px-3 py-2">
                  {r.parent && (
                    <span className="text-[11px] text-muted-foreground block">
                      {r.parent}
                    </span>
                  )}
                  {r.category ?? "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-mono">
                  {formatBgn(r.amountBgnDeclarant, lang)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-mono">
                  {formatBgn(r.amountBgnSpouse, lang)}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 font-semibold">
              <td />
              <td className="px-3 py-2">{t("total") || "Total"}</td>
              <td className="px-3 py-2 text-right tabular-nums font-mono">
                {formatBgn(totalDecl, lang)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums font-mono">
                {formatBgn(totalSpouse, lang)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

export const CandidateAssetsScreen: FC = () => {
  const { id } = useParams<{ id: string }>();
  const { name: resolved } = useResolvedCandidateName(id);
  const fallback =
    id && !id.startsWith("mp-") && !id.startsWith("c-")
      ? decodeURIComponent(id)
      : "";
  const name = resolved ?? fallback;
  const { t, i18n } = useTranslation();
  const { rollup } = useMpAssets(name);
  const { declarations } = useMpDeclarations(name);

  const latestDecl = useMemo(() => {
    if (!rollup || declarations.length === 0) return undefined;
    return declarations.find(
      (d) => d.declarationYear === rollup.latestDeclarationYear,
    );
  }, [rollup, declarations]);

  const sections = useMemo(
    () => (latestDecl?.assets ? groupByCategory(latestDecl.assets) : []),
    [latestDecl],
  );

  const lang = i18n.language;

  if (!rollup || !latestDecl) {
    return (
      <div className="w-full">
        <Title>{name}</Title>
        <div className="text-sm text-muted-foreground">
          {t("mp_assets_no_data") ||
            "No declared assets data for this candidate."}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <Link
        to={`/candidate/${id ?? encodeURIComponent(name)}`}
        className="inline-flex items-center gap-1 text-sm text-primary hover:underline mb-2"
      >
        <ArrowLeft className="h-4 w-4" />
        {name}
      </Link>
      <Title
        description={`${t("mp_assets_page_title") || "Declared assets"} · ${name}`}
      >
        <span className="inline-flex items-center gap-3">
          <MpAvatar name={name} className="h-8 w-8" />
          <span className="inline-flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            {t("mp_assets_title") || "Declared assets"}
          </span>
          <span className="text-sm font-normal text-muted-foreground">
            ·{" "}
            {rollup.fiscalYear
              ? `${t("fiscal_year") || "fiscal year"} ${rollup.fiscalYear}`
              : `${rollup.latestDeclarationYear}`}
          </span>
        </span>
      </Title>

      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2 mb-6 mt-4">
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
        <a
          href={rollup.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          register.cacbg.bg · {rollup.latestDeclarationYear}
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      {sections.map((s) => (
        <AssetTable
          key={s.category}
          category={s.category}
          rows={s.rows}
          lang={lang}
        />
      ))}

      <IncomeTable decl={latestDecl} lang={lang} />

      <div className="text-xs text-muted-foreground mt-4">
        {t("mp_assets_page_footer") ||
          "Net worth = sum of declared real estate, vehicles, cash, bank deposits, receivables, investments, securities and company shares (declarant + spouse) minus declared debts. Source: register.cacbg.bg (Bulgarian Court of Audit)."}
      </div>
    </div>
  );
};
