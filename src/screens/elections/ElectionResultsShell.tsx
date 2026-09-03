// The shared result surface (docs/plans/elections-hub-implementation-v1.md §4).
//
// PHASE 0 PROTOTYPE. It renders the grammar from a fixture so the order, the accessibility and
// the digest can be seen and gated before any generator exists. What it deliberately does NOT
// do yet: fetch (Phase 2's `useElectionSurface`), or mount a real map (Phase 2's adapters).
// The map slot renders its declared QUESTION and a placeholder in place of the map itself, so
// the DOM order and the text-equivalent rule are testable without pulling Leaflet in here.
//
// ⚠ THIS FILE MUST NOT IMPORT LEAFLET, D3 OR RECHARTS. §Phase 2 item 4, and it is what keeps
// the section route — which draws no map at all — free of the heavy vendor chunks (§10.1).
// Gated: `ElectionResultsShell.test.tsx` walks this module's static import closure.
//
// The order is §4's, and three parts of it are load-bearing rather than aesthetic:
//
//   1. THE RANKED RESULT PRECEDES THE MAP IN THE DOM. On mobile that is the visual order too,
//      and the list is the accessible result as well as the faster scan. The desktop side-by-
//      side is done with grid PLACEMENT, never `order`, so the DOM and the screen agree.
//   2. EVERY REGION IS A NAMED LANDMARK. Seven unlabelled `<section>`s are seven identical
//      "region" rows in a screen reader's landmark list, which is worse than none.
//   3. A MAP ALWAYS HAS A TEXT EQUIVALENT — here, the ranked result beside it. Colour is never
//      the only encoding of a winner or a state.
//
// ⚠ EVERY ID IS SCOPED BY `useId()`. §4.1's whole premise is that a reader wants this place's
// parliamentary AND local result, so two shells on one page is the expected case — and module
// -constant ids would make the second shell's landmarks point at the first shell's headings.

import { FC, useId } from "react";
import { useTranslation } from "react-i18next";
import {
  useSurfaceLabels,
  type RankedRowLabel,
} from "@/data/elections/useSurfaceLabels";
import type {
  ElectionSurfaceV1,
  ElectionStandout,
  ElectionSurfaceBallot,
  ElectionSurfaceFact,
  PlaceDigestCell,
} from "@/data/elections/surfaceTypes";
import {
  MAX_SURFACE_STANDOUTS,
  PLACE_DIGEST_MIN_CELLS,
  PLACE_DIGEST_ORDER,
} from "@/data/elections/surfaceTypes";
import {
  BALLOT_LABEL_KEYS,
  BASELINE_LABEL_KEYS,
  descriptorFor,
  FACT_BASIS_LABEL_KEYS,
  FACT_LABEL_KEYS,
  RANKED_COLUMN_LABEL_KEYS,
  SOURCE_LABEL_KEYS,
  STANDOUT_LABEL_KEYS,
  STATUS_LABEL_KEYS,
  type ElectionLevelDescriptor,
  type ElectionRankedColumn,
} from "./electionSurfaceDescriptors";
// The view labels already exist — reused rather than minted, so the digest and the
// `PlaceViewNav` pills above it cannot end up calling the same view two different things.
import { PLACE_VIEW_META } from "@/screens/components/placeViewMeta";

type Props = {
  surface: ElectionSurfaceV1;
  /** The cross-view digest. Absent on a section, and below the floor (§4.1). */
  digest?: PlaceDigestCell[];
  /** The view the reader is already on — its digest cell is dropped (§7.1). */
  currentView?: PlaceDigestCell["view"];
};

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

/** §7 caps standouts at three AND at one per category, so a place with three close contests
 *  does not spend the whole strip on one signal. A blind `.slice(0, 3)` satisfies the first
 *  cap and not the second, which is why the dedupe happens BEFORE the slice. */
const cappedStandouts = (
  all: readonly ElectionStandout[],
): ElectionStandout[] => {
  const seen = new Set<ElectionStandout["category"]>();
  const kept: ElectionStandout[] = [];
  for (const s of all) {
    if (seen.has(s.category)) continue;
    seen.add(s.category);
    kept.push(s);
    if (kept.length === MAX_SURFACE_STANDOUTS) break;
  }
  return kept;
};

/** A fact whose basis names the same quantity as the fact itself restates its own label as
 *  its denominator — "Действителни гласове · 168 · от действителните гласове". The caption is
 *  exactly right for `winner` / `turnout` / `margin` and noise here. */
const basisIsTautological = (f: ElectionSurfaceFact): boolean =>
  f.basis === (f.code as string);

/** What a resolved row header prints. ⚠ AN UNRESOLVED ID PRINTS THE ID. A blank row header
 *  beside a real vote count attributes a percentage to nobody; the id is ugly and honest, and
 *  it is also the only thing that tells a reader — or a bug report — which id failed. */
