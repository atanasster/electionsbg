// T5.5 — the chronology as a TIMELINE: a dated rail (one day heading, then
// the clock time per item), the outlet's mark and name, the headline, the
// framing chips, and the link to the original. This is the row where a
// reader does the comparison, so every item carries the same fields in the
// same order. Undated members close the rail under their own heading — a
// missing date is said, never sorted into a day it did not have.
//
// Day and time are in the PUBLICATION timezone (`NEWS_TZ`, Europe/Sofia) —
// the day an outlet published on must not move with the reader's clock.
// The `<time dateTime>` keeps the source's own offset.
//
// ⚠️ The per-source PERSON-TREATMENT chip the plan names „once T4 lands" is
// not here: T4.0 shipped the identity registry, and person sentiment (T4.1+)
// has not shipped, so there is nothing evidenced to put in that chip yet.

import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import type { Outlet, StoryMember } from "../data";
import { dayKey, formatDay, formatTime } from "../labels";
import { useNewsLocale } from "../i18n";
import { ExternalHeadline, OriginalLink } from "./ArticleRow";
import { LeanBadge, StanceBadge } from "./Badges";
import { monogramOf } from "./imageFallback";

/**
 * A Pick so the mark can widen (a credited logo, a short name) without
 * changing `StoryScreen`'s call site; today it is the name alone.
 */
export type TimelineOutlet = Pick<Outlet, "outlet">;

interface Day {
  key: string;
  label: string | null;
  members: StoryMember[];
}

/**
 * Members grouped by publication-timezone calendar day, first appearance
 * order, undated last. Order-independent: a day is one group however the
 * input is ordered, and members keep their given order within it.
 */
export const groupByDay = (
  members: StoryMember[],
  language: "bg" | "en",
): Day[] => {
  const byDay = new Map<string, Day>();
  const undated: StoryMember[] = [];
  for (const m of members) {
    const key = dayKey(m.published);
    if (!key) {
      undated.push(m);
      continue;
    }
    const day = byDay.get(key);
    if (day) day.members.push(m);
    else
      byDay.set(key, {
        key,
        label: formatDay(m.published, language),
        members: [m],
      });
  }
  const days = [...byDay.values()];
  if (undated.length)
    days.push({ key: "undated", label: null, members: undated });
  return days;
};

// ⚠️ The mark is a MONOGRAM, never the outlet's logo image: `imageCredit.test.ts`
// allows a raw <img> in ArticleImage alone (the one component that attaches a
// credit), and hotlinking a logo into a list row would be the first exception
// to an attribution invariant this app has already been burned on.
const OutletMark = ({ name }: { name: string }) => (
  <span
    aria-hidden
    className="flex size-6 shrink-0 items-center justify-center rounded-sm bg-muted text-[10px] font-semibold text-muted-foreground"
    data-testid="outlet-mark-monogram"
  >
    {monogramOf(name)}
  </span>
);

const HEADLINE_CLASS =
  "min-w-0 flex-1 font-medium leading-snug underline-offset-4 hover:text-primary hover:underline";

export const StoryTimeline = ({
  members,
  outlets,
  onShowAll,
}: {
  members: StoryMember[];
  outlets: Map<string, TimelineOutlet>;
  /**
   * T5.7 — the way out of a filtered-empty list. Pass it ONLY while a
   * selection is active: with it present the empty state is described as a
   * filter result and offers to clear BOTH axes (the label says so); without
   * it the list is described as empty. The „both axes" wording rests on the
   * caller's wiring — `StoryScreen` filters segments to `count > 0`, so one
   * axis alone always leaves a row — not on anything this component can
   * see; the one render between a story switch and the effect that resets
   * the previous story's filters is the known exception, and it self-heals.
   */
  onShowAll?: () => void;
}) => {
  const { language, tr } = useNewsLocale();
  const untitled = tr("без заглавие", "untitled");
  const days = groupByDay(members, language);
  if (days.length === 0) {
    return (
      <div
        role="status"
        className="py-4 text-sm text-muted-foreground"
        data-testid="timeline-empty"
      >
        <p>
          {onShowAll
            ? tr(
                "Няма материали, които да са едновременно в избраните сегменти по двете оси.",
                "No article sits in the selected segments on both axes at once.",
              )
            : tr("Няма материали.", "No articles.")}
        </p>
        {onShowAll ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={onShowAll}
          >
            {tr(
              "Покажи всички — изчиства избора и по двете оси",
              "Show all — clears the selection on both axes",
            )}
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="space-y-4" data-testid="story-timeline">
      {days.map((day) => (
        <div key={day.key}>
          <h3
            className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            data-testid="timeline-day"
          >
            {day.label ?? tr("Без дата на публикуване", "No publication date")}
          </h3>
          <ol className="ml-2 space-y-3 border-l pl-4">
            {day.members.map((m) => {
              const name = outlets.get(m.domain)?.outlet ?? m.domain;
              const title = m.title ?? `(${untitled})`;
              return (
                <li
                  key={`${m.domain}/${m.article_id ?? m.url}`}
                  className="relative"
                  data-testid="timeline-item"
                >
                  <span
                    aria-hidden
                    className="absolute -left-[21px] top-2 size-2 rounded-full bg-border"
                  />
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    {m.published ? (
                      <time dateTime={m.published} className="tabular-nums">
                        {formatTime(m.published, language)}
                      </time>
                    ) : (
                      <span aria-hidden className="tabular-nums">
                        —
                      </span>
                    )}
                    <OutletMark name={name} />
                    <Link
                      to={`/outlet/${m.domain}`}
                      className="min-w-0 truncate text-sm font-semibold text-foreground hover:text-primary"
                    >
                      {name}
                    </Link>
                    {m.scoop_decidable && m.first_here ? (
                      <span className="rounded-full border px-1.5 py-0.5 text-[10px] font-medium">
                        {tr("първи тук", "first here")}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-start gap-2">
                    {m.article_id ? (
                      <Link
                        to={`/article/${m.domain}/${m.article_id}`}
                        className={HEADLINE_CLASS}
                      >
                        {title}
                      </Link>
                    ) : m.url ? (
                      <ExternalHeadline
                        url={m.url}
                        title={m.title}
                        outlet={name}
                        className={HEADLINE_CLASS}
                      />
                    ) : (
                      <span className="min-w-0 flex-1 font-medium">
                        {title}
                      </span>
                    )}
                    {m.url && m.article_id ? (
                      <OriginalLink url={m.url} title={m.title} outlet={name} />
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <LeanBadge leaning={m.leaning} />
                    <StanceBadge stance={m.russia_stance} />
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
};
