import { FC, useMemo } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Home as HomeIcon,
  Car,
  Banknote,
  Landmark,
  TrendingUp,
  FileText,
  HandCoins,
  AlertCircle,
  ExternalLink,
  Coins,
} from "lucide-react";
import { Title } from "@/ux/Title";
import { useMpAssets } from "@/data/parliament/useMpAssets";
import { useMpDeclarations } from "@/data/parliament/useMpDeclarations";
import { useResolvedCandidate } from "@/data/candidates/useResolvedCandidate";
import { useCandidateName } from "@/data/candidates/useCandidateName";
import { CandidateHeader } from "@/screens/components/candidates/CandidateHeader";
import type { MpAsset, MpAssetCategory, MpDeclaration } from "@/data/dataTypes";
import { formatEur } from "@/lib/currency";
import { DataTable, DataTableColumns } from "@/ux/data_table/DataTable";

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

const fmtNum = (n: number | null | undefined, lang: string): string => {
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

  const totalEur = rows.reduce((s, r) => s + (r.valueEur ?? 0), 0);
  const categoryTitle =
    t(CATEGORY_KEYS[category]) || CATEGORY_FALLBACKS[category];

  const columns = useMemo<DataTableColumns<MpAsset, unknown>>(
    () => [
      {
        accessorKey: "description",
        header: t("mp_assets_col_description") || "Type / description",
        cell: ({ row }) => row.original.description ?? "—",
      },
      {
        id: "location",
        hidden: !(isRealEstate || isVehicle),
        header: isRealEstate
          ? t("mp_assets_col_location") || "Location"
          : t("mp_assets_col_brand") || "Brand",
        accessorFn: (row) =>
          isRealEstate
            ? [row.location, row.municipality].filter(Boolean).join(" · ")
            : row.detail,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {isRealEstate
              ? [row.original.location, row.original.municipality]
                  .filter(Boolean)
                  .join(" · ") || "—"
              : (row.original.detail ?? "—")}
          </span>
        ),
      },
      {
        accessorKey: "areaSqm",
        hidden: !isRealEstate,
        header: t("mp_assets_col_area") || "Area (m²)",
        sortUndefined: "last",
        cell: ({ row }) => (
          <div className="text-right tabular-nums">
            {row.original.areaSqm ?? "—"}
          </div>
        ),
      },
      {
        accessorKey: "acquiredYear",
        header: t("mp_assets_col_year") || "Year",
        sortUndefined: "last",
        cell: ({ row }) => (
          <div className="text-right text-xs tabular-nums">
            {row.original.acquiredYear ?? "—"}
          </div>
        ),
      },
      {
        accessorKey: "holderName",
        header: t("mp_assets_col_holder") || "Holder",
        cell: ({ row }) => (
          <span className="text-xs">
            {row.original.holderName ? (
              <>
                {row.original.holderName}
                {row.original.isSpouse && (
                  <span className="ml-1 italic text-muted-foreground">
                    ({t("mp_assets_spouse") || "spouse"})
                  </span>
                )}
              </>
            ) : (
              "—"
            )}
          </span>
        ),
      },
      {
        accessorKey: "share",
        header: t("mp_assets_col_share") || "Share",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="text-right text-xs">{row.original.share ?? "—"}</div>
        ),
      },
      {
        accessorKey: "amount",
        header: t("mp_assets_col_amount_original") || "Original",
        sortUndefined: "last",
        cell: ({ row }) => (
          <div className="text-right tabular-nums font-mono text-xs text-muted-foreground">
            {row.original.amount != null
              ? `${fmtNum(row.original.amount, lang)} ${row.original.currency ?? ""}`.trim()
              : "—"}
          </div>
        ),
      },
      {
        accessorKey: "valueEur",
        header: "€",
        sortUndefined: "last",
        cell: ({ row }) => (
          <div
            className={`text-right tabular-nums font-mono ${isDebt ? "text-red-600" : ""}`}
          >
            {row.original.valueEur != null
              ? formatEur(row.original.valueEur, lang)
              : "—"}
          </div>
        ),
      },
      {
        accessorKey: "legalBasis",
        header: t("mp_assets_col_legal_basis") || "Legal basis",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.legalBasis ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "fundsOrigin",
        header: t("mp_assets_col_origin") || "Origin of funds",
        enableSorting: false,
        cell: ({ row }) => (
          <span
            className="text-xs text-muted-foreground max-w-[280px] block"
            title={row.original.fundsOrigin ?? undefined}
          >
            {row.original.fundsOrigin ?? "—"}
          </span>
        ),
      },
    ],
    [t, isDebt, isRealEstate, isVehicle, lang],
  );

  return (
    <div className="mb-6">
      <div className="flex items-center gap-3 mb-2">
        <Icon
          className={`h-5 w-5 ${isDebt ? "text-red-600" : "text-muted-foreground"}`}
        />
        <h2 className="text-base font-semibold">{categoryTitle}</h2>
        <span className="text-xs text-muted-foreground">
          · {rows.length}{" "}
          {rows.length === 1
            ? t("mp_assets_item") || "item"
            : t("mp_assets_items") || "items"}
        </span>
        <span
          className={`ml-auto font-mono tabular-nums ${isDebt ? "text-red-600" : ""}`}
        >
          {totalEur > 0 ? formatEur(totalEur, lang) : "—"}
        </span>
      </div>
      <DataTable<MpAsset, unknown>
        title={categoryTitle}
        pageSize={25}
        columns={columns}
        data={rows}
      />
    </div>
  );
};

