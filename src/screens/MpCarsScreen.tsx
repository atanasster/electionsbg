import { FC, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Car,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  ExternalLink,
} from "lucide-react";
import { Title } from "@/ux/Title";
import { useMpCars } from "@/data/parliament/useMpCars";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import type { MpCarRow } from "@/data/dataTypes";

type SortKey = "value" | "year" | "name" | "make";
type SortDir = "asc" | "desc";
type Scope = "ns" | "all";

const formatBgn = (n: number, lang: string): string => {
  const locale = lang === "bg" ? "bg-BG" : "en-GB";
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
    Math.round(n),
  );
};

const SortIcon: FC<{ active: boolean; dir: SortDir }> = ({ active, dir }) => {
  if (!active) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
  return dir === "asc" ? (
    <ArrowUp className="h-3 w-3" />
  ) : (
    <ArrowDown className="h-3 w-3" />
  );
};

export const MpCarsScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const { mpCars } = useMpCars();
  const { selected } = useElectionContext();
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [scope, setScope] = useState<Scope>("ns");

  const folder = useMemo(() => electionToNsFolder(selected), [selected]);

  const source: MpCarRow[] = useMemo(() => {
    if (!mpCars) return [];
    if (scope === "ns" && folder) {
      const inScope = mpCars.cars.filter((c) => c.nsFolders.includes(folder));
      // Fall back to lifetime when the selected NS produced nothing — avoids
      // an empty page on parliaments with no filings yet.
      return inScope.length > 0 ? inScope : mpCars.cars;
    }
    return mpCars.cars;
  }, [mpCars, scope, folder]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? source.filter(
          (c) =>
            c.mpName.toLowerCase().includes(q) ||
            (c.make ?? "").toLowerCase().includes(q) ||
            (c.detail ?? "").toLowerCase().includes(q) ||
            (c.partyGroupShort ?? "").toLowerCase().includes(q),
        )
      : [...source];
    filtered.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "value") {
        const av = a.valueBgn ?? -Infinity;
        const bv = b.valueBgn ?? -Infinity;
        cmp = av - bv;
      } else if (sortKey === "year") {
        const ay = a.acquiredYear ?? -Infinity;
        const by = b.acquiredYear ?? -Infinity;
        cmp = ay - by;
      } else if (sortKey === "make") {
        cmp = (a.make ?? "zzz").localeCompare(b.make ?? "zzz", "bg");
      } else {
        cmp = a.mpName.localeCompare(b.mpName, "bg");
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return filtered;
  }, [source, query, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "name" || k === "make" ? "asc" : "desc");
    }
  };

  const Th: FC<{ k: SortKey; label: string; align?: "left" | "right" }> = ({
    k,
    label,
    align = "right",
  }) => (
    <th
      onClick={() => toggleSort(k)}
      className={`text-${align} px-2 py-2 text-[11px] uppercase tracking-wide font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <SortIcon active={sortKey === k} dir={sortDir} />
      </span>
    </th>
  );

  if (!mpCars) return null;

  const totalValue = rows.reduce((s, r) => s + (r.valueBgn ?? 0), 0);
  const valued = rows.filter((r) => r.valueBgn != null).length;

  return (
    <div className="w-full">
      <Title description={t("mp_cars_page_description") || ""}>
        <span className="inline-flex items-center gap-2">
          <Car className="h-5 w-5" />
          {t("mp_cars_page_title") || "MP-declared cars"}
        </span>
      </Title>

      <div className="flex flex-wrap items-center justify-between gap-3 my-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setScope("ns")}
            className={`text-xs px-3 py-1 rounded-full border ${
              scope === "ns"
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card hover:bg-muted/40"
            }`}
            disabled={!folder}
          >
            {t("mp_cars_scope_ns") || "Selected parliament"}
            {folder ? ` · ${folder}` : ""}
          </button>
          <button
            type="button"
            onClick={() => setScope("all")}
            className={`text-xs px-3 py-1 rounded-full border ${
              scope === "all"
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card hover:bg-muted/40"
            }`}
          >
            {t("mp_cars_scope_all") || "All parliaments"}
          </button>
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("search") || "search"}
          className="bg-card border rounded-md px-3 py-1.5 text-sm w-64 max-w-full"
        />
      </div>

      <div className="text-xs text-muted-foreground mb-2">
        {t("mp_cars_page_summary", {
          defaultValue:
            "{{total}} cars · {{valued}} with declared value · combined {{sum}} BGN",
          total: rows.length,
          valued,
          sum: formatBgn(totalValue, i18n.language),
        })}
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="min-w-full text-sm">
          <thead className="border-b bg-muted/30">
            <tr>
              <th className="w-10 px-2 py-2 text-[11px] text-muted-foreground" />
              <Th k="name" label={t("mp_cars_col_mp") || "MP"} align="left" />
              <th className="px-2 py-2 text-[11px] uppercase tracking-wide font-medium text-muted-foreground text-left">
                {t("mp_cars_col_party") || "Party group"}
              </th>
              <Th k="make" label={t("mp_cars_col_make") || "Make"} align="left" />
              <th className="px-2 py-2 text-[11px] uppercase tracking-wide font-medium text-muted-foreground text-left">
                {t("mp_cars_col_detail") || "Model (declared)"}
              </th>
              <Th k="year" label={t("mp_cars_col_year") || "Year"} />
              <Th k="value" label={t("mp_cars_col_value") || "Value (BGN)"} />
              <th className="px-2 py-2 text-[11px] uppercase tracking-wide font-medium text-muted-foreground text-left">
                {t("mp_cars_col_holder") || "Holder"}
              </th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={`${row.mpId}-${i}`}
                className={i % 2 === 0 ? "" : "bg-muted/10"}
              >
                <td className="px-2 py-1.5 text-right text-xs text-muted-foreground tabular-nums">
                  {i + 1}
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <MpAvatar mpId={row.mpId} name={row.mpName} />
                    <Link
                      to={`/candidate/${encodeURIComponent(row.mpName)}`}
                      className="hover:underline truncate"
                    >
                      {row.mpName}
                    </Link>
                  </div>
                </td>
                <td className="px-2 py-1.5 text-xs text-muted-foreground truncate max-w-[160px]">
                  {row.partyGroupShort ?? "—"}
                </td>
                <td className="px-2 py-1.5">
                  {row.make ?? (
                    <span className="text-muted-foreground italic">
                      {t("mp_cars_unknown_make") || "unknown"}
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-xs text-muted-foreground truncate max-w-[260px]">
                  {row.detail ?? "—"}
                  {row.share && row.mergedFromCount > 1 && (
                    <span
                      className="ml-1 text-[10px] text-muted-foreground/80"
                      title={
                        t("mp_cars_share_tooltip", {
                          defaultValue:
                            "Combined from {{count}} declaration rows: {{share}}",
                          count: row.mergedFromCount,
                          share: row.share,
                        }) || ""
                      }
                    >
                      ({row.share})
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-right text-xs tabular-nums">
                  {row.acquiredYear ?? "—"}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums font-mono">
                  {row.valueBgn != null ? (
                    formatBgn(row.valueBgn, i18n.language)
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-xs text-muted-foreground">
                  {row.isSpouse
                    ? t("mp_cars_holder_spouse") || "spouse"
                    : t("mp_cars_holder_self") || "MP"}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <a
                    href={row.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline inline-flex"
                    aria-label="open declaration source"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-muted-foreground mt-4">
        {t("mp_cars_page_footer") ||
          "Cars (passenger vehicles + jeeps) extracted from the most-recent declaration of every MP. Spouse-held cars are listed with holder = spouse. Source: register.cacbg.bg (Bulgarian Court of Audit)."}
      </div>
    </div>
  );
};
