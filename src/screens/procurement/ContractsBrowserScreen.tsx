// /procurement/contracts — the faceted all-contracts browser (SIGMA's Договори
// parity, static-SPA flavour). Year is the first facet (one shard loaded on
// demand); sector / procedure / value / EU filter client-side; DataTable gives
// sort + pagination + CSV + text search. Filters live in the URL (shareable).

import { FC, useMemo, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Title } from "@/ux/Title";
import { DataTable } from "@/ux/data_table/DataTable";
import { ProcurementNav } from "../components/procurement/ProcurementNav";
import {
  useContractIndexMeta,
  useContractYear,
  type ContractRow,
} from "@/data/procurement/useContractBrowser";
import {
  CPV_DIVISION,
  cpvDivisionName,
  procedureLabel,
  PROCEDURE_LABEL,
  type ProcedureBucket,
} from "@/lib/cpvSectors";
import { formatEur } from "@/lib/currency";

const VALUE_BUCKETS: Record<string, [number, number]> = {
  "0": [0, 1e5],
  "1": [1e5, 1e6],
  "2": [1e6, 1e7],
  "3": [1e7, 1e8],
  "4": [1e8, Infinity],
};
const VALUE_LABEL: Record<string, { bg: string; en: string }> = {
  "0": { bg: "под 100 хил. €", en: "under €100k" },
  "1": { bg: "100 хил. – 1 млн. €", en: "€100k – 1M" },
  "2": { bg: "1 – 10 млн. €", en: "€1 – 10M" },
  "3": { bg: "10 – 100 млн. €", en: "€10 – 100M" },
  "4": { bg: "над 100 млн. €", en: "over €100M" },
};

// Radix Select forbids an empty-string item value, so map the "" ("all") filter
// state to a sentinel on the way in and back to "" on the way out.
const ALL_FILTER = "__all__";
const FilterSelect: FC<{
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}> = ({ value, onChange, children }) => (
  <Select
    value={value || ALL_FILTER}
    onValueChange={(v) => onChange(v === ALL_FILTER ? "" : v)}
  >
    <SelectTrigger className="h-8 w-auto gap-1 rounded-md border-border bg-card px-2 text-xs">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>{children}</SelectContent>
  </Select>
);

