// /declarations/crypto — every crypto holding declared to the Сметна палата, across every
// tier. Plan: docs/plans/declared-crypto-v1.md (T2).
//
// WHY IT IS ITS OWN PAGE. The holders are not one population — Борис Михайлов filed as
// изпълнителен директор of НАП, Мария Недина and Атанас Пеканов as служебен вицепремиери,
// two are MPs — so no existing leaderboard could hold them: /mp-cars and /mp-assets are
// MP-only, /officials/assets excludes MPs. Before this, comparing two declarants' crypto
// meant opening two profiles and expanding a filing on each.
//
// THE DEFAULT SCOPE IS „latest" AND THAT IS A CORRECTNESS PROPERTY, not a preference. A
// holding is re-declared on every filing that covers it, so the union of all filings
// double-counts by 19% — see 159's header. The toggle offers the history explicitly.

import { FC, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import { Title } from "@/ux/Title";
import { DeclarationsBreadcrumb } from "@/screens/components/DeclarationsBreadcrumb";
import { formatEur } from "@/lib/currency";
import { DbDataTable } from "@/ux/data_table/DbDataTable";
import type { DataTableColumnDef } from "@/ux/data_table/utils";
import type { CryptoHoldingRow } from "@/data/persons/useCryptoRegistry";

type Scope = "latest" | "all";

const DECL_TYPE_KEY: Record<string, string> = {
  Annualy: "pp_decl_type_annual",
  Entry: "pp_decl_type_entry",
  Vacate: "pp_decl_type_vacate",
  Other: "pp_decl_type_other",
};

export const CryptoRegistryScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "bg" ? "bg-BG" : "en-US";
  const [scope, setScope] = useState<Scope>("latest");

  const columns = useMemo<DataTableColumnDef<CryptoHoldingRow, unknown>[]>(
    () => [
      {
        id: "person_name",
        accessorFn: (r) => r.personName,
        header: t("crypto_col_person"),
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link
              to={`/person/${row.original.personSlug}`}
              className="hover:underline truncate block"
            >
              {row.original.personName}
            </Link>
            {row.original.institution && (
              <span className="block truncate text-xs text-muted-foreground">
                {row.original.institution}
              </span>
            )}
          </div>
        ),
      },
      {
        id: "detail",
        accessorFn: (r) => r.detail,
        header: t("crypto_col_asset"),
        enableSorting: false,
        cell: ({ row }) => {
          // The coin AS DECLARED, and the declarant's own label beneath it. Neither is
          // normalised: the corpus's `detail` values include „няма", „Е" and
          // „международен емитент", and folding those into a coin taxonomy would invent
          // an identification the filing does not carry. See the note in db_table.js.
          const { detail, description, quantityUnit } = row.original;
          const head = detail?.trim() || quantityUnit?.trim() || null;
          const sub = description?.trim();
          return (
            <div className="min-w-0">
              <span className="block truncate">
                {head ?? <span className="text-muted-foreground">—</span>}
              </span>
              {sub && sub !== head && (
                <span className="block truncate text-xs text-muted-foreground">
                  {sub}
                </span>
              )}
            </div>
          );
        },
      },
      {
        id: "quantity",
        accessorFn: (r) => r.quantity,
        header: t("crypto_col_quantity"),
        cell: ({ row }) => {
          const { quantity, quantityUnit } = row.original;
          if (quantity == null)
            return <span className="text-muted-foreground">—</span>;
          return (
            <span className="tabular-nums">
              {/* 8 decimals: 0.017 BTC is a real declared holding and the default
                  3-decimal grouping would still show it, but anything coarser rounds a
                  declared position to zero. */}
              {quantity.toLocaleString(locale, { maximumFractionDigits: 8 })}
              {quantityUnit ? ` ${quantityUnit}` : ` ${t("pp_decl_units")}`}
            </span>
          );
        },
      },
      {
        id: "period_year",
        accessorFn: (r) => r.periodYear,
        header: t("crypto_col_year"),
        cell: ({ row }) => (
          <span className="whitespace-nowrap">
            {row.original.periodYear}
            <span className="ml-1 text-xs text-muted-foreground">
              {t(
                DECL_TYPE_KEY[row.original.declarationType] ??
                  "pp_decl_type_other",
              )}
            </span>
          </span>
        ),
      },
      {
        id: "value_eur",
        accessorFn: (r) => r.valueEur,
        header: t("crypto_col_value"),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.valueEur != null
              ? formatEur(row.original.valueEur, locale)
              : "—"}
          </span>
        ),
      },
      {
        id: "is_spouse",
        accessorFn: (r) => r.isSpouse,
        header: t("crypto_col_holder"),
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.isSpouse
              ? t("pp_decl_spouse")
              : t("crypto_holder_self")}
          </span>
        ),
      },
      {
        id: "source",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <a
            href={row.original.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex text-primary hover:underline"
            aria-label="open declaration source"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        ),
      },
    ],
    [t, locale],
  );

  const scopeToggle = (
    <div className="flex flex-wrap items-center gap-2">
      {(["latest", "all"] as const).map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => setScope(s)}
          className={`rounded-full border px-3 py-1 text-xs ${
            scope === s
              ? "border-primary bg-primary text-primary-foreground"
              : "bg-card hover:bg-muted/40"
          }`}
        >
          {t(s === "latest" ? "crypto_scope_latest" : "crypto_scope_all")}
        </button>
      ))}
    </div>
  );

  return (
    <div data-og="crypto-registry-og" className="w-full">
      <Title description={t("crypto_page_description")}>
        {t("crypto_page_title")}
      </Title>
      <DeclarationsBreadcrumb currentKey="crypto_link_label" className="mt-5" />

      <DbDataTable<CryptoHoldingRow>
        resource="crypto_holdings"
        scope={{ col: "scope", val: scope }}
        columns={columns}
        defaultSort={[{ id: "value_eur", desc: true }]}
        pageSize={25}
        toolbar={scopeToggle}
        renderAggregates={(agg) => (
          <span className="text-xs text-muted-foreground">
            {/* Holdings and money only. A PEOPLE count is deliberately absent: the
                registry engine's aggregates are count/sum over ROWS, and a distinct-person
                count is not among them — printing `count` beside the word „декларатори"
                would state that four coins are four people. */}
            {t("crypto_page_summary", {
              total: Number(agg.count ?? 0),
              valued: Number(agg.countValueEur ?? 0),
              sum: formatEur(Number(agg.sumValueEur ?? 0), locale),
            })}
          </span>
        )}
      />

      <div className="mt-4 text-xs text-muted-foreground">
        {t("crypto_page_footer")}
      </div>
    </div>
  );
};
