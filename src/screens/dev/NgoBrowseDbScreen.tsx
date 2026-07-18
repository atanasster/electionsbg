// Global NGO (ЮЛНЦ) browser (/procurement/ngos), DB-fed. A server-side
// paginated/sorted/filtered DbDataTable over tr_companies scoped to the
// non-profit surface (сдружения/фондации/читалища + foreign branches) via a
// fixed entity_class filter. Rows deep-link to the company/NGO page. NGO board
// data flows from the same TR ingest — see docs/plans/ngo-final-implementation-plan.md.

import { FC, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { HeartHandshake, Building2, Landmark, Coins } from "lucide-react";
import { Title } from "@/ux/Title";
import { DbDataTable, type DbColumnFilter } from "@/ux/data_table/DbDataTable";
import type { DataTableColumnDef } from "@/ux/data_table/utils";
import { StatCard } from "../dashboard/StatCard";
import { ProcurementSectionHeader } from "@/screens/components/procurement/ProcurementSectionHeader";
import { formatEurCompact } from "@/lib/currency";
import { decodeEntities } from "@/lib/decodeEntities";
import {
  NgoSignalPills,
  NGO_SIGNAL_ORDER,
  NGO_SIGNAL_META,
  type NgoSignal,
} from "@/screens/components/procurement/NgoSignalPills";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ALL = "__all__";
// The NGO surface: сдружения, фондации, читалища. foreign_branch is excluded —
// the `ngos_list` view (migration 080) already drops it (mostly commercial bank
// branches that would dominate the public-money ranking).
const NGO_ENTITY_CLASSES = ["ngo_assoc", "ngo_found", "chitalishte"];

interface NgoRow {
  uic: string;
  name: string | null;
  entityClass: string | null;
  ngoType: string | null;
  seat: string | null;
  status: string | null;
  signals: NgoSignal[] | null;
  signalCount: number | null;
  publicMoneyEur: number | string | null;
}
interface NgoStats {
  assoc: number;
  found: number;
  chitalishte: number;
  foreign_branch: number;
  // bigint / numeric arrive over JSON as strings — coerce with Number().
  tr_companies: number | string;
  state_awarders: number;
  ngos_funded: number;
  external_eur: number | string;
}
const num = new Intl.NumberFormat("bg-BG");

const ENTITY_CLASS_LABEL: Record<string, { bg: string; en: string }> = {
  ngo_assoc: { bg: "Сдружение", en: "Association" },
  ngo_found: { bg: "Фондация", en: "Foundation" },
  chitalishte: { bg: "Читалище", en: "Community centre" },
  foreign_branch: { bg: "Чужд. клон", en: "Foreign branch" },
};

export const NgoBrowseDbScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const [ngoType, setNgoType] = useState<string>(ALL);
  const [signalCode, setSignalCode] = useState<string>(ALL);
  // Default view = only NGOs with ≥1 signal (the 8.5% that touch public/external
  // money); the tail would otherwise fill the browse in EIK order. Toggle to all.
  const [showAll, setShowAll] = useState(false);

  const fixedFilters = useMemo<DbColumnFilter[]>(
    () => [{ id: "entity_class", value: NGO_ENTITY_CLASSES }],
    [],
  );
  const extraFilters = useMemo<DbColumnFilter[]>(
    () => [
      ...(!showAll && signalCode === ALL
        ? [{ id: "has_signal", value: true } as DbColumnFilter]
        : []),
      ...(ngoType !== ALL
        ? [{ id: "ngo_type", value: [ngoType] } as DbColumnFilter]
        : []),
      ...(signalCode !== ALL
        ? [{ id: "signal_codes", value: signalCode } as DbColumnFilter]
        : []),
    ],
    [showAll, ngoType, signalCode],
  );

  // Registry-scale stat cards (one round-trip, ~14ms).
  const { data: stats } = useQuery({
    queryKey: ["db", "ngo-stats"],
    queryFn: async (): Promise<NgoStats | null> => {
      const r = await fetch("/api/db/ngo-stats");
      return r.ok ? r.json() : null;
    },
    staleTime: Infinity,
  });

  // ngo_type facet counts (over the NGO surface).
  const { data: facetData } = useQuery({
    queryKey: ["db-facets", "ngos"],
    queryFn: async (): Promise<{
      facets: Record<string, { value: string; count: number }[]>;
    }> => {
      const req = {
        resource: "ngos",
        fixedFilters,
        columns: ["ngo_type"],
        limit: 20,
      };
      const r = await fetch(
        `/api/db/facets?q=${encodeURIComponent(JSON.stringify(req))}`,
      );
      if (!r.ok) return { facets: {} };
      return r.json();
    },
    staleTime: Infinity,
  });
  const typeOptions = facetData?.facets?.ngo_type ?? [];

  const columns = useMemo<DataTableColumnDef<NgoRow, unknown>[]>(
    () => [
      {
        id: "name",
        accessorFn: (r) => r.name,
        header: bg ? "Организация" : "Organisation",
        cell: ({ row }) => (
          <Link
            to={`/company/${row.original.uic}`}
            className="text-sm hover:text-primary hover:underline"
          >
            {decodeEntities(row.original.name) || row.original.uic}
          </Link>
        ),
      },
      {
        id: "signals",
        accessorFn: (r) => r.signalCount,
        header: bg ? "Сигнали" : "Signals",
        enableSorting: false,
        cell: ({ row }) => (
          <NgoSignalPills signals={row.original.signals} maxVisible={4} />
        ),
      },
      {
        id: "public_money_eur",
        accessorFn: (r) => r.publicMoneyEur,
        header: bg ? "Публични средства" : "Public money",
        meta: { align: "right" },
        cell: ({ row }) => {
          const v = Number(row.original.publicMoneyEur ?? 0);
          return (
            <span className="text-sm tabular-nums text-muted-foreground">
              {v > 0 ? formatEurCompact(v, i18n.language) : "—"}
            </span>
          );
        },
      },
      {
        id: "entity_class",
        accessorFn: (r) => r.entityClass,
        header: bg ? "Вид" : "Type",
        cell: ({ row }) => {
          const c = row.original.entityClass ?? "";
          const l = ENTITY_CLASS_LABEL[c];
          return (
            <span className="text-sm text-muted-foreground">
              {l ? (bg ? l.bg : l.en) : c}
            </span>
          );
        },
      },
      {
        id: "ngo_type",
        accessorFn: (r) => r.ngoType,
        header: bg ? "Категория" : "Category",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.ngoType ? (
            <span className="text-sm text-muted-foreground">
              {t(`ngo_type_${row.original.ngoType}`, row.original.ngoType)}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "seat",
        accessorFn: (r) => r.seat,
        header: bg ? "Седалище" : "Seat",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground line-clamp-1 max-w-xs">
            {row.original.seat || "—"}
          </span>
        ),
      },
    ],
    [t, bg, i18n.language],
  );

  return (
    <>
      <Title description={t("ngo_browse_subtitle")}>
        {t("ngo_browse_title") || "Non-profit organisations"}
      </Title>
      <ProcurementSectionHeader current="procurement_ngos_nav" />
      <section aria-label="ngos" className="my-4">
        <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
          <HeartHandshake className="h-4 w-4 shrink-0" />
          {t("ngo_browse_subtitle")}
        </div>
        {stats && (
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label={bg ? "Организации (ЮЛНЦ)" : "Non-profits (NPOs)"}>
              <div className="flex items-baseline gap-2">
                <HeartHandshake className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="text-lg font-bold tabular-nums md:text-xl">
                  {num.format(stats.assoc + stats.found + stats.chitalishte)}
                </span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {bg
                  ? `${num.format(stats.assoc)} сдружения · ${num.format(stats.found)} фондации · ${num.format(stats.chitalishte)} читалища`
                  : `${num.format(stats.assoc)} associations · ${num.format(stats.found)} foundations · ${num.format(stats.chitalishte)} community centres`}
              </div>
            </StatCard>
            <StatCard
              label={
                bg
                  ? "Фирми в Търговския регистър"
                  : "Commerce Registry companies"
              }
            >
              <div className="flex items-baseline gap-2">
                <Building2 className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="text-lg font-bold tabular-nums md:text-xl">
                  {num.format(Number(stats.tr_companies))}
                </span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {bg
                  ? "цялата обща база на ТРРЮЛНЦ"
                  : "the full shared ТРРЮЛНЦ database"}
              </div>
            </StatCard>
            <StatCard
              label={bg ? "Държавни възложители" : "Government awarders"}
            >
              <div className="flex items-baseline gap-2">
                <Landmark className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="text-lg font-bold tabular-nums md:text-xl">
                  {num.format(stats.state_awarders)}
                </span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {bg
                  ? "институции, възлагащи обществени поръчки"
                  : "institutions awarding public contracts"}
              </div>
            </StatCard>
            <StatCard
              label={bg ? "Външно финансиране на НПО" : "NGO external funding"}
            >
              <div className="flex items-baseline gap-2">
                <Coins className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="text-lg font-bold tabular-nums md:text-xl">
                  {formatEurCompact(Number(stats.external_eur), i18n.language)}
                </span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {bg
                  ? `получено от ${num.format(stats.ngos_funded)} НПО (ЕС + субсидии)`
                  : `to ${num.format(stats.ngos_funded)} NGOs (EU + subsidies)`}
              </div>
            </StatCard>
          </div>
        )}
        <DbDataTable<NgoRow>
          resource="ngos"
          fixedFilters={fixedFilters}
          extraFilters={extraFilters}
          columns={columns}
          defaultSort={[{ id: "public_money_eur", desc: true }]}
          pageSize={25}
          searchPlaceholder={bg ? "Търси организация…" : "Search organisation…"}
          toolbar={
            <div className="flex flex-wrap items-center gap-2">
              {/* Signal-code filter — reuses the ngos_list signal_codes column. */}
              <Select value={signalCode} onValueChange={setSignalCode}>
                <SelectTrigger className="h-9 w-auto max-w-[220px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>
                    {bg ? "Всички сигнали" : "All signals"}
                  </SelectItem>
                  {NGO_SIGNAL_ORDER.map((code) => (
                    <SelectItem key={code} value={code}>
                      {t(
                        NGO_SIGNAL_META[code].short[0],
                        NGO_SIGNAL_META[code].short[1],
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {typeOptions.length > 0 && (
                <Select value={ngoType} onValueChange={setNgoType}>
                  <SelectTrigger className="h-9 w-auto max-w-[220px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>
                      {bg ? "Всички категории" : "All categories"}
                    </SelectItem>
                    {typeOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {t(`ngo_type_${o.value}`, o.value)} ({o.count})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {/* Show-all toggle — the default view hides the signal-less tail. */}
              {signalCode === ALL && (
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="h-9 rounded-md border px-3 text-sm text-muted-foreground hover:bg-muted"
                >
                  {showAll
                    ? bg
                      ? "Само със сигнали"
                      : "Only with signals"
                    : bg
                      ? "Покажи всички"
                      : "Show all"}
                </button>
              )}
            </div>
          }
        />
      </section>
    </>
  );
};

export default NgoBrowseDbScreen;
