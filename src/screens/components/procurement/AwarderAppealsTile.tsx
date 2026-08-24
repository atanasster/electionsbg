// Awarder "КЗК arbitrations" tile — the complaints filed against this buyer's
// procedures, with how they resolved (upheld / suspended). Completes the
// procurement lifecycle on the awarder page next to the announced-procedures
// tile. Data via useAwarderAppeals (generic /api/db/table, no bespoke endpoint).
// Renders nothing when the buyer has no appeals, so it never breaks the page.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Gavel } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useAwarderAppeals } from "@/data/procurement/useAwarderAppeals";
import { outcomeChip } from "./appealOutcomeChip";
import { AppealChip } from "./AppealChip";

export const AwarderAppealsTile: FC<{ eik: string }> = ({ eik }) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const numFmt = new Intl.NumberFormat(bg ? "bg-BG" : "en-GB");
  const { data } = useAwarderAppeals(eik);
  if (!data || data.total === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Gavel className="h-4 w-4" />
          {bg ? "Обжалвания пред КЗК" : "КЗК appeals"}
          <span className="text-xs font-normal text-muted-foreground">
            {bg
              ? "жалби срещу поръчки на този възложител"
              : "complaints against this buyer's procedures"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <div>
            <div className="text-2xl font-bold tabular-nums">
              {numFmt.format(data.total)}
            </div>
            <div className="text-xs text-muted-foreground">
              {bg ? "жалби" : "complaints"}
            </div>
          </div>
          <div>
            <div className="text-2xl font-bold tabular-nums text-red-600 dark:text-red-400">
              {numFmt.format(data.upheld)}
            </div>
            <div className="text-xs text-muted-foreground">
              {bg ? "уважени" : "upheld"}
            </div>
          </div>
          {data.suspended > 0 && (
            <div>
              <div className="text-2xl font-bold tabular-nums">
                {numFmt.format(data.suspended)}
              </div>
              <div className="text-xs text-muted-foreground">
                {bg ? "със спиране" : "with suspension"}
              </div>
            </div>
          )}
        </div>

        <ul className="divide-y text-sm">
          {data.recent.map((a) => {
            const chip = outcomeChip(a.outcome, a.status, bg);
            const inner = (
              <>
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {a.complainant || a.complaintNo}
                  </span>
                  <AppealChip
                    pill
                    tone={chip.tone}
                    label={chip.text}
                    className="shrink-0"
                  />
                </div>
                <div className="text-xs text-muted-foreground line-clamp-1">
                  {a.complaintDate ? `${a.complaintDate} · ` : ""}
                  {a.subject}
                </div>
              </>
            );
            return (
              <li key={a.complaintNo} className="py-1.5">
                {a.unp ? (
                  <Link
                    to={`/tenders/${encodeURIComponent(a.unp)}`}
                    className="block hover:text-primary"
                  >
                    {inner}
                  </Link>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ul>

        {data.total > data.recent.length && (
          <Link
            to={`/procurement/appeals?buyer=${eik}`}
            className="inline-block text-sm text-accent hover:underline"
          >
            {bg
              ? `Виж всички ${numFmt.format(data.total)} жалби →`
              : `See all ${numFmt.format(data.total)} appeals →`}
          </Link>
        )}
      </CardContent>
    </Card>
  );
};
