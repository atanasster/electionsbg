// The outcome strip — the row of KPI cards `/parliamentary` opens with, extracted so it has ONE
// definition (Phase 4; `docs/plans/presidential-elections-v1.md` §9).
//
// ⚠ EXTRACTED RATHER THAN COPIED, and the reason is the usual one. `ElectionResultsShell` owns
// this band for every kind it renders, but the presidential COUNTRY level is `canonical` and
// draws its own page — so the alternative was a second grid on `/presidential/:cycle` that
// looked like this one on the day it was written and drifted the first time a card's padding,
// its basis caption or its `data-fact` hook moved. The two bands are the same component or they
// are not the same band.
//
// ⚠ THIS FILE MUST NOT IMPORT LEAFLET, D3 OR RECHARTS — it is inside the shell's static closure
// and `ElectionResultsShell.test.tsx` walks it.
//
// ⚠ AND IT DOES NOT PICK THE FACTS. Which codes a level may show, in what order and how many, is
// the DESCRIPTOR's answer (`factPriority` / `maxFacts`); this renders what it is handed. A grid
// that filtered would be a second opinion about a level's strip, in the one file where both
// callers would look correct.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import {
  FACT_BASIS_LABEL_KEYS,
  FACT_LABEL_KEYS,
} from "./electionSurfaceDescriptors";
import {
  useSurfaceLabels,
  type RankedRowLabel,
} from "@/data/elections/useSurfaceLabels";
import type { ElectionSurfaceFact } from "@/data/elections/surfaceTypes";

/** Format a fact's value for display. Numbers only — the LABEL comes from i18n and the party
 *  name from the canonical corpus at render time (§5.3). */
const factValue = (f: ElectionSurfaceFact): string => {
  if (f.value === undefined) return "";
  switch (f.unit) {
    case "pct":
      return `${f.value.toFixed(2)}%`;
    case "pct_point":
      return `${f.value > 0 ? "+" : ""}${f.value.toFixed(2)} pp`;
    case "votes":
    case "count":
    case "seats":
      return f.value.toLocaleString("bg-BG");
    default:
      return String(f.value);
  }
};

/** A fact whose basis names the same quantity as the fact itself restates its own label as
 *  its denominator — "Действителни гласове · 168 · от действителните гласове". The caption is
 *  exactly right for `winner` / `turnout` / `margin` and noise here. */
const basisIsTautological = (f: ElectionSurfaceFact): boolean =>
  f.basis === (f.code as string);

/** A fact's label, WITH its interpolation values.
 *
 *  ⚠ `labelParams` WAS DECLARED, POPULATED AND DROPPED. The schema documents it as
 *  "interpolation values for the label" and the strip rendered `t(FACT_LABEL_KEYS[f.code])`
 *  with no second argument — harmless while no artifact carried any, and wrong the moment the
 *  local country and region levels were switched on: measured, all 62 `labelParams`-bearing
 *  facts in the corpus belong to those two levels and every other level has none.
 *
 *  ⚠ THE DAMAGE IS A TRUE NUMBER WITH NO REFERENT, which is worse than a missing one. The
 *  country card read „Първи · 106" — 106 MAYORALTIES — sitting directly above a council table
 *  whose top row is ГЕРБ with 521,444 votes, so the adjacent table supplied a false referent for
 *  a figure measured on a different ballot in a different unit.
 *
 *  ⚠ THE PARTY-BEARING KEY IS A SEPARATE ONE, not the same key with an optional placeholder.
 *  i18next leaves an unmatched `{{party}}` in the output verbatim, so a single
 *  „Първи · {{party}}" would render the braces on every level that carries no params — which is
 *  every other level in the corpus. */
const factLabel = (
  f: ElectionSurfaceFact,
  t: (k: string, o?: Record<string, string | number>) => string,
  label: (e: {
    partyId: string | null;
    localPartyName?: string;
    isIndependent?: boolean;
  }) => RankedRowLabel,
): string => {
  const partyId = f.labelParams?.partyId;
  if (typeof partyId !== "string" || !partyId)
    return t(FACT_LABEL_KEYS[f.code]);
  const resolved = label({ partyId, isIndependent: false });
  // An id the canonical corpus cannot name resolves to `unresolved`, and printing a raw
  // `p_16` beside a seat count is worse than printing no party at all.
  if (resolved.kind !== "party") return t(FACT_LABEL_KEYS[f.code]);
  const keyed = `${FACT_LABEL_KEYS[f.code]}_party`;
  return t(keyed, { party: resolved.label });
};

export const ElectionFactsGrid: FC<{
  facts: ElectionSurfaceFact[];
  titleId: string;
}> = ({ facts, titleId }) => {
  const { t } = useTranslation();
  // The SAME resolver the ranked rows use, so a party named in a fact and the same party named
  // in the table beneath it cannot come out differently.
  const { rankedLabel: label } = useSurfaceLabels();
  // ⚠ SLICE FIRST, THEN GUARD. On an unavailable kind × level `maxFacts` is 0, so guarding on
  // the INPUT renders a named landmark — "Основни резултати" — wrapping an empty grid.
  if (facts.length === 0) return null;
  return (
    <section
      aria-labelledby={titleId}
      className="my-4"
      data-surface-region="facts"
    >
      <h2 id={titleId} className="sr-only">
        {t("election_facts_title")}
      </h2>
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {facts.map((f, i) => (
          <div
            key={`${f.code}-${f.ballot ?? ""}-${i}`}
            data-fact={f.code}
            className="rounded-lg border bg-card p-3"
          >
            <span className="block text-xs uppercase tracking-wide text-muted-foreground">
              {factLabel(f, t, label)}
            </span>
            {/* A qualitative fact (`split_control`, `runoff_pending`) carries no value, and an
                empty `text-2xl` box is a blank line the height of a number. */}
            {factValue(f) ? (
              <span className="block text-2xl font-bold tabular-nums">
                {factValue(f)}
              </span>
            ) : null}
            {/* The basis, in the reader's words, under the value — §0's "state the
                denominator in one clause", done as visual design. */}
            {f.basis && !basisIsTautological(f) ? (
              <span className="block text-xs text-muted-foreground">
                {t(FACT_BASIS_LABEL_KEYS[f.basis])}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
};