const entryLabel = (l: RankedRowLabel, t: (k: string) => string): string => {
  switch (l.kind) {
    case "party":
    case "local_list":
      return l.label;
    case "independent":
      return t("election_independent");
    case "unresolved":
      return l.id;
  }
};

const PlaceDigestStrip: FC<{
  cells: PlaceDigestCell[];
  currentView?: PlaceDigestCell["view"];
  titleId: string;
}> = ({ cells, currentView, titleId }) => {
  const { t } = useTranslation();
  const { rankedLabel: label } = useSurfaceLabels();
  // §7.1: the cell for the view the reader is on would restate the page they are looking at.
  const shown = cells
    .filter((c) => c.view !== currentView)
    .sort(
      (a, b) =>
        PLACE_DIGEST_ORDER.indexOf(a.view) - PLACE_DIGEST_ORDER.indexOf(b.view),
    );

  // ⚠ BELOW THE FLOOR THERE IS NO DIGEST. One or two cells in a four-column grid restate the
  // view pills directly above them (§4.1).
  if (shown.length < PLACE_DIGEST_MIN_CELLS) return null;

  return (
    <section
      aria-labelledby={titleId}
      className="my-4"
      data-surface-region="digest"
    >
      <h2 id={titleId} className="sr-only">
        {t("election_digest_title")}
      </h2>
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {shown.map((cell) => {
          const winner =
            cell.kind === "figure" && cell.view === "parliamentary"
              ? label({ partyId: cell.winnerPartyId })
              : undefined;
          const winnerName =
            winner && (winner.kind === "party" || winner.kind === "local_list")
              ? winner.label
              : "";
          return (
            <a
              key={cell.view}
              href={cell.to}
              data-digest-cell={cell.view}
              data-digest-kind={cell.kind}
              className="rounded-lg border bg-card p-3 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="block text-xs uppercase tracking-wide text-muted-foreground">
                {t(PLACE_VIEW_META[cell.view].labelKey)}
              </span>
              {cell.kind === "link" ? (
                // A LINK cell makes no claim, so it cannot go stale (§4.1).
                <span className="block text-sm">{t(cell.descriptorKey)}</span>
              ) : cell.view === "parliamentary" ? (
                <>
                  <span className="block text-lg font-semibold tabular-nums">
                    {cell.winnerPct.toFixed(2)}%
                  </span>
                  {/* ⚠ THE PERCENTAGE ALONE ANSWERS THE WRONG QUESTION. §4.1's parliamentary cell
                    is „who won here", and „39.84%" with no subject is a number a reader cannot
                    use. Resolved from the id, like every other label (§5.3) — and drawn only
                    when it RESOLVES: a bare id in a compact card names nobody, and the number
                    is already labelled by the view above it. The ranked table is where an
                    unresolved id is shown, because there it sits beside a real vote count. */}
                  {winnerName ? (
                    <span className="block text-sm" data-digest-winner>
                      {winnerName}
                    </span>
                  ) : null}
                </>
              ) : (
                // ⚠ THE MAYOR'S NAME AND NOTHING ELSE. A party line here looked obvious and is
                // unsupportable: `mayorPartyId` is null for an independent AND for a local-only
                // list, and the cell carries no name for the second — so „Независим" under a
                // local list's mayor would be this component inventing the distinction the
                // artifact cannot make, about a named person.
                <span className="block text-sm font-semibold">
                  {cell.mayorName}
                </span>
              )}
            </a>
          );
        })}
      </div>
    </section>
  );
};

