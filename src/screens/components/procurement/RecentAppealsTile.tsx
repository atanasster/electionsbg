// Dashboard tile: the most recent КЗК (Комисия за защита на конкуренцията)
// procurement appeals, each linking to its procedure (by УНП, exact join) and
// its КЗК record. The national feed sibling of the per-procedure appeals tile.
// Honest: an appeal is a review of the procedure, not proof of wrongdoing.

import { FC } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Gavel, ExternalLink, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useKzkRecentAppeals } from "@/data/procurement/useKzkRecentAppeals";
import { decodeEntities } from "@/lib/decodeEntities";
import { formatDate } from "@/lib/formatDate";
import { AppealChip } from "@/screens/components/procurement/AppealChip";

const PREVIEW = 8;

export const RecentAppealsTile: FC = () => {
  const { t, i18n } = useTranslation();
  const [sp] = useSearchParams();
  // This tile is corpus-wide ("all years"); force ?pscope=all so "see all" opens
  // the browser at the SAME scope (carrying the section scope forward would hide
  // appeals the tile just showed). Preserve other params (e.g. ?elections).
  const seeAllHref = (() => {
    const p = new URLSearchParams(sp);
    p.set("pscope", "all");
    return `/procurement/appeals?${p.toString()}`;
  })();
  const { data } = useKzkRecentAppeals(PREVIEW);
  if (!data || data.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Gavel className="h-4 w-4 text-amber-600" />
          {t("appeals_feed_title") || "Recent appeals (КЗК)"}
          {/* The КЗК feed is corpus-wide (schema 042) — the ONE procurement tile
              not windowed by the pscope scope (the risk-grade leaderboard IS
              scoped), so it carries this explicit "all years" badge. */}
          <span className="text-[11px] font-normal text-muted-foreground">
            {t("procurement_scope_corpus_badge") || "Scope: all years"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 pt-0">
        <ul className="flex flex-col">
          {data.map((a) => (
            <li
              key={a.complaintNo}
              className="flex items-center gap-2 py-1.5 border-b border-border/40 last:border-b-0 text-sm"
            >
              {a.suspension ? (
                <AppealChip suspended pill className="shrink-0" />
              ) : null}
              <span className="min-w-0 flex-1 truncate">
                {a.resolved && a.unp ? (
                  <Link to={`/tenders/${a.unp}`} className="hover:underline">
                    {decodeEntities(a.buyerName || "") || a.unp}
                  </Link>
                ) : (
                  <span>
                    {decodeEntities(a.buyerName || a.complainant || "") ||
                      a.complaintNo}
                  </span>
                )}
                {/* Only append the complainant when the primary span rendered
                    the BUYER — otherwise the primary already fell back to the
                    complainant and we'd print "X · X". */}
                {a.complainant && ((a.resolved && a.unp) || a.buyerName) ? (
                  <span className="text-muted-foreground">
                    {" "}
                    · {decodeEntities(a.complainant)}
                  </span>
                ) : null}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                {a.complaintDate
                  ? formatDate(a.complaintDate, i18n.language)
                  : ""}
              </span>
            </li>
          ))}
        </ul>
        {/* Into the paginated appeals browser at ?pscope=all — matches this
            tile's advertised "all years" scope. */}
        <Link
          to={seeAllHref}
          className="mt-3 flex items-center justify-center gap-1.5 rounded-md border border-border bg-accent/30 px-3 py-2 text-xs font-medium text-foreground hover:bg-accent/60 transition-colors"
        >
          {t("appeals_feed_see_all") || "See all appeals"}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
        <p className="mt-3 text-[11px] text-muted-foreground/80 flex items-center gap-1">
          {t("appeals_feed_hint") ||
            "Appeals to the CPC (КЗК). A review, not proof of wrongdoing."}{" "}
          <a
            href="https://reg.cpc.bg/AllComplaints.aspx?dt=2"
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline inline-flex items-center gap-0.5"
          >
            {t("appeals_feed_register") || "КЗК register"}
            <ExternalLink className="h-3 w-3" />
          </a>
        </p>
      </CardContent>
    </Card>
  );
};
