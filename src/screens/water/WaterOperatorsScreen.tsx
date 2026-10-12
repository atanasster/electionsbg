// /water/operators — the "see all" table behind the /water dashboard: every ВиК
// operator in the sector with its ЗОП procurement (scope-aware), single-bid share
// and EU-funds (ИСУН) contracted/paid/absorption, merged by EIK and sortable.
// Derived aggregate (not a raw DbDataTable resource): the two group-rollup calls
// the dashboard already uses, joined client-side. See docs/plans/water-view-v1.md
// §4.1c.

import { FC, useMemo } from "react";
import { AwarderLink } from "@/screens/components/procurement/AwarderLink";
import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/ux/data_table/DataTable";
import { useVikGroupRollup, useVikFunds } from "@/data/procurement/useVik";
import { useWaterOperatorMap } from "@/data/water/useWaterOperatorMap";
import {
  WATER_SECTOR_EIKS,
  WATER_TYPE_LABEL,
  operatorByEik,
  operatorStatusLabel,
} from "@/lib/vikReferenceData";
import { isBg } from "@/i18n";
import { WaterOperatorMap } from "./WaterOperatorMap";
import { WaterPageFrame } from "./WaterPageFrame";
import { unpinnedOperators } from "./unpinnedOperators";
import { withRollupCounts } from "./pinCounts";
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
  /** Non-live status label, or null for a working operator (D6). */
  status: string | null;
  /** What kind of body this is — the register holds three that are not water
   *  operators (the holding parent, the irrigation and dams companies), so the
   *  table says which, rather than let a reader count them as operators. */
  kind: string;
}

export const WaterOperatorsScreen: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const {
    operators,
    isLoading: rollupLoading,
    isError: rollupError,
  } = useVikGroupRollup(WATER_SECTOR_EIKS);
  const { funds, isError: fundsError } = useVikFunds(WATER_SECTOR_EIKS);
  const {
    operators: mapRaw,
    isLoading: mapLoading,
    isError: mapError,
  } = useWaterOperatorMap();
  // F3: pins take the table's ex-member counts (see pinCounts.ts).
  const mapOperators = useMemo(
    () => withRollupCounts(mapRaw, operators),
    [mapRaw, operators],
  );

  const rows = useMemo<OpRow[]>(() => {
    const kindOf = (eik: string) => {
      const type = operatorByEik(eik)?.type;
      return type ? WATER_TYPE_LABEL[type][bg ? "bg" : "en"] : "";
    };
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
        status: operatorStatusLabel(operatorByEik(o.eik)?.status, bg),
        kind: kindOf(o.eik),
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
        status: operatorStatusLabel(op?.status, bg),
        kind: kindOf(f.eik),
      });
    }
    return out.sort((a, b) => b.procEur - a.procEur);
  }, [operators, funds, bg]);

  // D3: operators active in the window that the map cannot place.
  const unpinned = useMemo(
    () =>
      unpinnedOperators(
        operators,
        mapOperators.map((o) => o.eik),
        !mapLoading,
      ),
    [mapLoading, mapOperators, operators],
  );

  const columns = useMemo<ColumnDef<OpRow>[]>(
    () => [
      {
        id: "name",
        accessorFn: (r) => r.name,
        header: bg ? "Оператор" : "Operator",
        cell: ({ row }) => (
          <AwarderLink
            eik={row.original.eik}
            className="font-medium hover:text-primary hover:underline"
          >
            {row.original.name}
          </AwarderLink>
        ),
      },
      {
        id: "oblast",
        accessorFn: (r) => r.oblast,
        header: bg ? "Област" : "Oblast",
      },
      {
        id: "kind",
        accessorFn: (r) => r.kind,
        header: bg ? "Вид" : "Type",
      },
      {
        id: "status",
        accessorFn: (r) => r.status ?? "",
        header: bg ? "Статус" : "Status",
        cell: ({ row }) =>
          row.original.status ? (
            <span className="text-amber-700 dark:text-amber-400">
              {row.original.status}
            </span>
          ) : (
            ""
          ),
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
    <WaterPageFrame
      title={{ bg: "ВиК оператори", en: "Water operators" }}
      description={{
        bg: "Всички ВиК оператори — обществени поръчки, конкуренция и европейски средства, по дружество.",
        en: "Every water operator — public procurement, competition and EU funds, by company.",
      }}
      scoped
      ready={[mapOperators.length, rows.length]}
      status={{ isLoading: rollupLoading, isError: rollupError }}
    >
      {/* The map is a section of THIS page: the hub's „Карта" tile links #map. */}
      <section id="map" className="scroll-mt-20">
        {mapError ? (
          <p className="rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground">
            {bg
              ? "Картата на операторите не се зареди — таблицата по-долу съдържа всички оператори."
              : "The operator map failed to load — the table below lists every operator."}
          </p>
        ) : (
          <WaterOperatorMap operators={mapOperators} unpinned={unpinned} />
        )}
      </section>

      {fundsError ? (
        // The EU columns would otherwise read „—", i.e. „no EU funds".
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {bg
            ? "Европейските средства не се заредиха — колоните „ЕС“ са празни, а не нулеви."
            : "EU funds failed to load — the EU columns are empty, not zero."}
        </p>
      ) : null}
      <DataTable<OpRow, unknown>
        columns={columns}
        data={rows}
        pageSize={40}
        initialSort={[{ id: "procEur", desc: true }]}
        striped
      />

      <p className="text-[11px] text-muted-foreground/80">
        {bg
          ? "Поръчките и делът с една оферта следват избрания обхват (парламент/година); европейските средства (ИСУН) са за целия програмен период. Договори от АОП/ЦАИС ЕОП — без нулевите дялове на членовете в обединения."
          : "Procurement and single-bid share follow the selected scope (parliament/year); EU funds (ИСУН) are programme-period totals. Contracts from АОП/ЦАИС ЕОП — excluding consortium members' €0 shares."}
      </p>
    </WaterPageFrame>
  );
};
