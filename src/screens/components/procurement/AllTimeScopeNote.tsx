// „Тук виждате един прозорец — ето колко е за всички периоди."
//
// WHY IT EXISTS. The global search box ranks and labels a company or a buyer by its
// ALL-TIME procurement total (`search_contractors` / `search_awarders` take no date
// bound), and `/company/:eik` answers for one window. Even with the row now landing on
// `?pscope=all`, a reader who then narrows the scope — or who arrives from anywhere else
// — sees a figure that can be a rounding error of the one they came for. Measured
// 2026-09-02 on „Клет България" (130878827): €22,424,885 all-time against €3,969,914 in
// the default parliament window, and corpus-wide only 3.8% of contract money and 12.3% of
// contractors fall inside that window at all.
//
// So the page states BOTH, always, rather than leaving the reader to discover that a
// „Всички години" option exists. The awarder side has had the empty-window half of this
// since it was written („За всички периоди: …" + a one-click switch); this generalises it
// to the sell side and to the far commoner case where the window is not empty, merely
// small.
//
// ⚠️ ONE BASIS PER SENTENCE. `count` and `eur` must come from the same filter. The route's
// `summary` deliberately exposes `contracts` (every tag — it gates whether the procurement
// body renders at all) SEPARATELY from `contract_rows` (`tag = 'contract'`, the basis every
// money figure here uses); they are 1864 vs 1860 on the company above. Pass the second, or
// pass none — a count from one basis beside a sum from another is a sentence nobody
// measured.
//
// ⚠️ `allTimeCount` IS OPTIONAL BECAUSE THE FUNCTION MAY BE OLDER THAN THE BUNDLE.
// `contract_rows` arrived with this change, so a deployed `db` function that predates it
// returns undefined and the note renders money only. That degrades to a true, narrower
// sentence — never to „0 договора".

import { FC } from "react";
import { formatEurCompact } from "@/lib/currency";
import type { Scope } from "@/data/scope/useScope";

interface Props {
  /** The window the figures beside this note were measured over. */
  scope: Scope;
  /** Sum over the selected window, or null when the window holds nothing.
   *  ⚠️ Read ONLY by the inline mode, to decide whether the two figures differ at all.
   *  `emptyWindow` mode ignores it — its window is empty by construction. */
  scopedEur?: number | null;
  /** Sum over every period, `tag = 'contract'`. */
  allTimeEur: number;
  /** Contracts over every period on the SAME filter as `allTimeEur`, when known.
   *  ⚠️ Rendered ONLY in `emptyWindow` mode. The inline sub-line is money-only by design:
   *  the StatCard it sits under already prints a scoped count, and two counts on one card
   *  read as a contradiction rather than as two windows. */
  allTimeCount?: number | null;
  /** Switch the page to the full corpus. */
  onShowAll: () => void;
  lang: string;
  /** Render the standalone empty-window sentence instead of the inline sub-line. */
  emptyWindow?: boolean;
  /** „договора" (sell side) vs „възложени договора" (buy side). */
  side: "supplier" | "buyer";
}

export const AllTimeScopeNote: FC<Props> = ({
  scope,
  scopedEur,
  allTimeEur,
  allTimeCount,
  onShowAll,
  lang,
  emptyWindow = false,
  side,
}) => {
  const bg = lang === "bg";
  // ⚠️ THE TWO MODES GUARD DIFFERENTLY, AND COLLAPSING THEM DROPS A SENTENCE THE PAGE OWES.
  // `emptyWindow` mode replaces a line that used to be unconditional („Няма договори за
  // избрания период."), so it must ALWAYS render: 1,226 supplier EIKs have rows in the
  // corpus but no positive contract-tag total — 23 of them amendment-only, the exact case
  // the route's own comment says must still render — and a shared `allTimeEur > 0` guard
  // turned every one of those pages into a floating icon with no text at all. Only the
  // all-time PARAGRAPH is conditional there.
  const hasAllTime = scope !== "all" && allTimeEur > 0;
  // The inline sub-line has nothing to add when the page already shows every period, when
  // there is no all-time figure, or when the window IS the whole corpus (the two agree).
  // The one-euro slack is for float noise on a sum over ~10^5 rows, not a materiality
  // rule: anything a reader could notice is far above it.
  if (!emptyWindow && !(hasAllTime && allTimeEur > (scopedEur ?? 0) + 1))
    return null;
  const money = formatEurCompact(allTimeEur, lang);

  const showAll = (
    <button
      type="button"
      onClick={onShowAll}
      className="font-medium text-primary underline underline-offset-2 hover:no-underline"
    >
      {bg ? "Виж всички периоди" : "Show all periods"}
    </button>
  );

  if (emptyWindow) {
    // ⚠️ Locale-grouped, unlike the screen's module-level `num` (a hard-coded `bg-BG`
    // formatter). In English the „Договори" card therefore shows `1 860` and this shows
    // `1,860`. This half is the correct one; do not "fix" it by pinning bg-BG here.
    const count =
      allTimeCount != null && allTimeCount > 0
        ? `${allTimeCount.toLocaleString(bg ? "bg-BG" : "en-GB")} ${
            bg ? "договора на стойност " : "contracts worth "
          }`
        : "";
    return (
      <div className="space-y-1 text-sm text-muted-foreground">
        <p>
          {bg
            ? side === "buyer"
              ? "Няма възложени договори за избрания период."
              : "Няма договори за избрания период."
            : "No contracts in the selected period."}
        </p>
        {hasAllTime ? (
          <p>
            {bg ? "За всички периоди: " : "All periods: "}
            <span className="font-medium text-foreground tabular-nums">
              {count}
              {money}
            </span>{" "}
            {showAll}
          </p>
        ) : null}
      </div>
    );
  }

  // ⚠️ SELF-ANCHORING COPY („общо …", not „от …"). On the supplier card this line follows
  // „средно €X / договор", so a leading „от" attaches to the AVERAGE — the line directly
  // above it — rather than to the headline it is actually about. The two cards also place
  // the note differently, so the copy cannot rely on position.
  return (
    <div className="text-xs text-muted-foreground">
      <span className="tabular-nums">
        {bg ? "общо " : "total "}
        <span className="font-medium text-foreground">{money}</span>
        {bg ? " за всички периоди" : " across all periods"}
      </span>
      {" · "}
      {showAll}
    </div>
  );
};
