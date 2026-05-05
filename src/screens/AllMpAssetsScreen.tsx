import { FC, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Wallet,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  ExternalLink,
} from "lucide-react";
import { Title } from "@/ux/Title";
import { useAssetsRankings } from "@/data/parliament/useAssetsRankings";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { formatThousands } from "@/data/utils";
import type { MpAssetsRankingEntry } from "@/data/dataTypes";

type SortKey =
  | "netWorth"
  | "totalAssets"
  | "debts"
  | "realEstate"
  | "delta"
  | "name"
  | "year";
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

export const AllMpAssetsScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const { rankings } = useAssetsRankings();
  const { selected } = useElectionContext();
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("netWorth");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const folder = useMemo(() => electionToNsFolder(selected), [selected]);
  const [scope, setScope] = useState<Scope>("ns");

  const source: MpAssetsRankingEntry[] = useMemo(() => {
    if (!rankings) return [];
    if (scope === "ns" && folder && rankings.byNs[folder]?.topMps?.length) {
      return rankings.byNs[folder].topMps;
    }
    return rankings.topMps;
  }, [rankings, scope, folder]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? source.filter(
          (e) =>
            e.label.toLowerCase().includes(q) ||
            (e.partyGroupShort ?? "").toLowerCase().includes(q),
        )
      : [...source];
    filtered.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "netWorth") cmp = a.netWorthBgn - b.netWorthBgn;
      else if (sortKey === "totalAssets")
        cmp = a.totalAssetsBgn - b.totalAssetsBgn;
      else if (sortKey === "debts") cmp = a.totalDebtsBgn - b.totalDebtsBgn;
      else if (sortKey === "realEstate")
        cmp = a.realEstateCount - b.realEstateCount;
      else if (sortKey === "delta") {
        const ad = a.delta?.absoluteBgn ?? -Infinity;
        const bd = b.delta?.absoluteBgn ?? -Infinity;
        cmp = ad - bd;
      } else if (sortKey === "year")
        cmp = a.latestDeclarationYear - b.latestDeclarationYear;
      else cmp = a.label.localeCompare(b.label, "bg");
      return sortDir === "asc" ? cmp : -cmp;
    });
    return filtered;
  }, [source, query, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "name" ? "asc" : "desc");
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

  if (!rankings) return null;

  return (
    <div className="w-full">
      <Title description={t("mp_assets_page_description") || ""}>
        <span className="inline-flex items-center gap-2">
          <Wallet className="h-5 w-5" />
          {t("mp_assets_page_title") || "MPs by declared assets"}
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
            disabled={!folder || !rankings.byNs[folder]?.topMps?.length}
          >
            {t("mp_assets_scope_ns") || "Selected parliament"}
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
            {t("mp_assets_scope_all") || "All parliaments"}
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

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="min-w-full text-sm">
          <thead className="border-b bg-muted/30">
            <tr>
              <th className="w-10 px-2 py-2 text-[11px] text-muted-foreground" />
              <Th k="name" label={t("mp_assets_col_mp") || "MP"} align="left" />
              <th className="px-2 py-2 text-[11px] uppercase tracking-wide font-medium text-muted-foreground text-left">
                {t("mp_assets_col_party") || "Party group"}
              </th>
              <Th k="year" label={t("mp_assets_col_year") || "Year"} />
              <Th
                k="totalAssets"
                label={t("mp_assets_col_assets") || "Assets (BGN)"}
              />
              <Th k="debts" label={t("mp_assets_col_debts") || "Debts (BGN)"} />
              <Th k="netWorth" label={t("mp_assets_col_net") || "Net (BGN)"} />
              <Th
                k="realEstate"
                label={t("mp_assets_col_real_estate") || "Properties"}
              />
              <Th k="delta" label={t("mp_assets_col_yoy") || "YoY change"} />
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.mpId} className={i % 2 === 0 ? "" : "bg-muted/10"}>
                <td className="px-2 py-1.5 text-right text-xs text-muted-foreground tabular-nums">
                  {i + 1}
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <MpAvatar mpId={row.mpId} name={row.label} />
                    <Link
                      to={`/candidate/${encodeURIComponent(row.label)}`}
                      className="hover:underline truncate"
                    >
                      {row.label}
                    </Link>
                  </div>
                </td>
                <td className="px-2 py-1.5 text-xs text-muted-foreground truncate max-w-[160px]">
                  {row.partyGroupShort ?? "—"}
                </td>
                <td className="px-2 py-1.5 text-right text-xs tabular-nums">
                  {row.latestDeclarationYear}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums font-mono">
                  {formatBgn(row.totalAssetsBgn, i18n.language)}
                </td>
                <td
                  className={`px-2 py-1.5 text-right tabular-nums font-mono ${row.totalDebtsBgn > 0 ? "text-red-600" : "text-muted-foreground"}`}
                >
                  {row.totalDebtsBgn > 0
                    ? formatBgn(row.totalDebtsBgn, i18n.language)
                    : "—"}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums font-mono font-semibold">
                  {formatBgn(row.netWorthBgn, i18n.language)}
                </td>
                <td className="px-2 py-1.5 text-right text-xs tabular-nums">
                  {row.realEstateCount}
                  {row.realEstateUnvalued > 0 && (
                    <span className="text-muted-foreground ml-1">
                      (+{row.realEstateUnvalued}{" "}
                      {t("mp_assets_unvalued_short") || "n/v"})
                    </span>
                  )}
                </td>
                <td
                  className={`px-2 py-1.5 text-right text-xs tabular-nums ${
                    !row.delta
                      ? "text-muted-foreground"
                      : row.delta.absoluteBgn > 0
                        ? "text-green-600"
                        : row.delta.absoluteBgn < 0
                          ? "text-red-600"
                          : "text-muted-foreground"
                  }`}
                >
                  {row.delta ? (
                    <span className="inline-flex items-center gap-0.5">
                      {row.delta.absoluteBgn > 0 ? (
                        <ArrowUp className="h-3 w-3" />
                      ) : row.delta.absoluteBgn < 0 ? (
                        <ArrowDown className="h-3 w-3" />
                      ) : null}
                      {row.delta.pct != null
                        ? `${Math.abs(row.delta.pct).toFixed(0)}%`
                        : `${formatThousands(Math.round(Math.abs(row.delta.absoluteBgn)))}`}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <Link
                    to={`/candidate/${encodeURIComponent(row.label)}`}
                    className="text-primary hover:underline inline-flex"
                    aria-label="open candidate"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-muted-foreground mt-4">
        {t("mp_assets_page_footer") ||
          "Net worth = sum of declared real estate, vehicles, cash, bank deposits, receivables, investments, securities and company shares (declarant + spouse) minus declared debts. Source: register.cacbg.bg (Bulgarian Court of Audit). Each MP's most recent filed declaration is used."}
      </div>
    </div>
  );
};
