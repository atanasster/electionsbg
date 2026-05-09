import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  CensusEntity,
  CensusMetric,
  CensusMunicipalityEntity,
  CensusOblastEntity,
} from "@/data/census/censusTypes";
import { censusMetricValue } from "@/data/census/useCensus";
import { useRegions } from "@/data/regions/useRegions";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { CENSUS_METRICS, formatMetricValue } from "./censusMetrics";

type SortKey = "name" | CensusMetric;
type Level = "oblast" | "obshtina";

// Curated subset of metrics shown as table columns. Population is the
// anchor; the rest are the ones with the most explanatory power for
// election cross-tabs.
const COLUMN_METRICS: CensusMetric[] = [
  "population",
  "ethnicBulgarian",
  "ethnicTurkish",
  "ethnicRoma",
  "religionMuslim",
  "eduTertiary",
  "age65plus",
  "employmentRate",
];

const PAGE_SIZE = 30;

type Row = (CensusOblastEntity | CensusMunicipalityEntity) & {
  parentRegionCode?: string;
};

export const OblastDemographicsTable: React.FC<{
  oblasts: CensusOblastEntity[];
  municipalities?: CensusMunicipalityEntity[];
}> = ({ oblasts, municipalities }) => {
  const { t, i18n } = useTranslation();
  const [level, setLevel] = useState<Level>("oblast");
  const [sortKey, setSortKey] = useState<SortKey>("population");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);
  const { findRegion } = useRegions();
  const { findMunicipality } = useMunicipalities();

  const lang = i18n.language;
  const isBg = lang === "bg";

  const baseRows: Row[] = useMemo(
    () => (level === "oblast" ? oblasts : (municipalities ?? [])),
    [level, oblasts, municipalities],
  );

  const rows = useMemo(() => {
    const filterLower = filter.trim().toLowerCase();
    const filtered = filterLower
      ? baseRows.filter((r) => {
          const info =
            level === "oblast" ? findRegion(r.code) : findMunicipality(r.code);
          const candidates = [
            info?.name,
            info?.name_en,
            info?.long_name,
            info?.long_name_en,
            r.nameBg,
            r.nameEn,
            r.code,
          ].filter(Boolean) as string[];
          return candidates.some((c) => c.toLowerCase().includes(filterLower));
        })
      : baseRows;
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sortKey === "name") {
        const an = isBg ? a.nameBg : a.nameEn;
        const bn = isBg ? b.nameBg : b.nameEn;
        return sortDir === "asc" ? an.localeCompare(bn) : bn.localeCompare(an);
      }
      const av = censusMetricValue(a as CensusEntity, sortKey);
      const bv = censusMetricValue(b as CensusEntity, sortKey);
      const aN = av ?? -Infinity;
      const bN = bv ?? -Infinity;
      return sortDir === "asc" ? aN - bN : bN - aN;
    });
    return sorted;
  }, [
    baseRows,
    sortKey,
    sortDir,
    isBg,
    filter,
    level,
    findRegion,
    findMunicipality,
  ]);

  const totalRows = rows.length;
  const pagedRows = useMemo(() => {
    if (level === "oblast") return rows;
    return rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  }, [rows, page, level]);
  const pageCount = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir(k === "name" ? "asc" : "desc");
    }
    setPage(0);
  };

  const Arrow: React.FC<{ active: boolean }> = ({ active }) => {
    if (!active) return null;
    return sortDir === "asc" ? (
      <ArrowUp className="inline h-3 w-3 ml-0.5" />
    ) : (
      <ArrowDown className="inline h-3 w-3 ml-0.5" />
    );
  };

  const onChangeLevel = (next: Level) => {
    setLevel(next);
    setPage(0);
  };

  const showPagination =
    level === "obshtina" && Boolean(municipalities) && totalRows > PAGE_SIZE;

  return (
    <div className="overflow-x-auto">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="inline-flex rounded-md border overflow-hidden">
          <Button
            variant={level === "oblast" ? "default" : "ghost"}
            size="sm"
            className="rounded-none"
            onClick={() => onChangeLevel("oblast")}
          >
            {t("census_level_oblast", { count: oblasts.length })}
          </Button>
          <Button
            variant={level === "obshtina" ? "default" : "ghost"}
            size="sm"
            className="rounded-none"
            onClick={() => onChangeLevel("obshtina")}
            disabled={!municipalities?.length}
          >
            {t("census_level_obshtina", {
              count: municipalities?.length ?? 0,
            })}
          </Button>
        </div>
        {level === "obshtina" && (
          <Input
            placeholder={t("filter_by_name")}
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(0);
            }}
            className="max-w-[220px] h-9 text-sm"
          />
        )}
      </div>
      <Table className="text-xs md:text-sm">
        <TableHeader>
          <TableRow>
            <TableHead
              className="cursor-pointer"
              onClick={() => toggleSort("name")}
            >
              {level === "oblast" ? t("region") : t("municipality")}
              <Arrow active={sortKey === "name"} />
            </TableHead>
            {COLUMN_METRICS.map((m) => {
              const def = CENSUS_METRICS.find((x) => x.key === m)!;
              return (
                <TableHead
                  key={m}
                  className="cursor-pointer text-right"
                  onClick={() => toggleSort(m)}
                >
                  {t(def.i18nKey)}
                  <Arrow active={sortKey === m} />
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {pagedRows.map((row) => {
            const info =
              level === "oblast"
                ? findRegion(row.code)
                : findMunicipality(row.code);
            const displayName = isBg
              ? info?.long_name || info?.name || row.nameBg
              : info?.long_name_en || info?.name_en || row.nameEn;
            // Sofia city is administratively a single-obshtina oblast
            // (SOF46 is its only municipality and isn't in our
            // municipalities.json), so route it to the SOF oblast page where
            // its dashboard actually lives.
            const linkTo =
              level === "oblast"
                ? `/municipality/${row.code}`
                : row.code === "SOF46"
                  ? "/municipality/SOF"
                  : `/settlement/${row.code}`;
            return (
              <TableRow key={row.code}>
                <TableCell className="font-medium whitespace-nowrap">
                  <Link to={linkTo} className="hover:underline">
                    {displayName}
                  </Link>
                </TableCell>
                {COLUMN_METRICS.map((m) => (
                  <TableCell key={m} className="text-right tabular-nums">
                    {formatMetricValue(
                      censusMetricValue(row as CensusEntity, m),
                      m,
                      lang,
                    )}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {showPagination && (
        <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
          <span>
            {t("showing")} {page * PAGE_SIZE + 1}–
            {Math.min((page + 1) * PAGE_SIZE, totalRows)} {t("of")} {totalRows}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              {t("previous")}
            </Button>
            <span>
              {page + 1} / {pageCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page + 1 >= pageCount}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            >
              {t("next")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