const OutcomeStrip: FC<{
  facts: ElectionSurfaceFact[];
  titleId: string;
}> = ({ facts, titleId }) => {
  const { t } = useTranslation();
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
              {t(FACT_LABEL_KEYS[f.code])}
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

/** The cell for one declared column. The row HEADER (the party or candidate) is not a member
 *  of `ElectionRankedColumn` — it is drawn separately and is never optional. */
const rankedCell = (
  col: ElectionRankedColumn,
  row: ElectionSurfaceBallot["preview"][number],
  ballot: ElectionSurfaceBallot,
  electedLabel: string,
): string => {
  switch (col) {
    case "votes":
      return row.votes.toLocaleString("bg-BG");
    case "pct":
      return `${row.pct.toFixed(2)}%`;
    case "seats":
      return row.seats === undefined ? "" : row.seats.toLocaleString("bg-BG");
    case "margin":
      return row.marginPct === undefined
        ? ""
        : `${row.marginPct.toFixed(2)} pp`;
    case "round":
      return ballot.round === undefined ? "" : String(ballot.round);
    case "elected":
      // ⚠ ONLY THE POSITIVE IS RENDERED. A "не" against every losing candidate reads as a
      // verdict on them; the blank says the same thing and claims nothing.
      return row.isElected ? electedLabel : "";
  }
};

const RankedResult: FC<{
  ballot: ElectionSurfaceBallot;
  columns: readonly ElectionRankedColumn[];
}> = ({ ballot, columns }) => {
  const { t } = useTranslation();
  const { rankedLabel: label } = useSurfaceLabels();
  // ⚠ THE LEVEL'S DECLARED COLUMNS, not a fixed three. `elected` is the substantive one: on a
  // runoff the table otherwise shows 53.94% against 43.95% and leaves the reader to infer who
  // took the mayoralty, which is the single fact the page exists to answer.
  const cols = columns;
  const electedLabel = t("election_elected_yes");
  return (
    <table className="w-full text-sm" data-ranked-result={ballot.kind}>
      <caption className="sr-only">{t("election_ranked_caption")}</caption>
      <thead>
        <tr>
          <th scope="col" className="text-left">
            {t("election_col_entry")}
          </th>
          {cols.map((c) => (
            <th key={c} scope="col" className="text-right" data-ranked-col={c}>
              {t(RANKED_COLUMN_LABEL_KEYS[c])}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ballot.preview.map((row, i) => (
          <tr key={`${row.partyId ?? "ind"}-${i}`}>
            <th
              scope="row"
              className="text-left font-normal"
              data-entry-kind={row.candidateName ? "person" : label(row).kind}
            >
              {/* ⚠ A PERSON'S NAME RENDERS AS-IS and everything else resolves from its id at
                  render time (§5.3). `rankedLabel` is the one resolver: it also distinguishes a
                  local-only list — whose Bulgarian name travels on the row because no English
                  form exists anywhere in the corpus — from an id nothing can resolve, which is
                  SHOWN rather than blanked, because the row still carries a real vote count. */}
              {row.candidateName ?? entryLabel(label(row), t)}
            </th>
            {cols.map((c) => (
              <td
                key={c}
                className="text-right tabular-nums"
                data-ranked-cell={c}
              >
                {rankedCell(c, row, ballot, electedLabel)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
};

const OutcomeCanvas: FC<{
  ballot: ElectionSurfaceBallot;
  columns: readonly ElectionRankedColumn[];
  questionKey?: string;
}> = ({ ballot, columns, questionKey }) => {
  const { t } = useTranslation();
  return (
    <div
      // ⚠ GRID PLACEMENT, NOT `order`. The ranked result is FIRST in the DOM and stays first
      // on mobile; at `lg` the map is placed into column 1 and the list into column 2, so the
      // visual arrangement changes without the reading order changing.
      className="grid gap-3 grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]"
      data-outcome-canvas={ballot.kind}
    >
      <div className="lg:col-start-2 lg:row-start-1" data-canvas-slot="ranked">
        <RankedResult ballot={ballot} columns={columns} />
      </div>
      {ballot.map ? (
        <div
          className="lg:col-start-1 lg:row-start-1"
          data-canvas-slot="map"
          data-map-posture={ballot.map.posture}
          // WHICH ballot this map colours. §2 decision 9: on a multi-ballot page a map that
          // cannot name its ballot leaves a reader unable to tell mayor control from council
          // support. The fallback is the containing ballot, which is the only honest default.
          data-map-ballot={ballot.map.ballot ?? ballot.kind}
        >
          {/* Phase 0 renders the map's declared QUESTION and a placeholder rather than a real
              map: the adapters are Phase 2, and importing a map library here would put the
              heavy vendor chunks on the section route, which draws no map at all. */}
          {questionKey ? (
            <h3 className="text-sm font-medium" data-map-question>
              {t(questionKey)}
            </h3>
          ) : null}
          <p className="text-sm text-muted-foreground">
            {t("election_map_placeholder")}
          </p>
        </div>
      ) : null}
    </div>
  );
};

export const ElectionResultsShell: FC<Props> = ({
  surface,
  digest,
  currentView,
}) => {
  const { t } = useTranslation();
  const uid = useId();
  const rid = (part: string) => `election-${part}-${uid}`;
  const descriptor = descriptorFor(surface.kind, surface.place.level);
  const level: ElectionLevelDescriptor | null = descriptor.available
    ? descriptor
    : null;

  // ⚠ THE LEVEL'S declared priority decides WHICH facts show, not the order the producer
  // happened to emit them in — and the filter is what stops a level rendering a fact its own
  // descriptor says it never carries. `indexOf` returns -1 for an unlisted code, which would
  // sort it FIRST, so the filter is load-bearing rather than tidy.
  const shownFacts = level
    ? surface.facts
        .filter((f) => level.factPriority.includes(f.code))
        .sort(
          (a, b) =>
            level.factPriority.indexOf(a.code) -
            level.factPriority.indexOf(b.code),
        )
        .slice(0, level.maxFacts)
    : [];

  // §4.1/§7.1: a section has no digest at all. Enforced HERE rather than left to every call
  // site, because "the caller remembers" is not a rule anything can fail on.
  const digestCells =
    digest && surface.place.level !== "section" ? digest : undefined;

  return (
    <div
      data-surface-shell={surface.place.level}
      data-surface-kind={surface.kind}
    >
      {/* 1. scope — the cycle and the result status, named in words. */}
      <section aria-labelledby={rid("scope")} data-surface-region="scope">
        <h2 id={rid("scope")} className="sr-only">
          {t("election_scope_title")}
        </h2>
        <p className="text-sm text-muted-foreground" data-scope-status>
          {t(STATUS_LABEL_KEYS[surface.status.result])}
        </p>
      </section>

      {/* 2. the cross-view digest, above this election's own facts (§4.1). */}
      {digestCells ? (
        <PlaceDigestStrip
          cells={digestCells}
          currentView={currentView}
          titleId={rid("digest")}
        />
      ) : null}

      {/* 3. this election's outcome facts. */}
      <OutcomeStrip facts={shownFacts} titleId={rid("facts")} />

      {/* 4. the canvas, one per ballot — never merged (§2 decision 4). */}
      {surface.ballots.map((b) => {
        // ⚠ THE ROUND IS IN THE ID, not only in the React key. A runoff municipality carries
        // the same ballot KIND twice, and two nodes sharing an id make both landmarks announce
        // the first heading — invisible to a `querySelector`-based check, which finds the
        // first of the duplicates and reports the reference as resolved.
        const slug = `${b.kind}-${b.round ?? 1}`;
        return (
          <section
            key={slug}
            aria-labelledby={rid(`ballot-${slug}`)}
            className="my-4"
            data-surface-region="canvas"
          >
            <h2 id={rid(`ballot-${slug}`)} className="text-lg font-semibold">
              {t(BALLOT_LABEL_KEYS[b.kind])}
            </h2>
            <OutcomeCanvas
              ballot={b}
              columns={level?.rankedColumns ?? []}
              questionKey={
                b.map
                  ? level?.maps.find(
                      (m) =>
                        (m.ballot ?? b.kind) === b.kind &&
                        m.defaultMode === b.map!.defaultMode,
                    )?.questionKey
                  : undefined
              }
            />
          </section>
        );
      })}

      {/* An absent ballot is "not held here", never zero votes (§8). */}
      {surface.ballots.length === 0 ? (
        <section
          aria-labelledby={rid("empty")}
          className="my-4"
          data-surface-region="empty"
        >
          <h2 id={rid("empty")} className="sr-only">
            {t("election_empty_title")}
          </h2>
          <p className="text-sm text-muted-foreground" data-empty-state>
            {/* ⚠ THE DESCRIPTOR'S OWN reason, never a literal. `ElectionLevelUnavailable`
                exists so the absence is a decision on the record; hardcoding the one entry
                that exists today makes the SECOND one render the wrong reason at a 200. */}
            {t(
              descriptor.available
                ? descriptor.emptyStateKey
                : descriptor.reasonKey,
            )}
          </p>
        </section>
      ) : null}

      {/* 5. standouts — review leads, never verdicts. */}
      {surface.standouts.length > 0 ? (
        <section
          aria-labelledby={rid("standouts")}
          className="my-4"
          data-surface-region="standouts"
        >
          <h2 id={rid("standouts")} className="text-lg font-semibold">
            {t("election_standouts_title")}
          </h2>
          <ul>
            {cappedStandouts(surface.standouts).map((s) => (
              <li
                key={s.id}
                data-standout={s.signal}
                data-standout-category={s.category}
                data-standout-baseline={s.baseline.kind}
              >
                {t(STANDOUT_LABEL_KEYS[s.signal], s.labelParams)}{" "}
                {/* ⚠ THE BASELINE TRAVELS WITH THE CLAIM. A review lead about a named place
                    with its measurement withheld is the one output here that asserts more
                    than it can support (§7). */}
                <span className="text-muted-foreground" data-standout-basis>
                  {t(
                    BASELINE_LABEL_KEYS[s.baseline.kind],
                    s.baseline.labelParams,
                  )}
                </span>{" "}
                <a href={s.evidenceTo}>{t("election_standout_evidence")}</a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* 6. source and method — the thresholds a reader needs to judge "stands out". */}
      <section
        aria-labelledby={rid("source")}
        className="my-4"
        data-surface-region="source"
      >
        <h2 id={rid("source")} className="sr-only">
          {t("election_source_title")}
        </h2>
        <p className="text-xs text-muted-foreground">
          {t(SOURCE_LABEL_KEYS[surface.status.sourceLabel])}
        </p>
      </section>
    </div>
  );
};
