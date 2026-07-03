// Dashboard preview of the red-flag feed (/procurement/flags): headline signal
// counts + the top single-supplier concentration pairs, scoped to the section
// window (?pscope). The full feed (MP-tied ranking, debarred register,
// per-oblast tally) lives on the flags page this tile links into.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useRiskFeed } from "@/data/procurement/useRiskFeed";
import { useProcurementHref } from "@/data/procurement/useProcurementScope";
import { formatEur } from "@/lib/currency";

const numFmt = new Intl.NumberFormat("bg-BG");
const PREVIEW = 5;

export const RiskSignalsTile: FC = () => {
  const { t, i18n } = useTranslation();
  const buildHref = useProcurementHref();
  const { data: feed } = useRiskFeed();
  if (!feed) return null;

  const pctFmt = new Intl.NumberFormat(
    i18n.language === "bg" ? "bg-BG" : "en-GB",
    { style: "percent", maximumFractionDigits: 0 },
  );
  const top = (feed.topConcentration ?? []).slice(0, PREVIEW);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-orange-600" />
          {t("flags_title") || "Procurement red flags"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 pt-0">
        <div className="grid grid-cols-3 gap-2 mb-2">
          {(
            [
              [feed.concentrationTotal, t("flags_concentration")],
              [feed.mpTiedTotal, t("flags_mp_tied")],
              [feed.connectedPeopleTotal, t("flags_connected_people")],
            ] as Array<[number | undefined, string]>
          ).map(([value, label]) => (
            <div key={label} className="rounded-md bg-muted/50 p-2">
              <div className="text-lg font-semibold tabular-nums">
                {numFmt.format(value ?? 0)}
              </div>
              <div className="text-[11px] leading-tight text-muted-foreground">
                {label}
              </div>
            </div>
          ))}
        </div>
        <ul className="flex flex-col">
          {top.map((e) => (
            <li
              key={`${e.awarderEik}|${e.contractorEik}`}
              className="flex items-center gap-2 py-1.5 border-b border-border/40 last:border-b-0 text-sm"
            >
              <span className="rounded bg-orange-100 dark:bg-orange-900/40 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums shrink-0">
                {pctFmt.format(e.sharePct)}
              </span>
              <span className="min-w-0 flex-1 truncate">
                <Link
                  to={`/awarder/${e.awarderEik}`}
                  className="hover:underline"
                >
                  {e.awarderName}
                </Link>
                <span className="text-muted-foreground"> → </span>
                <Link
                  to={`/company/${e.contractorEik}`}
                  className="hover:underline"
                >
                  {e.contractorName}
                </Link>
              </span>
              <span className="tabular-nums text-xs shrink-0">
                {formatEur(e.pairTotalEur)}
              </span>
            </li>
          ))}
        </ul>
        <Link
          to={buildHref("/procurement/flags")}
          className="mt-3 flex items-center justify-center gap-1.5 rounded-md border border-border bg-accent/30 px-3 py-2 text-xs font-medium text-foreground hover:bg-accent/60 transition-colors"
        >
          {t("procurement_risk_see_feed") || "See the full red-flag feed"}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </CardContent>
    </Card>
  );
};
