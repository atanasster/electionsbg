import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@/ux/Link";
import { ArrowRight } from "lucide-react";
import { useTopicIndex } from "@/data/parliament/votes/useTopicIndex";
import { TopicChip } from "./TopicChip";
import type { TopicEntry, VoteOutcome } from "@/data/parliament/votes/types";

type Props = {
  /** Lookback window in days. Defaults to 7 (rolling week). */
  windowDays?: number;
  /** Items to show. Defaults to 5. */
  count?: number;
};

const OUTCOME_COLOR: Record<VoteOutcome, string> = {
  passed_unanimous: "text-emerald-700",
  passed: "text-emerald-700",
  rejected_unanimous: "text-red-700",
  rejected: "text-red-700",
  abstain_unanimous: "text-amber-700",
  contested: "text-amber-700",
};

const formatDate = (iso: string, lang: string): string => {
  const d = new Date(iso + "T00:00:00Z");
  return new Intl.DateTimeFormat(lang === "bg" ? "bg-BG" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
};

// Most-contested votes in the trailing window. Falls back to "most-recent N
// contested" when the rolling window has fewer than 3 results (recess weeks,
// summer break) so the tile never goes empty during a working session.
export const ContestedVotesFeed: FC<Props> = ({
  windowDays = 7,
  count = 5,
}) => {
  const { t, i18n } = useTranslation();
  const { entries, isLoading } = useTopicIndex();

  const items = useMemo(() => {
    if (entries.length === 0) return [];
    // Newest entry's date as the anchor for the rolling window — using
    // wall-clock today() would empty the feed during a recess.
    const newestDate = entries[0].date;
    const anchor = new Date(newestDate + "T00:00:00Z");
    const cutoff = new Date(anchor);
    cutoff.setUTCDate(cutoff.getUTCDate() - windowDays);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    // Rank by contestScore (closeness) rather than the discrete "contested"
    // outcome label — the latter only fires on exact ties (yes == no+abstain),
    // which is vanishingly rare. contestScore > 0 covers any genuinely split
    // vote; the threshold filters out unanimous procedural noise.
    const MIN_CONTEST = 0.05;
    const inWindow: TopicEntry[] = entries.filter(
      (e) => e.date >= cutoffStr && e.contestScore >= MIN_CONTEST,
    );

    // Fallback when the rolling window is thin (recess weeks): expand to
    // "most-contested across all time" so the tile never goes empty.
    const pool =
      inWindow.length >= 3
        ? inWindow
        : entries.filter((e) => e.contestScore >= MIN_CONTEST);
    return [...pool]
      .sort((a, b) => {
        if (b.contestScore !== a.contestScore) {
          return b.contestScore - a.contestScore;
        }
        return b.date.localeCompare(a.date);
      })
      .slice(0, count);
  }, [entries, windowDays, count]);

  if (isLoading || items.length === 0) return null;

  const lang = i18n.language;

  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide mb-3">
        {t("votes_landing_breaks_title") ||
          "Biggest party-line breaks this week"}
      </h2>
      <ul className="divide-y">
        {items.map((it) => (
          <li key={`${it.date}-${it.item}`} className="py-2">
            <Link
              to={`/votes/${it.date}/item-${it.slug}`}
              underline={false}
              className="block hover:text-primary"
            >
              <div className="flex items-baseline gap-2 text-xs text-muted-foreground mb-0.5 flex-wrap">
                <span className="tabular-nums">
                  {formatDate(it.date, lang)}
                </span>
                {it.topic && <TopicChip topic={it.topic} linkable={false} />}
                <span
                  className={`uppercase font-semibold ${OUTCOME_COLOR[it.outcome]}`}
                >
                  {t(`votes_outcome_${it.outcome}`) || it.outcome}
                </span>
                <span className="ml-auto tabular-nums">
                  {it.tally.yes}·{it.tally.no}·{it.tally.abstain}
                </span>
              </div>
              <div className="text-sm line-clamp-2">
                {it.title ?? `#${it.item}`}
              </div>
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-3 pt-3 border-t">
        <Link
          to="/votes"
          underline={false}
          className="text-xs text-primary hover:underline inline-flex items-center gap-1"
        >
          {t("votes_landing_browse_all") || "Browse all voting days"}
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </section>
  );
};
