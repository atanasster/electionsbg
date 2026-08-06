// The /parliament hero — the chamber's calendar as a strip: one column per calendar day
// over the recent window, sittings drawn as bars, non-sitting days as a hairline.
//
// WHY THIS IS THE HERO (docs/plans/parliament-hub-v1.md §4.1). Recess is not an edge case:
// measured across all nine parliaments the median gap between plenary days is 1 day, the
// maximum 34, and 11–32% of every term's calendar days sit inside a gap longer than ten.
// A lead card or a news rail answers that stretch with apologetic copy in the most
// valuable space on the page; a strip answers it with information, because a recess is
// simply a run of columns that are not there. It is also the only hero that promotes the
// 613 /votes/<date> pages, which carry this module's highest measured engagement and which
// nothing else links to.
//
// WHAT THE BARS ENCODE — and what they do NOT. Bar HEIGHT is always items voted that day;
// the caption says so and must never be written as though height encoded outcome.
//
// The COLOUR is the second dimension, and it exists only when hub_feed/<ns>.json has
// loaded. index.json is { date, stenogramId, items, file, ns } — it carries no tallies at
// all — while the feed shard carries a per-day за/против/въздържал split. So the strip has
// two states, and the one rule that matters is that HEIGHT AND COLOUR COME FROM THE SAME
// SOURCE. index.json's item count is the RAW count and the feed's is post-dedupe (1,263 vs
// 1,198 on the 52nd, ~5% apart), so a strip drawing index.json heights under feed colours
// would be stacking one basis on another — the exact defect class this page's audits kept
// finding. When the feed is present it supplies both; when it is not, volume only.
//
// The strip is INFORMATIONAL, not decorative, so unlike a tile scene it cannot be
// aria-hidden. Each sitting is a link carrying its own accessible name (date + count +
// unit); the non-sitting columns are hidden, since a run of empty list items announced
// between every sitting is noise rather than an equivalent.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@/ux/Link";
import { useRollcallIndex } from "@/data/parliament/votes/useRollcallIndex";
import type { StripDay as FeedStripDay } from "@/data/parliament/useParliamentHubFeed";
import { buildStripWindow, type StripSource } from "./stripWindow";
import { barGeometry, SEGMENT_CLASS } from "./stripBars";
import { useTooltip } from "@/ux/useTooltip";

/** Tooltip order — base of the column upward, matching the stack. */
const SEGMENT_ORDER = ["yes", "no", "abstain"] as const;
/** The colour key names the SEGMENT; the tally names the VOTE. They coincide today and the
 *  map is here so a renamed segment cannot silently read the wrong figure. */
const VOTE_KEY = { yes: "yes", no: "no", abstain: "abstain" } as const;

