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
// WHAT THE BARS ENCODE — and what they do NOT. RollcallIndexEntry is
// { date, stenogramId, items, file, ns }: index.json carries NO tallies. Per-day
// за/против/въздържал lives only inside the session files (482 KB average, 4.97 MB worst),
// which the hub may never fetch. So v1 encodes ITEMS VOTED PER DAY and says so; the
// stacked-outcome version arrives with hub_feed in H2. The caption must never imply
// outcome.
//
// The strip is INFORMATIONAL, not decorative, so unlike a tile scene it cannot be
// aria-hidden. Each sitting is a link carrying its own accessible name (date + count +
// unit); the non-sitting columns are hidden, since a run of empty list items announced
// between every sitting is noise rather than an equivalent.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@/ux/Link";
import { useRollcallIndex } from "@/data/parliament/votes/useRollcallIndex";
import { buildStripWindow } from "./stripWindow";

export const ParliamentSessionStrip: FC<{ todayIso?: string }> = ({
  todayIso,
}) => {
  const { t, i18n } = useTranslation();
  const { sessions, isLoading } = useRollcallIndex();
  const today = todayIso ?? new Date().toISOString().slice(0, 10);

  const days = useMemo(
    () => buildStripWindow(sessions, today),
    [sessions, today],
  );
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
  if (isLoading) return <div className="min-h-[132px]" aria-hidden />;
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
    <section
      aria-labelledby="nsh-strip-heading"
      className="rounded-xl border border-border bg-card px-3 py-3 sm:px-4"
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2
          id="nsh-strip-heading"
          className="text-sm font-semibold tracking-tight"
        >
          {t("nsh_strip_title") || "Plenary days"}
        </h2>
        <span className="text-xs text-muted-foreground">
          {/* Names the unit, so the bars cannot be read as an outcome split. */}
          {t("nsh_strip_caption") || "bar height = items voted that day"}
        </span>
      </div>

      <div className="overflow-x-auto">
        <ol
          className="flex min-w-[520px] items-end gap-[3px]"
          style={{ height: 72 }}
        >
          {days.map((day) => {
            // SQUARE-ROOT scale, not linear. Item counts per day are long-tailed — the
            // 52nd NS ranges from 1 to 237 — so a linear scale renders a 14-item sitting
            // as a 4px sliver indistinguishable from the hairline that marks a day the
            // chamber did not sit. That is the one comparison this strip exists to make,
            // so the scale has to preserve it. Ordering is unchanged; only the contrast
            // between small values is.
            const height =
              peak > 0 ? Math.round(Math.sqrt(day.items / peak) * 58) : 0;
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
                    title={`${label} · ${day.items}`}
                    aria-label={`${label} — ${day.items} ${itemsWord}`}
                    className="block w-full rounded-t-[2px] bg-[hsl(var(--primary))] opacity-75 transition-opacity hover:opacity-100"
                    style={{ height: Math.max(height, 8) }}
                  />
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
  );
};
