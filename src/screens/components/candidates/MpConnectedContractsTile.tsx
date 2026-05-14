// Dashboard tile: lists contractors that received public-procurement awards
// and have a known business linkage (TR role or declared stake) to this MP.
// Placement: on /candidate/:id (the dashboard), not on the connections page.
//
// Renders nothing when the MP has no connected contractors — keeps the
// dashboard tight for the long tail of MPs whose business graph doesn't
// intersect АОП data.

import { FC, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Receipt } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useMpConnectedContracts } from "@/data/parliament/useMpConnectedContracts";
import { summarizeRelations } from "./procurement/relationLabel";
import { formatEurWithOther } from "@/lib/currency";

const TOP_ROWS = 5;

// Anchor id used by deep-links from /procurement/mps and the TopMpsTile —
// landing on /candidate/:id#mp-procurement scrolls this tile into view.
export const MP_CONNECTED_CONTRACTS_ANCHOR = "mp-procurement";

export const MpConnectedContractsTile: FC<{
  name: string;
  linkSlug?: string;
}> = ({ name, linkSlug }) => {
  const { t, i18n } = useTranslation();
  const { entries, summary, isLoading } = useMpConnectedContracts(name);
  const ref = useRef<HTMLDivElement>(null);
  const { hash } = useLocation();
  // When the URL hash matches our anchor, scroll the tile into view once
  // the data has loaded (skips while isLoading so the scroll target is
  // already rendered at its final height — avoids a jump as the tile
  // expands from the loading skeleton).
  useEffect(() => {
    if (isLoading) return;
    if (hash !== `#${MP_CONNECTED_CONTRACTS_ANCHOR}`) return;
    const el = ref.current;
    if (!el) return;
    // Defer to the next frame so layout has settled.
    const t = window.setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
    return () => window.clearTimeout(t);
  }, [hash, isLoading]);

  if (isLoading) {
    return (
      <Card className="my-4" aria-hidden>
        <CardContent>
          <div className="min-h-[140px]" />
        </CardContent>
      </Card>
    );
  }

  if (entries.length === 0) return null;

  const visible = entries.slice(0, TOP_ROWS);
  const showMore = entries.length > TOP_ROWS;
  const candidateSlug = linkSlug ?? encodeURIComponent(name);

  return (
    <Card
      ref={ref}
      id={MP_CONNECTED_CONTRACTS_ANCHOR}
      className="my-4 scroll-mt-20"
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Receipt className="h-4 w-4" />
          {t("procurement_tile_title") ||
            "Connected companies with public-procurement contracts"}
          <span className="text-xs text-muted-foreground font-normal ml-1">
            {entries.length} {t("procurement_tile_companies") || "compan(ies)"}{" "}
            ·{" "}
            {formatEurWithOther(
              summary.totalEur,
              summary.totalOther,
              i18n.language,
            )}
          </span>
          <Link
            to={`/candidate/${candidateSlug}/procurement`}
            className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline font-normal"
          >
            {t("procurement_tile_see_all") || "See all"}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-2">
        <ul className="flex flex-col divide-y divide-border">
          {visible.map((e) => (
            <li
              key={`${e.contractorEik}`}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0"
            >
              <Link
                to={`/company/${e.contractorEik}`}
                className="font-medium hover:underline"
              >
                {e.contractorName}
              </Link>
              <span className="text-xs text-muted-foreground">
                {summarizeRelations(t, e.relations)}
              </span>
              <span className="ml-auto text-sm tabular-nums">
                {formatEurWithOther(e.totalEur, e.totalOther, i18n.language)}
              </span>
            </li>
          ))}
        </ul>
        {showMore ? (
          <div className="text-xs text-muted-foreground">
            {t("procurement_tile_more_below") ||
              "Showing top contractors by total amount; click “See all” for the full list."}
          </div>
        ) : null}
        <div className="text-[11px] text-muted-foreground/80">
          {t("procurement_tile_source_hint") ||
            "Source: data.egov.bg (АОП OCDS). Joined to MP business filings (cacbg + TR)."}
        </div>
      </CardContent>
    </Card>
  );
};
