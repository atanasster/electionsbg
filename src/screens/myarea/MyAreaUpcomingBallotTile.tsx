// "What's next on the ballot" tile — Ballotpedia-style forward-looking
// calendar. The election anchors live in
// src/data/myarea/upcomingElections.ts (shared with MyAreaActionBand).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { CalendarClock } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  UPCOMING_ELECTIONS,
  daysUntil,
  formatLongDate,
} from "@/data/myarea/upcomingElections";

export const MyAreaUpcomingBallotTile: FC = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";

  // Cap at events within the next 365 days. Anything further out is noise
  // — a "след 1105 дни" badge next to "след 164 дни" trivializes the
  // near-term event by sitting in the same list. The cap effectively
  // hides distant EP / parliamentary placeholders until the actual
  // decree gets within a year.
  const visible = UPCOMING_ELECTIONS.filter((e) => {
    const d = daysUntil(e.date);
    return d >= 0 && d <= 365;
  }).slice(0, 3);
  if (visible.length === 0) return null;

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <CalendarClock className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">
          {t("my_area_upcoming_ballot")}
        </h2>
      </div>
      <ul className="flex flex-col gap-2">
        {visible.map((e) => {
          const days = daysUntil(e.date);
          const label = t(`election_kind_${e.kind}`);
          const dateLabel = formatLongDate(e.date, lang);
          return (
            <li
              key={e.date + e.kind}
              className="flex items-center justify-between gap-2"
            >
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-medium truncate">{label}</span>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {dateLabel}
                  {e.confidence === "estimated" ? (
                    <>
                      {" · "}
                      <span className="italic">{t("estimated_date")}</span>
                    </>
                  ) : null}
                </span>
              </div>
              <span className="text-xs tabular-nums px-2 py-0.5 rounded-full bg-primary/10 text-primary shrink-0">
                {lang === "bg" ? `след ${days} дни` : `in ${days} days`}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
};
