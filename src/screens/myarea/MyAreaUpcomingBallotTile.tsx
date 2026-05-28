// "What's next on the ballot" tile — Ballotpedia-style forward-looking
// calendar. Phase 1 ships a hardcoded next-known-elections list since the
// data isn't worth a new ingest yet:
//   - mi2027 (autumn 2027, exact date TBA — placeholder Oct 24, 2027)
//   - 53rd NS regular term would end Jul 2030 (placeholder)
//   - next EP cycle: Jun 2029 (placeholder)
//   - presidential: Nov 2026
//
// These are *anchors* — the moment the actual decree is published we'll
// swap them. Marked `confidence: "scheduled" | "estimated"` so the UI can
// disclose which.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { CalendarClock } from "lucide-react";
import { Card } from "@/components/ui/card";

type UpcomingElection = {
  /** ISO date — "2026-11-15". */
  date: string;
  /** What kind. Translated via the key {@link kind}_label. */
  kind: "parliament" | "presidential" | "european" | "local";
  confidence: "scheduled" | "estimated";
};

// Hand-curated list — kept short on purpose. Anything more than the next
// 3 events is noise. Sort ascending by date.
const UPCOMING: UpcomingElection[] = [
  { date: "2026-11-08", kind: "presidential", confidence: "estimated" },
  { date: "2027-10-24", kind: "local", confidence: "estimated" },
  { date: "2029-06-06", kind: "european", confidence: "estimated" },
];

const daysUntil = (iso: string): number => {
  const target = new Date(iso + "T00:00:00Z").getTime();
  const now = Date.now();
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
};

const formatBgDate = (iso: string): string => {
  const d = new Date(iso + "T00:00:00Z");
  return new Intl.DateTimeFormat("bg-BG", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
};
const formatEnDate = (iso: string): string => {
  const d = new Date(iso + "T00:00:00Z");
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
};

export const MyAreaUpcomingBallotTile: FC = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";

  const visible = UPCOMING.filter((e) => daysUntil(e.date) >= 0).slice(0, 3);
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
          const label =
            lang === "bg"
              ? t(`election_kind_${e.kind}`)
              : t(`election_kind_${e.kind}`);
          const dateLabel =
            lang === "bg" ? formatBgDate(e.date) : formatEnDate(e.date);
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