const IncomeTable: FC<{ decl: MpDeclaration; lang: string }> = ({
  decl,
  lang,
}) => {
  const { t } = useTranslation();
  const rows = decl.income.filter(
    (r) => (r.amountEurDeclarant ?? 0) !== 0 || (r.amountEurSpouse ?? 0) !== 0,
  );
  if (rows.length === 0) return null;
  const totalDecl = rows.reduce((s, r) => s + (r.amountEurDeclarant ?? 0), 0);
  const totalSpouse = rows.reduce((s, r) => s + (r.amountEurSpouse ?? 0), 0);
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
          {formatEur(totalDecl + totalSpouse, lang)}
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
                {t("mp_income_declarant") || "Declarant"} (€)
              </th>
              <th className="text-right font-normal px-3 py-2">
                {t("mp_income_spouse") || "Spouse"} (€)
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
                  {fmtNum(r.amountEurDeclarant, lang)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-mono">
                  {fmtNum(r.amountEurSpouse, lang)}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 font-semibold">
              <td />
              <td className="px-3 py-2">{t("total") || "Total"}</td>
              <td className="px-3 py-2 text-right tabular-nums font-mono">
                {fmtNum(totalDecl, lang)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums font-mono">
                {fmtNum(totalSpouse, lang)}
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
  const { canonical } = useResolvedCandidate(id);
  const { isEn, nameForBg } = useCandidateName();
  const fallback =
    id && !id.startsWith("mp-") && !id.startsWith("c-")
      ? decodeURIComponent(id)
      : "";
  const lookupName = canonical?.name ?? fallback;
  const displayName = canonical
    ? isEn
      ? canonical.name_en
      : canonical.name
    : nameForBg(lookupName);
  const { t, i18n } = useTranslation();
  const { rollup } = useMpAssets(lookupName);
  const { declarations } = useMpDeclarations(lookupName);

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
        <Title>{displayName}</Title>
        <div className="text-sm text-muted-foreground">
          {t("mp_assets_no_data") ||
            "No declared assets data for this candidate."}
        </div>
      </div>
    );
  }

  const subtitle = `${t("mp_assets_title") || "Declared assets"} · ${
    rollup.fiscalYear
      ? `${t("fiscal_year") || "fiscal year"} ${rollup.fiscalYear}`
      : rollup.latestDeclarationYear
  }`;

  return (
    <div className="w-full space-y-4 px-3 py-3">
      <CandidateHeader
        displayName={displayName}
        lookupName={lookupName}
        cikRows={canonical?.cikRows}
        backTo={`/candidate/${id ?? encodeURIComponent(lookupName)}`}
        subtitle={subtitle}
        seoDescription={`${t("mp_assets_page_title") || "Declared assets"} · ${displayName}`}
      />

      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2 mb-6 mt-4">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("mp_assets_total") || "Total assets"}
          </div>
          <div className="text-2xl font-bold tabular-nums">
            {formatEur(rollup.totalAssetsEur, lang)}
          </div>
        </div>
        {rollup.totalDebtsEur > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("mp_assets_debts") || "Debts"}
            </div>
            <div className="text-lg font-semibold tabular-nums text-red-600">
              −{formatEur(rollup.totalDebtsEur, lang)}
            </div>
          </div>
        )}
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("mp_assets_net_worth") || "Net worth"}
          </div>
          <div className="text-2xl font-bold tabular-nums">
            {formatEur(rollup.netWorthEur, lang)}
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
