// Sortable table of Bulgarian government debt emissions — Eurobonds and
// domestic ДЦК. Data is hand-curated in data/debt-emissions.json (the
// Ministry of Finance bulletin is WAF-blocked + PDF-only, and the BNB
// auction site only covers 2019+ for domestic). Refreshed manually as new
// emissions are announced.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/ux/data_table/DataTable";
import { DebtEmission, useDebtEmissions } from "@/data/macro/useDebtEmissions";
import { BGN_PER_EUR } from "@/lib/currency";

// Lookup of currency code → unicode symbol. Anything not listed falls back
// to the bare ISO code so we never silently drop a currency.
const CURRENCY_SYMBOL: Record<string, string> = {
  EUR: "€",
  USD: "$",
  GBP: "£",
  CHF: "CHF ",
};

const fmtPrincipal = (currency: string, principalMillion: number): string => {
  // Euro since 2026-01-01: redenominate BGN (domestic ДЦК) principals to EUR at
  // the locked peg so nothing shows in leva.
  if (currency === "BGN") {
    principalMillion /= BGN_PER_EUR;
    currency = "EUR";
  }
  const sym = CURRENCY_SYMBOL[currency] ?? `${currency} `;
  // Billions when ≥ 1000 million; millions otherwise. Two decimals on bn
  // to keep €2.25bn legible; zero decimals on small T-bill auctions.
  if (principalMillion >= 1000) {
    return `${sym}${(principalMillion / 1000).toFixed(2)}bn`;
  }
  return `${sym}${principalMillion.toLocaleString(undefined, {
    maximumFractionDigits: 0,
  })}M`;
};

const fmtDate = (iso: string | undefined, lang: "en" | "bg"): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(lang === "bg" ? "bg-BG" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const MarketBadge: FC<{ market: DebtEmission["market"] }> = ({ market }) => {
  const { t } = useTranslation();
  // International gets the warmer/foreign tone; domestic gets the muted tone.
  const cls =
    market === "international"
      ? "bg-violet-200/60 dark:bg-violet-800/40 text-violet-900 dark:text-violet-100"
      : "bg-emerald-200/60 dark:bg-emerald-800/40 text-emerald-900 dark:text-emerald-100";
  const label =
    market === "international"
      ? t("debt_market_international")
      : t("debt_market_domestic");
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${cls}`}
    >
      {label}
    </span>
  );
};

export const DebtEmissionsTable: FC = () => {
  const { t, i18n } = useTranslation();
  const { data, isLoading } = useDebtEmissions();
  const lang: "en" | "bg" = i18n.language === "bg" ? "bg" : "en";

  const columns = useMemo<ColumnDef<DebtEmission>[]>(
    () => [
      {
        id: "issueDate",
        accessorFn: (row) => row.issueDate,
        header: t("debt_col_issue_date"),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {fmtDate(row.original.issueDate, lang)}
          </span>
        ),
      },
      {
        id: "market",
        accessorFn: (row) => row.market,
        header: t("debt_col_market"),
        cell: ({ row }) => <MarketBadge market={row.original.market} />,
      },
      {
        id: "title",
        accessorFn: (row) => (lang === "bg" ? row.titleBg : row.titleEn),
        header: t("debt_col_instrument"),
        cell: ({ row }) => {
          const e = row.original;
          return (
            <div className="flex flex-col leading-tight">
              <span className="font-medium">
                {lang === "bg" ? e.titleBg : e.titleEn}
              </span>
              {e.isin || e.bnbEmissionNumber ? (
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {e.isin ?? e.bnbEmissionNumber}
                </span>
              ) : null}
            </div>
          );
        },
      },
      {
        id: "principal",
        accessorFn: (row) => row.principalMillion,
        header: t("debt_col_principal"),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {fmtPrincipal(row.original.currency, row.original.principalMillion)}
          </span>
        ),
        meta: { align: "right" },
      },
      {
        id: "couponPct",
        accessorFn: (row) => row.couponPct ?? null,
        header: t("debt_col_coupon"),
        cell: ({ row }) => {
          const c = row.original.couponPct;
          return (
            <span className="tabular-nums">
              {c === undefined ? "—" : `${c.toFixed(c >= 10 ? 1 : 3)}%`}
            </span>
          );
        },
        meta: { align: "right" },
      },
      {
        id: "settlementYieldPct",
        accessorFn: (row) => row.settlementYieldPct ?? null,
        header: t("debt_col_yield"),
        cell: ({ row }) => {
          const y = row.original.settlementYieldPct;
          return (
            <span className="tabular-nums">
              {y === undefined ? "—" : `${y.toFixed(3)}%`}
            </span>
          );
        },
        meta: { align: "right" },
      },
      {
        id: "termYears",
        accessorFn: (row) => row.termYears ?? null,
        header: t("debt_col_term"),
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.termYears ?? "—"}y</span>
        ),
        meta: { align: "right" },
      },
      {
        id: "maturityDate",
        accessorFn: (row) => row.maturityDate ?? "",
        header: t("debt_col_maturity"),
        cell: ({ row }) => (
          <span className="tabular-nums text-muted-foreground">
            {fmtDate(row.original.maturityDate, lang)}
          </span>
        ),
      },
    ],
    [t, lang],
  );

  if (isLoading || !data) {
    return (
      <div className="text-sm text-muted-foreground">
        {t("debt_loading") || "Loading…"}
      </div>
    );
  }

  return (
    <DataTable
      columns={columns}
      data={data.emissions}
      pageSize={15}
      initialSort={[{ id: "issueDate", desc: true }]}
    />
  );
};
