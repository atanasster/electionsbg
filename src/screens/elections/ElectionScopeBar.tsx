// The cycle and the result status, in words (§4 item 1).
//
// ⚠ IT COMPOSES INTO `PlaceHeader`, NEVER UNDER IT. §4's grammar puts the cycle/status INSIDE
// the header block, beside the `PlaceViewNav` pills — a second control strip below them reads
// as another thing to operate, and stacks two rows of chrome above the first number on the
// page. That is the whole reason this is a component rather than a section of the shell: one
// definition, two placements, and the shell stops rendering its own copy when the header has it.
//
// ⚠ THE CYCLE IS A FORMATTED DATE, NEVER THE FOLDER ID. `ScopeControl`'s default pill read
// „Този парламент · 2026-04-19" on all 31 surfaces that mount it. `formatDate` also pins
// `timeZone: "UTC"` for a date-only value, without which a calendar day renders as the previous
// one for every reader west of Greenwich — which shipped on 613 pages.
//
// ⚠ "final" IS OMITTED, NOT LABELLED. It is the common case — nearly every page on the site
// shows final results — so spelling it out on every one is boilerplate rather than information.
// The other four statuses (projection/provisional/runoff_pending/partial_election) DO say so,
// because each is the exception a reader needs to be told about.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { formatDate } from "@/lib/formatDate";
import { STATUS_LABEL_KEYS } from "./electionSurfaceDescriptors";
import { cycleIsoDate } from "./cycleIsoDate";
import type { ElectionResultStatus } from "@/data/elections/surfaceTypes";

export const ElectionScopeBar: FC<{
  /** The election folder id, or an ISO date when the caller already has one. */
  cycle: string;
  status: ElectionResultStatus;
  /** Round 1 or 2 — a mayoral contest, or a presidential cycle. Absent on a list ballot,
   *  which has no rounds. */
  round?: number;
  className?: string;
}> = ({ cycle, status, round, className }) => {
  const { t, i18n } = useTranslation();
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(cycle) ? cycle : cycleIsoDate(cycle);
  const hasRound = round !== undefined;
  const showStatus = status !== "final";
  return (
    <p
      className={`text-sm text-muted-foreground ${className ?? ""}`}
      data-surface-region="scope"
      data-scope-status={status}
    >
      {/* ⚠ AN UNPARSEABLE CYCLE PRINTS NOTHING RATHER THAN THE ID. `formatDate` passes an
          unparseable string through VERBATIM, so a fallback to `cycle` here is exactly the
          folder-id-as-label defect one step along. */}
      {iso ? (
        <span data-scope-cycle>{formatDate(iso, i18n.language)}</span>
      ) : null}
      {hasRound ? (
        <>
          {iso ? " · " : null}
          <span data-scope-round>{t("election_round", { round })}</span>
        </>
      ) : null}
      {showStatus ? (
        <>
          {iso || hasRound ? " · " : null}
          <span>{t(STATUS_LABEL_KEYS[status])}</span>
        </>
      ) : null}
    </p>
  );
};
