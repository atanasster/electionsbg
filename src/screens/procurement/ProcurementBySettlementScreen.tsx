// /procurement/by-settlement — landing page that lists every settlement
// with at least one local-tier contract on file, plus a "national
// procurement" card for the central tier (ministries, state agencies,
// national state companies) whose Sofia HQ is *not* a meaningful proxy
// for where the contract was spent.
//
// Methodology lives in procurement_by_settlement() (migration 030) and is described on the
// About page — see also [[project_procurement_geo]].
//
// SERVED FROM POSTGRES, per pscope. The page used to download one ~196 KB blob carrying
// every settlement and then paginate, sort, search and re-aggregate it in the browser (plus,
// in English, a 940 KB EKATTE master just to localise the names). Now:
//   - the ranking is a server-paginated DbDataTable over procurement_settlement_rank (119),
//     which also does the sorting and the shliokavica search;
//   - the maps + KPI header read one precomputed ≤32-row payload (useProcurementGeo).
// Both are keyed by the scope the user selected, so the DEFAULT view (a single parliament)
// is a primary-key seek rather than the ~390 ms live aggregate it used to be.

import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  Building2,
  MapPin,
  Banknote,
  Download,
  ArrowRight,
  X,
} from "lucide-react";
import { Title } from "@/ux/Title";
import { Card, CardContent } from "@/ux/Card";
import { Button } from "@/components/ui/button";
import { DbDataTable } from "@/ux/data_table/DbDataTable";
import type { DataTableColumnDef } from "@/ux/data_table/utils";
import { useProcurementGeo } from "@/data/procurement/useProcurementGeo";
import { useScopeWindow } from "@/data/scope/useScopeWindow";
import {
  provinceToCanon,
  featureToCanon,
} from "@/data/procurement/useProcurementByOblast";
import regions from "@/data/json/regions.json";
import { ProcurementChoroplethTile } from "@/screens/components/procurement/ProcurementChoroplethTile";
import { ProcurementSectionHeader } from "@/screens/components/procurement/ProcurementSectionHeader";

const eurFmt = new Intl.NumberFormat("bg-BG", { maximumFractionDigits: 0 });
const countFmt = new Intl.NumberFormat("bg-BG");

// A single buyer accounting for the whole total is the norm for small towns
// (≈62% of settlements), so it's only worth flagging when the total is large
// enough to be surprising — e.g. Ковачево (€1.6B, one state-company HQ in a
// village). Below this it's just a town hall procuring for its own commune.
const SINGLE_BUYER_FLAG_EUR = 50_000_000;

// Average contract value is meaningless with a tiny denominator (a one-contract
// village would top the ranking with a fake "average"), so we only compute it
// for settlements with at least this many contracts. ~39% fall below the bar.
const AVG_MIN_CONTRACTS = 5;

// Oblast Bulgarian-name → English, via the shared oblast reference. Keyed by
// the canonical bucket code so all the province-name quirks (София→SFO,
// Пловдив→PDV-00→PDV, София (столица)→SOFIA_CITY) resolve exactly like the
// choropleth does through provinceToCanon.
const OBLAST_EN_BY_CANON = new Map<string, string>();
for (const r of regions as Array<{ name_en?: string; oblast: string }>) {
  if (r.name_en) OBLAST_EN_BY_CANON.set(featureToCanon(r.oblast), r.name_en);
}
OBLAST_EN_BY_CANON.set("SOFIA_CITY", "Sofia (capital)");

const provinceEnOf = (bg: string): string => {
  const canon = provinceToCanon(bg);
  return (canon && OBLAST_EN_BY_CANON.get(canon)) || bg;
};

/** One row of procurement_settlement_rank, camelCased by the table engine. */
type SettlementRow = {
  ekatte: string;
  name: string;
  nameEn: string | null;
  province: string;
  obshtina: string;
  totalEur: number;
  contractCount: number;
  awarderCount: number;
};