export const ContractsBrowserScreen: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const [params, setParams] = useSearchParams();

  const { data: meta } = useContractIndexMeta();
  const years = meta?.years ?? [];
  const year = params.get("year") || years[years.length - 1]?.year || "";
  const sector = params.get("sector") || "";
  const proc = params.get("proc") || "";
  const eu = params.get("eu") || "";
  const val = params.get("val") || "";

  const { data: rows, isLoading } = useContractYear(year || undefined);

  const set = (k: string, v: string) =>
    setParams(
      (p) => {
        if (v) p.set(k, v);
        else p.delete(k);
        return p;
      },
      { replace: true },
    );

  const filtered = useMemo<ContractRow[]>(() => {
    if (!rows) return [];
    const vb = val ? VALUE_BUCKETS[val] : null;
    return rows.filter((r) => {
      if (sector && r[6] !== sector) return false;
      if (proc && r[7] !== proc) return false;
      if (eu === "1" && r[8] !== 1) return false;
      if (eu === "0" && r[8] !== 0) return false;
      if (vb && (r[5] < vb[0] || r[5] >= vb[1])) return false;
      return true;
    });
  }, [rows, sector, proc, eu, val]);

  const columns = useMemo<ColumnDef<ContractRow>[]>(
    () => [
      {
        id: "date",
        accessorFn: (r) => r[0],
        header: bg ? "Дата" : "Date",
      },
      {
        id: "awarder",
        accessorFn: (r) => r[2],
        header: bg ? "Възложител" : "Awarder",
        cell: ({ row }) => (
          <Link to={`/awarder/${row.original[1]}`} className="hover:underline">
            {row.original[2]}
          </Link>
        ),
      },
      {
        id: "contractor",
        accessorFn: (r) => r[4],
        header: bg ? "Изпълнител" : "Contractor",
        cell: ({ row }) => (
          <Link to={`/company/${row.original[3]}`} className="hover:underline">
            {row.original[4]}
          </Link>
        ),
      },
      {
        id: "subject",
        accessorFn: (r) => r[9],
        header: bg ? "Предмет" : "Subject",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original[9]}
          </span>
        ),
      },
      {
        id: "sector",
        accessorFn: (r) => cpvDivisionName(r[6], lang),
        header: bg ? "Сектор" : "Sector",
        cell: ({ row }) => (
          <span className="text-xs">
            {cpvDivisionName(row.original[6], lang)}
          </span>
        ),
      },
      {
        id: "proc",
        accessorFn: (r) =>
          r[7] ? procedureLabel(r[7] as ProcedureBucket, lang) : "—",
        header: bg ? "Процедура" : "Procedure",
      },
      {
        id: "eu",
        accessorFn: (r) => (r[8] === 1 ? 1 : 0),
        header: bg ? "ЕС" : "EU",
        cell: ({ row }) =>
          row.original[8] === 1 ? (
            <span className="rounded bg-blue-100 dark:bg-blue-950/40 px-1.5 py-0.5 text-[10px] uppercase">
              {bg ? "ЕС" : "EU"}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "value",
        accessorFn: (r) => r[5],
        header: bg ? "Стойност" : "Value",
        cell: ({ row }) => (
          <span className="tabular-nums">{formatEur(row.original[5])}</span>
        ),
      },
    ],
    [bg, lang],
  );

  const title = bg ? "Договори" : "Contracts";

  return (
    <>
      <Title description="Browse public-procurement contracts by sector, procedure, value and EU funding">
        {title}
      </Title>
      <ProcurementNav />
      <section aria-label={title} className="my-4">
        <p className="text-xs text-muted-foreground mb-3">
          {bg
            ? "Филтрирай по година, сектор, процедура, стойност и финансиране от ЕС. Филтрите се пазят в адреса."
            : "Filter by year, sector, procedure, value and EU funding. Filters are kept in the URL."}
        </p>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">
            {bg
              ? `Зареждане на договорите за ${year}…`
              : `Loading ${year} contracts…`}
          </p>
        ) : (
          <DataTable
            title="procurement-contracts"
            columns={columns}
            data={filtered}
            pageSize={25}
            initialSort={[{ id: "value", desc: true }]}
            toolbarItems={
              <div className="flex flex-wrap items-center gap-2">
                <FilterSelect value={year} onChange={(v) => set("year", v)}>
                  {years
                    .slice()
                    .reverse()
                    .map((y) => (
                      <SelectItem key={y.year} value={y.year}>
                        {y.year} ({y.count.toLocaleString(lang)})
                      </SelectItem>
                    ))}
                </FilterSelect>
                <FilterSelect value={sector} onChange={(v) => set("sector", v)}>
                  <SelectItem value={ALL_FILTER}>
                    {bg ? "Всички сектори" : "All sectors"}
                  </SelectItem>
                  {Object.keys(CPV_DIVISION).map((d) => (
                    <SelectItem key={d} value={d}>
                      {cpvDivisionName(d, lang).slice(0, 40)}
                    </SelectItem>
                  ))}
                </FilterSelect>
                <FilterSelect value={proc} onChange={(v) => set("proc", v)}>
                  <SelectItem value={ALL_FILTER}>
                    {bg ? "Всички процедури" : "All procedures"}
                  </SelectItem>
                  {Object.keys(PROCEDURE_LABEL).map((p) => (
                    <SelectItem key={p} value={p}>
                      {procedureLabel(p as ProcedureBucket, lang)}
                    </SelectItem>
                  ))}
                </FilterSelect>
                <FilterSelect value={val} onChange={(v) => set("val", v)}>
                  <SelectItem value={ALL_FILTER}>
                    {bg ? "Всяка стойност" : "Any value"}
                  </SelectItem>
                  {Object.keys(VALUE_BUCKETS).map((k) => (
                    <SelectItem key={k} value={k}>
                      {bg ? VALUE_LABEL[k].bg : VALUE_LABEL[k].en}
                    </SelectItem>
                  ))}
                </FilterSelect>
                <FilterSelect value={eu} onChange={(v) => set("eu", v)}>
                  <SelectItem value={ALL_FILTER}>
                    {bg ? "ЕС: всички" : "EU: all"}
                  </SelectItem>
                  <SelectItem value="1">
                    {bg ? "само с ЕС" : "EU-funded only"}
                  </SelectItem>
                  <SelectItem value="0">
                    {bg ? "без ЕС" : "non-EU only"}
                  </SelectItem>
                </FilterSelect>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {filtered.length.toLocaleString(lang)}{" "}
                  {bg ? "договора" : "contracts"}
                </span>
              </div>
            }
          />
        )}
      </section>
    </>
  );
};