export const ParliamentSessionStrip: FC<{
  /** hub_feed's sittings for the selected parliament. When present it supplies BOTH the
   *  heights and the split; when absent the strip falls back to index.json for heights
   *  alone. Never one from each — see the header note on bases. */
  feedDays?: FeedStripDay[];
  todayIso?: string;
}> = ({ feedDays, todayIso }) => {
  const { t, i18n } = useTranslation();
  const { tooltip, onMouseEnter, onMouseMove, onMouseLeave } = useTooltip();
  const { sessions, isLoading } = useRollcallIndex();
  const today = todayIso ?? new Date().toISOString().slice(0, 10);

  const source: StripSource[] = useMemo(
    () => (feedDays && feedDays.length > 0 ? feedDays : sessions),
    [feedDays, sessions],
  );
  const days = useMemo(() => buildStripWindow(source, today), [source, today]);
  const peak = useMemo(
    () => days.reduce((max, d) => Math.max(max, d.items), 0),
    [days],
  );

  // timeZone: "UTC" is load-bearing, not boilerplate. The dates are plain calendar days
  // parsed as UTC midnight; formatting them in the viewer's zone renders 2026-07-31 as
  // "30.07" for everyone west of UTC, so the label and the /votes/<date> it links to
  // disagree by a day. Caught on a UTC−4 machine, where every column was off by one.
  const dayLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language === "bg" ? "bg-BG" : "en-GB", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      }),
    [i18n.language],
  );

  // No data for the selected parliament is a first-class state, not an empty grid: nine of
  // the thirteen elections in the picker map to an NS with roll-call data, and the four
  // oldest have none at all. Naming the gap is the whole point — a zeroed strip would read
  // as "the chamber did not sit".
  if (isLoading && !(feedDays && feedDays.length > 0))
    return <div className="min-h-[132px]" aria-hidden />;
  if (days.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
        {t("nsh_strip_no_data") ||
          "No roll-call votes for the selected parliament — the data starts with the 44th National Assembly."}
      </p>
    );
  }

  const sittings = days.filter((d) => d.items > 0);
  const last = sittings[sittings.length - 1];
  // The unit belongs IN the accessible name: "31 юли — 5" tells a screen-reader user
  // nothing about what five is, and the visible caption that explains it is not announced
  // with each bar.
  const itemsWord = t("nsh_strip_items") || "items voted";

  return (
    <>
      <section
        aria-labelledby="nsh-strip-heading"
        className="rounded-xl border border-border bg-card px-3 py-3 sm:px-4"
      >
        {/* NO STANDING CAPTION AND NO LEGEND ROW. Both spent a line of the hero explaining an
          encoding the reader can simply be shown: the tooltip names the day, the item count
          and each colour's own figure, on the bar the cursor is already over. The text
          equivalent stays in each bar's aria-label, where a screen-reader user gets it
          without a hover they cannot perform. */}
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2
            id="nsh-strip-heading"
            className="text-sm font-semibold tracking-tight"
          >
            {t("nsh_strip_title") || "Plenary days"}
          </h2>
        </div>

        <div className="overflow-x-auto">
          <ol
            className="flex min-w-[520px] items-end gap-[3px]"
            style={{ height: 72 }}
          >
            {days.map((day) => {
              // Geometry lives in stripBars.ts so the arithmetic is testable — see its header
              // for the clamp defect that made this worth extracting. Colour splits the bar by
              // SHARE of the day's CAST votes; height still counts items. Cast votes, not the
              // roll, because a fourth "absent" segment would put a member who did not vote
              // inside a picture of how the chamber voted, and absence has its own tile.
              const { height, segments } = barGeometry(day, peak);
              const label = dayLabel.format(new Date(`${day.date}T00:00:00Z`));
              return (
                // A gap carries no information a screen reader can use — without
                // aria-hidden on the LI (not just the rule inside it) the list announces a
                // run of empty items between every sitting.
                <li
                  key={day.date}
                  className="flex h-full flex-1 items-end"
                  aria-hidden={day.items === 0 || undefined}
                >
                  {day.items > 0 ? (
                    <Link
                      to={`/votes/${day.date}`}
                      underline={false}
                      onMouseEnter={(e) =>
                        onMouseEnter(
                          { pageX: e.pageX, pageY: e.pageY },
                          <div className="flex flex-col gap-1">
                            <span className="font-medium">{label}</span>
                            <span className="tabular-nums">
                              {day.items} {itemsWord}
                            </span>
                            {day.tally ? (
                              <ul className="flex flex-col gap-0.5">
                                {SEGMENT_ORDER.map((key) => (
                                  <li
                                    key={key}
                                    className="flex items-center gap-1.5 text-xs"
                                  >
                                    {/* The swatch and the bar read ONE colour map, so the
                                      tooltip cannot end up naming a colour the column
                                      does not use. */}
                                    <span
                                      aria-hidden
                                      className={`h-2 w-2 shrink-0 rounded-[1px] ${SEGMENT_CLASS[key]}`}
                                    />
                                    <span className="text-muted-foreground">
                                      {t(`nsh_strip_legend_${key}`)}
                                    </span>
                                    <span className="ml-auto tabular-nums">
                                      {day.tally![VOTE_KEY[key]]}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </div>,
                        )
                      }
                      onMouseMove={(e) =>
                        onMouseMove({ pageX: e.pageX, pageY: e.pageY })
                      }
                      onMouseLeave={onMouseLeave}
                      aria-label={
                        day.tally
                          ? `${label} — ${day.items} ${itemsWord}, ${t("nsh_strip_legend_yes")} ${day.tally.yes}, ${t("nsh_strip_legend_no")} ${day.tally.no}, ${t("nsh_strip_legend_abstain")} ${day.tally.abstain}`
                          : `${label} — ${day.items} ${itemsWord}`
                      }
                      className="flex w-full flex-col-reverse overflow-hidden rounded-t-[2px] opacity-75 transition-opacity hover:opacity-100"
                      style={{ height }}
                    >
                      {segments ? (
                        <>
                          {/* flex-col-REVERSE, so за sits at the base of the column. A
                            stack that grew downward from the top would put the largest
                            segment against the axis on some days and away from it on
                            others, which makes the columns uncomparable. */}
                          <span
                            aria-hidden
                            className={`w-full shrink-0 ${SEGMENT_CLASS.yes}`}
                            style={{ height: segments.yes }}
                          />
                          <span
                            aria-hidden
                            className={`w-full shrink-0 ${SEGMENT_CLASS.no}`}
                            style={{ height: segments.no }}
                          />
                          {/* The remainder segment, computed as `height - yes - no` rather
                            than rounded on its own share — the three then sum to exactly
                            the bar and no column shows a hairline of card colour. */}
                          <span
                            aria-hidden
                            className={`w-full shrink-0 ${SEGMENT_CLASS.abstain}`}
                            style={{ height: segments.abstain }}
                          />
                        </>
                      ) : (
                        <span
                          aria-hidden
                          className={`w-full flex-1 ${SEGMENT_CLASS.yes}`}
                        />
                      )}
                    </Link>
                  ) : (
                    <span
                      aria-hidden
                      className="block h-[3px] w-full rounded-full bg-border"
                    />
                  )}
                </li>
              );
            })}
          </ol>
        </div>

        {last ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {t("nsh_strip_last") || "Last sitting"}:{" "}
            <Link to={`/votes/${last.date}`} className="font-medium">
              {dayLabel.format(new Date(`${last.date}T00:00:00Z`))}
            </Link>
          </p>
        ) : null}
      </section>
      {/* OUTSIDE the section, and that placement is the rule rather than a preference: the
          strip's own overflow-x-auto container would clip a positioned element, and the
          shared tooltip positions against the page. */}
      {tooltip}
    </>
  );
};
