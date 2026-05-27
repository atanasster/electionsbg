// Dashboard tile: EU-funds beneficiary companies with a known business
// linkage (TR role or declared stake) to this MP. Placement: on
// /candidate/:id (the dashboard). Renders nothing when the MP has no
// connected beneficiaries.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Euro } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useMpConnectedFunds } from "@/data/funds/useMpConnectedFunds";
import { summarizeFundsRelations } from "@/data/funds/relationLabel";
import { formatEur } from "@/lib/currency";

const TOP_ROWS = 5;

export const MpConnectedFundsTile: FC<{
  name: string;
  linkSlug?: string;
}> = ({ name, linkSlug }) => {
  const { t } = useTranslation();
  const { entries, summary, isLoading } = useMpConnectedFunds(name);

  if (isLoading) {
    return (
      <Card className="my-4" aria-hidden>
        <CardContent>
          <div className="min-h-[80px] sm:min-h-[140px]" />
        </CardContent>
      </Card>
    );
  }

  if (entries.length === 0) return null;

  const visible = entries.slice(0, TOP_ROWS);
  const showMore = entries.length > TOP_ROWS;
  const candidateSlug = linkSlug ?? encodeURIComponent(name);

  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Euro className="h-4 w-4" />
          {t("funds_tile_title") || "Connected companies receiving EU funds"}
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            {entries.length} {t("funds_tile_companies") || "companies"} ·{" "}
            {formatEur(summary.contractedEur)}
          </span>
          <Link
            to={`/candidate/${candidateSlug}/funds`}
            className="ml-auto inline-flex items-center gap-1 text-xs font-normal text-primary hover:underline"
          >
            {t("funds_tile_see_all") || "See all"}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 p-3 md:p-4 text-sm">
        <ul className="flex flex-col divide-y divide-border">
          {visible.map((e) => (
            <li
              key={e.beneficiaryEik}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0"
            >
              <Link
                to={`/company/${e.beneficiaryEik}`}
                className="font-medium hover:underline"
              >
                {e.beneficiaryName}
              </Link>
              <span className="text-xs text-muted-foreground">
                {summarizeFundsRelations(t, e.relations)}
              </span>
              <span className="ml-auto text-sm tabular-nums">
                {formatEur(e.contractedEur)}
              </span>
            </li>
          ))}
        </ul>
        {showMore ? (
          <div className="text-xs text-muted-foreground">
            {t("funds_tile_more_below") ||
              "Showing top beneficiaries by funds contracted; click “See all” for the full list."}
          </div>
        ) : null}
        <div className="text-[11px] text-muted-foreground/80">
          {t("funds_tile_source_hint") ||
            "Source: ИСУН 2020. Joined to MP business filings (cacbg + TR)."}
        </div>
      </CardContent>
    </Card>
  );
};
