import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@/ux/Link";
import { ArrowRight } from "lucide-react";
import { useContestedVotes } from "@/data/parliament/votes/useContestedVotes";
// timeZone: "UTC" is load-bearing — these are calendar DAYS, and the local formatter this
// replaced rendered 2026-07-24 as "23.07" for every reader west of UTC, so the row's date
// and the /votes/<date> it links to disagreed by one.
import { useDayLabel } from "@/ux/feed";
import { TopicChip } from "./TopicChip";
import type { VoteOutcome } from "@/data/parliament/votes/types";

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

// Most-contested votes in the trailing window, with an all-time fallback for recess weeks.
//
// The ranking, the window and the fallback all moved into useContestedVotes and the route
// behind it (plan §7, P5). This component used to fetch `topic_index.json` — 8 MB of the
// whole corpus — and filter it in the browser to render five rows.
export const ContestedVotesFeed: FC<Props> = ({
  windowDays = 7,
  count = 5,
}) => {
  const { t } = useTranslation();
  const day = useDayLabel("long");
  const { items, isLoading, basis, anchor } = useContestedVotes(
    windowDays,
    count,
  );

  if (isLoading || items.length === 0) return null;

  // The heading names no period, because neither tier is "this week". The window runs back
  // from the newest SITTING, so through a recess it is weeks behind wall-clock today (the
  // 52nd's last sitting was 24 July; the tile was still headed "тази седмица" on 11 August),
  // and the fallback ranks the whole term. The basis line below carries whichever it is.
  // An anchorless window has no honest label, so it gets none — falling through to the
  // all-time string would reintroduce the defect from the other side. That branch is
  // UNREACHABLE today (on the PG path a null anchor implies an empty allTime, which makes
  // pgQueryFn return null and hand over to the JSON path; on the JSON path empty entries
  // make items empty and the component has already returned above), and it is kept because
  // the invariant belongs to the route rather than to this component.
  const period =
    basis === "allTime"
      ? t("votes_landing_breaks_alltime")
      : anchor
        ? t("votes_landing_breaks_window", {
            date: day(anchor),
            days: windowDays,
          })
        : null;

  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide">
          {t("votes_landing_breaks_title") || "Biggest party-line breaks"}
        </h2>
        {period && (
          <p className="text-xs text-muted-foreground mt-0.5">{period}</p>
        )}
      </div>
      <ul className="divide-y">
        {items.map((it) => (
          <li key={`${it.date}-${it.item}`} className="py-2">
            <Link
              to={`/votes/${it.date}/item-${it.slug}`}
              underline={false}
              className="block hover:text-primary"
            >
              <div className="flex items-baseline gap-2 text-xs text-muted-foreground mb-0.5 flex-wrap">
                <span className="tabular-nums">{day(it.date)}</span>
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
