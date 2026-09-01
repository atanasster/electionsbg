// One row of the „what changed" feed.
//
// ⚠️ THE DATE LABEL IS THE POINT OF THIS COMPONENT. Every row carries a `dateBasis`, and the
// five bases are five different claims: a sitting HAPPENED on its date, a call TAKES EFFECT
// on its opening day, and a row dated by `first_seen` only means we FOUND it then. Rendering
// all five as „14 март" would make the feed assert things about the world that its sources
// never said — which is the whole reason the artifact carries the basis rather than one
// pre-resolved date.
//
// ⚠️ AND THE COUNTDOWN IS COMPUTED HERE, NOT STORED. `deadlineAt` is a fact in the artifact;
// „остават 3 дни" is a function of the reader's clock. Frozen into a published file it would
// be wrong the day after generation — the `open_calls` (142) rule one layer up.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { formatDate } from "@/lib/formatDate";
import type { HomeEventV1 } from "@/data/home/homeTypes";
import { daysUntil } from "./daysUntil";

export const HomeChangeCard: FC<{ event: HomeEventV1 }> = ({ event }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  const shown =
    event.dateBasis === "occurred"
      ? event.occurredAt
      : event.dateBasis === "published"
        ? event.publishedAt
        : event.dateBasis === "effective"
          ? event.effectiveAt
          : event.dateBasis === "deadline"
            ? event.deadlineAt
            : event.firstSeenAt;

  const left = event.deadlineAt ? daysUntil(event.deadlineAt) : null;

  return (
    <li className="border-b last:border-b-0">
      <Link
        to={event.route}
        className="group flex items-start gap-3 py-2.5 -mx-1 px-1 rounded-sm transition-colors hover:bg-accent/30"
      >
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium leading-snug">
            {t(event.factKey, event.factArgs)}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-muted-foreground tabular-nums">
            {/* The basis, in words, BEFORE the date — so „намерено" and „проведено" are read
                as part of the same phrase rather than as a badge beside a bare date. */}
            {/* ⚠️ NO DATE, NO LABEL. `dateBasis` names a field that may be absent — the
                generator refuses such a row, but a stale artifact or a future adapter could
                still send one, and „проведено на " with nothing after it is a worse answer
                than saying nothing. Falling back to `firstSeenAt` would be worse still: it
                would relabel a missing occurrence as one we found. */}
            {shown ? (
              <span>
                {t(`home_date_basis_${event.dateBasis}`, {
                  date: formatDate(shown.slice(0, 10), lang),
                })}
              </span>
            ) : null}
            {left !== null ? (
              <span className="rounded bg-accent/50 px-1 py-px font-medium not-italic text-foreground/80">
                {t("home_event_days_left", { count: left })}
              </span>
            ) : null}
            {event.backfill ? (
              // A bulk load is not news, and saying so is what keeps it from reading as one.
              <span className="rounded bg-muted px-1 py-px">
                {t("home_event_backfill")}
              </span>
            ) : null}
            {!event.coverage.complete && event.coverage.noteKey ? (
              // „No resolutions near you" is almost always „we do not read your council".
              <span>· {t(event.coverage.noteKey)}</span>
            ) : null}
          </div>
        </div>
        <ChevronRight className="mt-1 size-3 shrink-0 text-muted-foreground opacity-50 transition-opacity group-hover:opacity-100" />
      </Link>
    </li>
  );
};
