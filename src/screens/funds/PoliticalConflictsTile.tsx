// /funds — Political-economy conflicts tile. Top-N beneficiaries flagged
// because their declared owners/managers are politically-exposed (sitting MP,
// cabinet member, regional governor, mayor, councillor, etc.). Reads only the
// slim leaderboard (political_links.json, ~54 KB) — per-EIK detail is fetched
// lazily on /company/{eik}.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { usePoliticalIndex } from "@/data/funds/usePoliticalLinks";
import { formatEur } from "@/lib/currency";
import { orgTypeLabel } from "@/data/funds/orgLabels";
import { officialCategoryLabel } from "@/data/funds/officialLabels";

const numFmt = new Intl.NumberFormat("bg-BG");

export const PoliticalConflictsTile: FC = () => {
  const { t, i18n } = useTranslation();
  const { data, isLoading } = usePoliticalIndex();

  if (isLoading) {
    return (
      <Card className="ring-1 ring-rose-200/60 dark:ring-rose-800/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {t("funds_political_title") || "Politically-tied beneficiaries"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 md:p-4">
          <div className="h-32 animate-pulse rounded bg-muted" />
        </CardContent>
      </Card>
    );
  }

  if (!data || data.totals.flaggedEiks === 0) return null;

  const visible = data.top.slice(0, 10);

  return (
    <Card className="ring-1 ring-rose-200/60 dark:ring-rose-800/40">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4 text-rose-600" />
          {t("funds_political_title") || "Politically-tied beneficiaries"}
          <span className="text-xs font-normal text-muted-foreground">
            {numFmt.format(data.totals.flaggedEiks)}{" "}
            {t("funds_political_companies") || "companies"} ·{" "}
            {formatEur(data.totals.contractedEur)}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 p-3 md:p-4">
        <p className="text-xs text-muted-foreground">
          {t("funds_political_intro") ||
            "EU-funds beneficiaries whose declared owners or managers are sitting MPs, cabinet members, regional governors, mayors, or councillors. Source: Сметна палата declarations + Commerce Registry."}
        </p>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="rounded bg-amber-100/50 p-2 dark:bg-amber-900/20">
            <div className="text-[10px] font-medium uppercase tracking-wide text-amber-800 dark:text-amber-300">
              {t("funds_political_mp_only") || "MP-tied"}
            </div>
            <div className="text-base font-bold tabular-nums">
              {numFmt.format(data.totals.mpOnly)}
            </div>
          </div>
          <div className="rounded bg-purple-100/50 p-2 dark:bg-purple-900/20">
            <div className="text-[10px] font-medium uppercase tracking-wide text-purple-800 dark:text-purple-300">
              {t("funds_political_official_only") || "Official-tied"}
            </div>
            <div className="text-base font-bold tabular-nums">
              {numFmt.format(data.totals.officialOnly)}
            </div>
          </div>
          <div className="rounded bg-rose-100/50 p-2 dark:bg-rose-900/20">
            <div className="text-[10px] font-medium uppercase tracking-wide text-rose-800 dark:text-rose-300">
              {t("funds_political_both") || "Multiple"}
            </div>
            <div className="text-base font-bold tabular-nums">
              {numFmt.format(data.totals.both)}
            </div>
          </div>
        </div>

        <ul className="flex flex-col divide-y divide-border">
          {visible.map((e, i) => {
            const labelParts: string[] = [];
            if (e.mps.length > 0) {
              labelParts.push(
                `${e.mps.length} ${t("funds_political_mp_label", { count: e.mps.length }) || "MP"}`,
              );
            }
            if (e.officials.length > 0) {
              // Show the top-level category of the first official (cabinet,
              // mayor, etc.) — gives a quick "what kind of official" hint
              // without bloating the row.
              const cat = officialCategoryLabel(t, e.officials[0].category);
              labelParts.push(
                e.officials.length === 1
                  ? cat
                  : `${e.officials.length} × ${cat}`,
              );
            }
            return (
              <li
                key={e.eik}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0"
              >
                <span className="w-5 shrink-0 text-xs tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                <Link
                  to={`/company/${e.eik}`}
                  className="font-medium hover:underline"
                >
                  {e.name}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {orgTypeLabel(e.orgType, i18n.language)}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {labelParts.join(" · ")}
                </span>
                {e.procurementEur > 0 ? (
                  <span className="text-[10px] font-medium uppercase tracking-wide text-sky-700 dark:text-sky-400">
                    {t("funds_political_proc_overlap") || "+АОП"}{" "}
                    {formatEur(e.procurementEur)}
                  </span>
                ) : null}
                {e.debarred ? (
                  <span className="rounded bg-rose-200/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-rose-900 dark:bg-rose-900/40 dark:text-rose-200">
                    {t("funds_political_debarred") || "debarred"}
                  </span>
                ) : null}
                <span className="ml-auto text-sm font-medium tabular-nums">
                  {formatEur(e.contractedEur)}
                </span>
              </li>
            );
          })}
        </ul>

        {data.totals.flaggedEiks > visible.length ? (
          <Link
            to="/funds/political"
            className="inline-block text-sm font-medium text-primary hover:underline"
          >
            {t("funds_political_view_all", {
              count: data.totals.flaggedEiks,
            }) || `View all ${data.totals.flaggedEiks} →`}
          </Link>
        ) : null}

        <p className="text-[11px] text-muted-foreground/80">
          {t("funds_political_disclaimer") ||
            "A connection describes what the official is on record for — not in itself an accusation of wrongdoing."}
        </p>
      </CardContent>
    </Card>
  );
};