/** Mean contract value, or undefined when the sample is too thin to average. */
const avgContractEur = (s: SettlementRow): number | undefined =>
  s.contractCount >= AVG_MIN_CONTRACTS
    ? s.totalEur / s.contractCount
    : undefined;

export const ProcurementBySettlementScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language !== "bg";
  const { scopeKey } = useScopeWindow();
  const geo = useProcurementGeo();
  const summary = geo.data?.summary;

  const [oblast, setOblast] = useState<{ code: string; name: string } | null>(
    null,
  );
  const handleSelectOblast = (canon: string, name: string) =>
    setOblast((cur) => (cur?.code === canon ? null : { code: canon, name }));

  // Clicking an oblast on the map filters the table. The map speaks canonical oblast CODES
  // and the ranking stores province NAMES, so the selection is resolved to the set of names
  // that fold into that bucket — taken from the geo payload, which is the same list the map
  // itself was coloured from, rather than from a second name table that could disagree.
  const extraFilters = useMemo(() => {
    if (!oblast) return undefined;
    const names = (geo.data?.oblasti ?? [])
      .map((o) => o.province)
      .filter((p) => provinceToCanon(p) === oblast.code);
    // NEVER fall through to `undefined` while the pill claims a province: that would show
    // the ENTIRE ranking under a filter chip, which reads as "this oblast spent €49bn". If
    // no province folds to the selected bucket — the payload is still loading, the scope
    // changed, or that oblast has no rows in this window — filter on a sentinel that
    // matches nothing so the table honestly says "no results". An empty array is not an
    // option: the server drops empty `in` filters, which is the fail-open case again.
    return [{ id: "province", value: names.length ? names : ["\u0000"] }];
  }, [oblast, geo.data]);

  // A pill must not outlive the data it was chosen from. Switching pscope replaces the
  // whole geo payload, and an oblast with no settlements in the new window would otherwise
  // leave a filter chip pinned to a bucket that no longer exists.
  useEffect(() => setOblast(null), [scopeKey]);

  // The magnitude bar's denominator is the largest total in the CURRENT filtered set, which
  // only the server knows — it comes back as a `max` aggregate alongside the page.
  const [maxEur, setMaxEur] = useState(0);
  // The exact request that produced the current page, kept so "Download CSV" can re-issue
  // it at a larger pageSize. Without it the export would silently drop the user's search.
  const lastRequest = useRef<Record<string, unknown> | null>(null);
  const onData = useCallback(
    (
      resp: { aggregates: Record<string, number> },
      request: Record<string, unknown>,
    ) => {
      setMaxEur(resp.aggregates?.maxTotalEur ?? 0);
      lastRequest.current = request;
    },
    [],
  );

  const nameOf = (s: SettlementRow) => (isEn ? (s.nameEn ?? s.name) : s.name);
  const provinceOf = (bg: string) => (isEn ? provinceEnOf(bg) : bg);

  // Export the current filtered+sorted result set — every row, not just the visible page.
  // Semicolon-delimited to match the project's other CSVs and so Bulgarian Excel doesn't
  // split on the comma in numbers.
  const [exporting, setExporting] = useState(false);
  const downloadCsv = async () => {
    if (!lastRequest.current || exporting) return;
    setExporting(true);
    try {
      const r = await fetch(
        `/api/db/table?q=${encodeURIComponent(
          JSON.stringify({ ...lastRequest.current, page: 0, pageSize: 1000 }),
        )}`,
      );
      if (!r.ok) return;
      const { rows } = (await r.json()) as { rows: SettlementRow[] };
      const cols = [
        "EKATTE",
        t("procurement_settlement_col_name") || "Settlement",
        t("procurement_settlement_col_municipality") || "Municipality",
        t("procurement_settlement_col_province") || "Province",
        t("procurement_settlement_col_eur") || "Total EUR",
        t("procurement_settlement_col_contracts") || "Contracts",
        t("procurement_settlement_col_buyers") || "Buyers",
        t("procurement_settlement_col_avg") || "Avg contract EUR",
      ];
      const esc = (v: string) =>
        /[";\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
      const lines = [cols.join(";")];
      for (const s of rows) {
        const avg = avgContractEur(s);
        lines.push(
          [
            s.ekatte,
            esc(nameOf(s)),
            esc(s.obshtina),
            esc(provinceOf(s.province)),
            Math.round(s.totalEur),
            s.contractCount,
            s.awarderCount,
            avg != null ? Math.round(avg) : "",
          ].join(";"),
        );
      }
      const blob = new Blob(["﻿" + lines.join("\n")], {
        type: "text/csv;charset=utf-8;",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `procurement-by-settlement-${scopeKey.replace(/[:]/g, "-")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const columns = useMemo<DataTableColumnDef<SettlementRow, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("procurement_settlement_col_name") || "Settlement",
        cell: ({ row }) => {
          const s = row.original;
          const singleBuyer =
            s.awarderCount === 1 && s.totalEur >= SINGLE_BUYER_FLAG_EUR;
          return (
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <Link
                to={`/procurement/settlement/${s.ekatte}`}
                className="font-medium hover:underline"
              >
                {nameOf(s)}
              </Link>
              {singleBuyer && (
                <span
                  className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-amber-700 dark:text-amber-400"
                  title={
                    t("procurement_settlement_single_buyer_tip") ||
                    "The entire amount comes from a single buyer (often a state-company HQ)."
                  }
                >
                  {t("procurement_settlement_single_buyer") || "1 buyer"}
                </span>
              )}
            </span>
          );
        },
      },
      {
        accessorKey: "province",
        header: t("procurement_settlement_col_province") || "Province",
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {provinceOf(row.original.province)}
          </span>
        ),
      },
      {
        accessorKey: "total_eur",
        header: t("procurement_settlement_col_eur") || "Total EUR",
        className: "text-right tabular-nums",
        cell: ({ row }) => {
          // sqrt keeps small towns visible without Sofia swamping everything.
          const pct =
            maxEur > 0
              ? Math.max(2, Math.sqrt(row.original.totalEur / maxEur) * 100)
              : 0;
          return (
            <div className="relative">
              <div
                className="absolute inset-y-0 right-0 rounded-sm bg-primary/15"
                style={{ width: `${pct}%` }}
                aria-hidden
              />
              <span className="relative">
                €{eurFmt.format(Math.round(row.original.totalEur))}
              </span>
            </div>
          );
        },
      },
      {
        accessorKey: "contract_count",
        header: t("procurement_settlement_col_contracts") || "Contracts",
        className: "text-right tabular-nums hidden sm:table-cell",
        cell: ({ row }) => countFmt.format(row.original.contractCount),
      },
      {
        id: "avg",
        header: t("procurement_settlement_col_avg") || "Avg contract",
        // Not sortable: the average is derived per row, so the server cannot order by it
        // without materialising a column. Suppressed below the sample bar either way.
        enableSorting: false,
        className: "text-right tabular-nums hidden lg:table-cell",
        cell: ({ row }) => {
          const avg = avgContractEur(row.original);
          return avg == null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            `€${eurFmt.format(Math.round(avg))}`
          );
        },
      },
      {
        accessorKey: "awarder_count",
        header: t("procurement_settlement_col_buyers") || "Buyers",
        className: "text-right tabular-nums hidden md:table-cell",
        cell: ({ row }) => countFmt.format(row.original.awarderCount),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, isEn, maxEur],
  );

  const localShareOfMoney =
    summary && summary.totalEur + summary.national.totalEur > 0
      ? summary.totalEur / (summary.totalEur + summary.national.totalEur)
      : 0;

  return (
    <div>
      <Title>
        {t("procurement_settlement_title") || "Procurement by settlement"}
      </Title>
      <ProcurementSectionHeader
        current="procurement_by_settlement_nav"
        scopeMode="toggle"
      />

      <p className="mb-6 text-sm text-muted-foreground leading-relaxed">
        {t("procurement_settlement_intro_p1") ||
          'Every signed contract published on the central procurement register (АОП) is pinned to the buyer\'s headquarters. We exclude central ministries, state agencies and nationally-operating state companies — their Sofia HQ tells you nothing about where the contract was spent — and aggregate them separately under "National procurement".'}
      </p>

      {/* KPI strip */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" />
              {t("procurement_settlement_kpi_settlements") || "Settlements"}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {summary ? countFmt.format(summary.settlementCount) : "—"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" />
              {t("procurement_settlement_kpi_contracts") || "Local contracts"}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {summary ? countFmt.format(summary.totalContracts) : "—"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              <Banknote className="h-3.5 w-3.5" />
              {t("procurement_settlement_kpi_local_eur") || "Local total"}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {summary
                ? `€${eurFmt.format(Math.round(summary.totalEur))}`
                : "—"}
            </div>
            {summary ? (
              <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                {(localShareOfMoney * 100).toFixed(1)}%{" "}
                {t("procurement_settlement_of_total") || "of total spending"}
              </div>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" />
              {t("procurement_settlement_kpi_national_eur") || "National total"}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {summary
                ? `€${eurFmt.format(Math.round(summary.national.totalEur))}`
                : "—"}
            </div>
            {summary ? (
              <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                {countFmt.format(summary.national.contractCount)}{" "}
                {t("procurement_settlement_contracts") || "contracts"}
                {" · "}
                {countFmt.format(summary.national.awarderCount)}{" "}
                {t("procurement_settlement_buyers") || "buyers"}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <ProcurementChoroplethTile
        activeOblast={oblast}
        onSelectOblast={handleSelectOblast}
      />

      {oblast && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setOblast(null)}
            className="inline-flex items-center gap-1.5 rounded-full border border-primary bg-primary/10 px-2.5 py-1 text-primary hover:bg-primary/20"
          >
            <span className="text-muted-foreground">
              {t("procurement_settlement_col_province") || "Province"}:
            </span>
            <span className="font-medium">{oblast.name}</span>
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      <DbDataTable<SettlementRow>
        resource="procurement_settlements"
        columns={columns}
        // The ranking fans out over pscope windows — one row per settlement PER scope — so
        // this scope is what keeps the table showing a single period.
        scope={{ col: "scope_key", val: scopeKey }}
        extraFilters={extraFilters}
        defaultSort={[{ id: "total_eur", desc: true }]}
        pageSize={50}
        searchPlaceholder={
          t("procurement_settlement_search") ||
          "Search settlement, municipality, province…"
        }
        onData={onData}
        toolbar={
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 px-2.5"
            onClick={downloadCsv}
            disabled={exporting}
          >
            <Download className="h-3.5 w-3.5" />
            {t("procurement_settlement_export_csv") || "Download CSV"}
          </Button>
        }
      />

      <p className="mt-3 text-xs text-muted-foreground">
        {t("procurement_settlement_table_note") ||
          "“1 buyer” marks settlements whose entire total comes from a single buyer. Average contract value is shown only for settlements with at least 5 contracts."}
      </p>

      <p className="mt-3 text-xs text-muted-foreground">
        {t("procurement_settlement_footnote") ||
          "Buyer HQ is the location proxy. Schools, hospitals, municipalities, universities, regional government offices, forestry districts and local utilities are pinned to their HQ. National procurement (ministries, central agencies, national state companies) is rolled up separately."}{" "}
        <Link to="/about" className="underline hover:no-underline">
          {t("procurement_settlement_methodology_link") ||
            "Read the methodology"}
        </Link>
        .
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {i18n.language === "bg" ? "Източник: " : "Source: "}
        <a
          href="https://data.egov.bg/data/resourceView/3ec550fc-4058-445c-b938-cb21b6d1b0f3"
          target="_blank"
          rel="noopener noreferrer"
          className="underline inline-flex items-center gap-0.5 hover:no-underline"
        >
          data.egov.bg АОП OCDS
          <ArrowRight className="inline h-3 w-3 -rotate-45" />
        </a>
      </p>
    </div>
  );
};
