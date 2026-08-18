// /subsidies/recipients — the full ranked list of companies that received farm money.
//
// Replaces the hub's inline top-25 table (docs/plans/subsidies-hub-v1.md §6). It ranks
// ALL 16,701 EIK-bearing recipients for the chosen scope, not the 60 the overview
// payload carries, off `agri_beneficiary_year` (migration 046) — a (scope × EIK)
// rollup whose covering index makes the page walk 52 buffers instead of aggregating
// 2.48M rows per request.
//
// ═══════════════════════════════════════════════════════════════════════════════════
// THIS RANKS COMPANIES, AND ROUGHLY HALF THE MONEY IS NOT HERE.
//
// A recipient with no ЕИК cannot be ranked: the register publishes them as name +
// oblast with no stable id, so merging two „Иван Иванов, Пловдив" rows would be a
// namesake guess and splitting them understates. Corpus-wide that is €4.39bn — 39.8%
// of everything paid, and 49.3% in 2025 — which is not a footnote to a ranking, it is
// the other half of it. The page says so above the table and links to the page that
// is about it.
//
// The paying agency itself (ДФ „Земеделие", ЕИК 121100421) is excluded upstream in the
// matview: its „subsidies" are technical assistance and public storage, not farm money
// received, and it has no /farm page to land on.
// ═══════════════════════════════════════════════════════════════════════════════════

import { type FC, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { DbDataTable } from "@/ux/data_table/DbDataTable";
import type { DataTableColumnDef } from "@/ux/data_table/utils";
import { AgriScopePicker, AgriScopeFallback } from "./AgriScopeGate";
import { useAgriScope, agriScopedHref } from "@/data/agri/useAgriScope";
import { agriScopeToKey } from "@/data/agri/constants";
import { formatEur } from "@/lib/currency";

// CAMELCASE, and `paymentCount` is a STRING. The table route serialises row keys
// through snakeToCamel and returns bigint columns as text (node-postgres does not
// coerce int8) — the same shape SubsidiesBrowserDbScreen's SubsidyRow uses. Column
// `id`s stay snake_case: those address the SQL side, for sorting and filtering.
/** Exported so the page's test cannot re-declare it and drift — `paymentCount` is a
 *  STRING on the wire and a fixture that says `number` is a shape the route never sends. */
export interface RecipientRow {
  eik: string;
  name: string;
  oblast: string | null;
  paymentCount: string | number;
  totalEur: number;
}

export const SubsidiesRecipientsScreen: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const L = i18n.language;
  const [params] = useSearchParams();
  const gate = useAgriScope();
  const { scope, data } = gate;

  // The SAME resolution the hub and the ranking's own matview use. `null` means the
  // corpus has no such scope: the table is not asked for a partition that cannot
  // exist, and the page says which years do.
  const scopeKey = agriScopeToKey(scope);

  const columns = useMemo<DataTableColumnDef<RecipientRow, unknown>[]>(
    () => [
      {
        id: "name",
        accessorFn: (r) => r.name,
        header: bg ? "Получател" : "Recipient",
        cell: ({ row }) => (
          <Link
            to={`/farm/${row.original.eik}`}
            className="font-medium hover:underline"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: "oblast",
        accessorFn: (r) => r.oblast,
        header: bg ? "Област" : "Province",
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.oblast || "—"}
          </span>
        ),
      },
      {
        id: "payment_count",
        accessorFn: (r) => Number(r.paymentCount),
        header: bg ? "Плащания" : "Payments",
        meta: { align: "right" },
        cell: ({ row }) => (
          <span className="tabular-nums">
            {Number(row.original.paymentCount).toLocaleString(
              bg ? "bg-BG" : "en-US",
            )}
          </span>
        ),
      },
      {
        id: "total_eur",
        accessorFn: (r) => r.totalEur,
        header: bg ? "Изплатено" : "Paid",
        meta: { align: "right" },
        cell: ({ row }) => (
          <span className="whitespace-nowrap font-medium tabular-nums">
            {formatEur(row.original.totalEur, L)}
          </span>
        ),
      },
    ],
    [bg, L],
  );

  const title = bg ? "Най-големи получатели" : "Largest recipients";
  const description = bg
    ? "Класация на фирмите, получили земеделски субсидии от ДФ „Земеделие“ — за избрана финансова година или за целия период."
    : "A ranking of the companies that received State Fund Agriculture farm subsidies — for one financial year or the whole period.";

  const scopeLabel = data?.scopeYear
    ? (bg ? "Финансова година " : "Financial year ") + data.scopeYear
    : bg
      ? "Всички години"
      : "All years";

  return (
    <>
      <Title description={description}>{title}</Title>
      <GovernanceBreadcrumb
        sectionKey="agri_subsidies_nav"
        sectionTo="/subsidies"
        currentKey="subsidies_recipients_nav"
        className="mt-5"
      />
      <section aria-label={title} className="my-4">
        <p className="mb-2 max-w-3xl text-sm text-muted-foreground">
          {bg
            ? "Всяка фирма с ЕИК, получила плащане от ДФ „Земеделие“ през избрания период, подредена по изплатена сума. Кликни име, за да видиш историята на стопанството."
            : "Every company with an ЕИК that received a payment from the State Fund Agriculture in the selected period, ordered by amount. Click a name for that farm's history."}
        </p>
        {/* The denominator this ranking is missing, stated ABOVE it rather than in a
            footnote — 39.8% of the corpus and 49.3% of 2025 sits on rows with no ЕИК
            and cannot be ranked at all. */}
        <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
          {bg ? (
            <>
              Класацията обхваща само получателите с ЕИК. Около 40% от
              изплатените пари стоят на редове без такъв и не могат да бъдат
              приписани на получател —{" "}
              <Link
                to={agriScopedHref("/subsidies/untraceable", params)}
                className="text-primary hover:underline"
              >
                вижте колко са
              </Link>
              .
            </>
          ) : (
            <>
              The ranking covers recipients with an ЕИК only. Roughly 40% of the
              money paid sits on rows without one and cannot be attributed to a
              recipient —{" "}
              <Link
                to={agriScopedHref("/subsidies/untraceable", params)}
                className="text-primary hover:underline"
              >
                see how much
              </Link>
              .
            </>
          )}
        </p>

        <AgriScopePicker className="mb-3" />

        <AgriScopeFallback gate={gate}>
          {scopeKey !== null && (
            <div data-og="subsidies-recipients">
              <p className="mb-2 text-xs text-muted-foreground">{scopeLabel}</p>
              <DbDataTable<RecipientRow>
                resource="agri_recipients"
                columns={columns}
                // Through `scope`, NOT extraFilters. The resource declares
                // defaultScope { scope_key: 'all' } to stop an unscoped request
                // unioning every partition, and buildWhere ANDs a same-column
                // extraFilter with that default — so the two contradict and the
                // table renders „Няма резултати" for every year but 'all'.
                scope={{ col: "scope_key", val: scopeKey }}
                defaultSort={[{ id: "total_eur", desc: true }]}
                searchPlaceholder={
                  bg ? "търси получател…" : "search recipient…"
                }
              />
            </div>
          )}
        </AgriScopeFallback>
      </section>
    </>
  );
};
