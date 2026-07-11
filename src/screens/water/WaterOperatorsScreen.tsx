// /water/operators — the "see all" table behind the /water dashboard: every ВиК
// operator in the sector with its ЗОП procurement (scope-aware), single-bid share
// and EU-funds (ИСУН) contracted/paid/absorption, merged by EIK and sortable.
// Derived aggregate (not a raw DbDataTable resource): the two group-rollup calls
// the dashboard already uses, joined client-side. See docs/plans/water-view-v1.md
// §4.1c.

import { FC, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Droplets } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Title } from "@/ux/Title";
import { DataTable } from "@/ux/data_table/DataTable";
import { ProcurementSectionHeader } from "@/screens/components/procurement/ProcurementSectionHeader";
import { useVikGroupRollup, useVikFunds } from "@/data/procurement/useVik";
import { WATER_SECTOR_EIKS, operatorByEik } from "@/lib/vikReferenceData";
import { formatEurCompact } from "@/lib/currency";

interface OpRow {
  eik: string;
  name: string;
  oblast: string;
  procEur: number;
  contracts: number;
  singleBidShare: number | null;
  euContracted: number;
  euPaid: number;
}

export const WaterOperatorsScreen: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const { operators } = useVikGroupRollup(WATER_SECTOR_EIKS);
  const { funds } = useVikFunds(WATER_SECTOR_EIKS);

  const rows = useMemo<OpRow[]>(() => {
    const fundByEik = new Map(funds.map((f) => [f.eik, f]));
    const seen = new Set<string>();
    const out: OpRow[] = [];
    for (const o of operators) {
      seen.add(o.eik);
      const f = fundByEik.get(o.eik);
      out.push({
        eik: o.eik,
        name: o.name,
        oblast: o.oblast,
        procEur: o.totalEur,
        contracts: o.contractCount,
        singleBidShare: o.singleBidShare,
        euContracted: f?.contractedEur ?? 0,
        euPaid: f?.paidEur ?? 0,
      });
    }
    // Operators with EU funds but no in-scope procurement still belong here.
    for (const f of funds) {
      if (seen.has(f.eik)) continue;
      const op = operatorByEik(f.eik);
      out.push({
        eik: f.eik,
        name: op?.name ?? f.name,
        oblast: op?.oblast ?? f.oblast,
        procEur: 0,
        contracts: 0,
        singleBidShare: null,
        euContracted: f.contractedEur,
        euPaid: f.paidEur,
      });
    }
    return out.sort((a, b) => b.procEur - a.procEur);
  }, [operators, funds]);

  const columns = useMemo<ColumnDef<OpRow>[]>(
    () => [
      {
        id: "name",
        accessorFn: (r) => r.name,
        header: bg ? "Оператор" : "Operator",
        cell: ({ row }) => (
          <Link
            to={`/awarder/${row.original.eik}`}
            className="font-medium hover:text-primary hover:underline"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: "oblast",
        accessorFn: (r) => r.oblast,
        header: bg ? "Област" : "Oblast",
      },
      {
        id: "procEur",
        accessorFn: (r) => r.procEur,
        header: bg ? "Поръчки" : "Procurement",
        meta: { align: "right" },
        cell: ({ row }) => formatEurCompact(row.original.procEur, lang),
      },
      {
        id: "contracts",
        accessorFn: (r) => r.contracts,
        header: bg ? "Договори" : "Contracts",
        meta: { align: "right" },
      },
      {
        id: "singleBid",
        accessorFn: (r) => r.singleBidShare ?? -1,
        header: bg ? "Една оферта" : "Single-bid",
        meta: { align: "right" },
        cell: ({ row }) => {
          const s = row.original.singleBidShare;
          if (s == null) return "—";
          return (
            <span
              className={
                s >= 0.6
                  ? "text-red-600 dark:text-red-400"
                  : s >= 0.35
                    ? "text-amber-600 dark:text-amber-400"
                    : ""
              }
            >
              {Math.round(s * 100)}%
            </span>
          );
        },
      },
      {
        id: "euContracted",
        accessorFn: (r) => r.euContracted,
        header: bg ? "ЕС договорени" : "EU contracted",
        meta: { align: "right" },
        cell: ({ row }) =>
          row.original.euContracted > 0
            ? formatEurCompact(row.original.euContracted, lang)
            : "—",
      },
      {
        id: "absorption",
        accessorFn: (r) =>
          r.euContracted > 0 ? r.euPaid / r.euContracted : -1,
        header: bg ? "Усвоени" : "Absorbed",
        meta: { align: "right" },
        cell: ({ row }) => {
          const r = row.original;
          if (r.euContracted <= 0) return "—";
          const abs = r.euPaid / r.euContracted;
          return (
            <span
              className={abs < 0.25 ? "text-amber-600 dark:text-amber-400" : ""}
            >
              {Math.round(abs * 100)}%
            </span>
          );
        },
      },
    ],
    [bg, lang],
  );

  return (
    <div className="space-y-4">
      <Title
        description={
          bg
            ? "Всички ВиК оператори — обществени поръчки, конкуренция и европейски средства, по дружество."
            : "Every water operator — public procurement, competition and EU funds, by company."
        }
      >
        {bg ? "ВиК оператори" : "Water operators"}
      </Title>

      <div className="flex items-center gap-2 pt-1">
        <Droplets className="h-5 w-5 text-primary" />
        <Link to="/water" className="text-sm text-primary hover:underline">
          {bg ? "← Води (ВиК)" : "← Water (ВиК)"}
        </Link>
      </div>

      <ProcurementSectionHeader scopeMode="toggle" />

      <DataTable<OpRow, unknown>
        columns={columns}
        data={rows}
        pageSize={40}
        initialSort={[{ id: "procEur", desc: true }]}
        striped
      />

      <p className="text-[11px] text-muted-foreground/80">
        {bg
          ? "Поръчките и делът с една оферта следват избрания обхват (парламент/година); европейските средства (ИСУН) са за целия програмен период. Договори от АОП/ЦАИС ЕОП."
          : "Procurement and single-bid share follow the selected scope (parliament/year); EU funds (ИСУН) are programme-period totals. Contracts from АОП/ЦАИС ЕОП."}
      </p>
    </div>
  );
};
