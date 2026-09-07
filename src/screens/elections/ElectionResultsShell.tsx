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
  CANVAS_GRID_CLASS,
  CANVAS_MAP_SLOT_CLASS,
  CANVAS_RANKED_SLOT_CLASS,
} from "./electionSurfaceLayout";
import { ElectionMapPanel } from "./ElectionMapPanel";
// ⚠ THE STRIP LIVES IN ITS OWN MODULE because a second surface renders it: the presidential
// COUNTRY level is `canonical` and draws its own page, so the band there must be this component
// rather than a lookalike. See `ElectionFactsGrid`'s header.
import { ElectionFactsGrid } from "./ElectionFactsGrid";
import { ElectionScopeBar } from "./ElectionScopeBar";
import { trackSurfaceLink } from "./electionSurfaceAnalytics";
import { adapterKey, type ElectionMapAdapterProps } from "./electionMapSlots";
import {
  useSurfaceLabels,
  type RankedRowLabel,
} from "@/data/elections/useSurfaceLabels";
// ⚠ THE LEAF, NOT `@/lib/utils`. Same function, re-exported there — but `utils` carries `cn`,
// and importing it here put `clsx` + `tailwind-merge` into this file's static closure and took
// the shell from 10,300 to 16,968 B brotli against a 10,440 budget.
import { partyHref } from "@/lib/partyHref";
import type {
  ElectionDestination,
  ElectionKind,
  ElectionPlaceLevel,
  ElectionSurfaceV1,
  ElectionStandout,
  ElectionRankedEntry,
  ElectionSurfaceBallot,
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
  RANKED_COLUMN_LABEL_KEYS,
  SOURCE_LABEL_KEYS,
  UNAVAILABLE_REASON_LABEL_KEYS,
  STANDOUT_LABEL_KEYS,
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
  /** Where the cycle/status is rendered. ⚠ `"header"` on a migrated result page: §4 composes
   *  the scope INTO `PlaceHeader` beside the view pills, and a shell that also drew it would
   *  print the same two words twice and stack a second control row under them. */
  /** A screen that ALWAYS draws a map hands its adapter in already-loaded, so the map libraries
   *  are fetched in parallel with the screen instead of two hops behind it. See
   *  `ElectionMapPanel`'s `preloaded` for why only such a screen may do this. */
  preloadedMap?: FC<ElectionMapAdapterProps>;
  scope?: "shell" | "header";
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
  /** The surface's own coordinates, for the click event only — the cells carry their own
   *  destinations and need none of this to render. */
  kind: ElectionKind;
  level: ElectionPlaceLevel;
  placeId: string;
}> = ({ cells, currentView, titleId, kind, level, placeId }) => {
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
              onClick={() =>
                trackSurfaceLink({
                  target: "digest",
                  kind,
                  level,
                  placeId,
                  view: cell.view,
                })
              }
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
    case "delta":
      // ⚠ SIGNED, AND IN pp. „13,00" and „−13,00" are opposite claims about a party, so the
      // sign is not decoration; and the unit is the one `margin` prints one column over,
      // because a „%" here would relabel a CHANGE in share as a share.
      return row.deltaPct === undefined
        ? ""
        : `${row.deltaPct > 0 ? "+" : ""}${row.deltaPct.toFixed(2)} pp`;
    case "round":
      return ballot.round === undefined ? "" : String(ballot.round);
    case "elected":
      // ⚠ ONLY THE POSITIVE IS RENDERED. A "не" against every losing candidate reads as a
      // verdict on them; the blank says the same thing and claims nothing.
      return row.isElected ? electedLabel : "";
  }
};

/** Whether THIS ballot has anything to put in that column.
 *
 *  ⚠ ABSENCE, NOT EMPTINESS. A party that genuinely won no seats is `seats: 0` and the column
 *  stays; a producer with no seat data leaves `undefined` on every row and it goes. The two look
 *  identical in a rendered cell and are opposite facts, which is why this tests the field rather
 *  than the formatted string.
 *
 *  ⚠ IT SAMPLES THE PREVIEW, NOT THE BALLOT. `preview` is the producer's top-N (≤8 rows), so a
 *  column filled only on row 9 would be dropped. That is the right trade here — the table
 *  renders exactly those rows, so a column no RENDERED row fills is a blank column to the
 *  reader whatever the full result holds — but it is a statement about the table, not about the
 *  ballot, and a future consumer that renders more rows must re-check against what it draws. */
const ballotFillsColumn = (
  ballot: ElectionSurfaceBallot,
  col: ElectionRankedColumn,
): boolean => {
  const some = (f: (r: ElectionRankedEntry) => boolean) =>
    ballot.preview.some(f);
  switch (col) {
    case "round":
      return ballot.round !== undefined;
    case "seats":
      return some((r) => r.seats !== undefined);
    case "margin":
      return some((r) => r.marginPct !== undefined);
    case "delta":
      // Absent on every row means this cycle has no prior to compare against — a first cycle,
      // or a producer that carries none — and the column goes rather than printing a blank one.
      return some((r) => r.deltaPct !== undefined);
    case "elected":
      return some((r) => r.isElected !== undefined);
    // ⚠ NAMED, NOT `default`. `rankedCell` switches exhaustively over the same union, so a
    // seventh column added there would be a compile error; a `default: true` here would have
    // silently declared it fillable and let a blank column through — the exact defect this
    // helper exists to catch, reintroduced by the shape of its own fallback.
    //
    // ⚠ AND THESE TWO ARE NON-OPTIONAL IN THE SCHEMA, so a producer with nothing to say writes
    // 0 and this can never see it. That case is real — `local/region` did exactly that — and is
    // why the placeholder half of the problem has to be fixed where the column is DECLARED.
    // `true` here says only "this check cannot speak to those two".
    case "votes":
    case "pct":
      return true;
  }
};

/** The two columns the party tile printed one size down — the vote count in muted text and the
 *  change beside it. Cosmetic on a wide canvas and not on a phone: at 375 px the five columns
 *  wanted 403 px in a 359 px box, so the last one could only be reached by scrolling. */
const SMALL_CELL: Partial<Record<ElectionRankedColumn, string>> = {
  votes: "text-xs text-muted-foreground",
  delta: "text-xs",
};

/** The class for a signed change — the same three the party tile used, so „падна" and „вдигна се"
 *  are not carried by the sign alone. ⚠ ZERO IS ITS OWN CASE and must stay muted: a green „0,00"
 *  reads as a gain. */
const deltaToneClass = (d: number): string =>
  d > 0 ? "text-positive" : d < 0 ? "text-negative" : "text-muted-foreground";

const RankedResult: FC<{
  ballot: ElectionSurfaceBallot;
  columns: readonly ElectionRankedColumn[];
  /** The cycle this ballot was cast in. ⚠ REQUIRED FOR THE LINK, not decoration: `/party/:id`
   *  is keyed on the nickname the CEC printed for THAT election. */
  cycle: string;
  /** Where "the complete result" lives — the caption's „виж детайли" leaf. The SURFACE's
   *  destination rather than the ballot's raw one, because only that one is marked
   *  `same_page`, and a caption linking to the page it is on is the dead link §Phase 7
   *  removed from the standouts. */
  details?: ElectionDestination;
  /** The surface's own coordinates, for the click event only. */
  kind: ElectionKind;
  level: ElectionPlaceLevel;
  placeId: string;
}> = ({ ballot, columns, cycle, details, kind, level, placeId }) => {
  const { t } = useTranslation();
  const { rankedLabel: label, partySlug } = useSurfaceLabels();
  // ⚠ THE LEVEL'S DECLARED COLUMNS, not a fixed three. `elected` is the substantive one: on a
  // runoff the table otherwise shows 53.94% against 43.95% and leaves the reader to infer who
  // took the mayoralty, which is the single fact the page exists to answer.
  //
  // ⚠ NARROWED TO WHAT THIS BALLOT CAN FILL, because `rankedColumns` is declared PER LEVEL and a
  // level can carry two ballots that answer different questions. `local/municipality` declares
  // `round` and `elected` for its mayor ballot — where they are the whole point — and its
  // council ballot fills neither: measured, all 289 published municipality surfaces rendered
  // „Тур" and „Избран" as two headers over blank columns on the council table.
  //
  // ⚠ THIS IS NOT THE SAME FIX AS NARROWING A DECLARATION, and neither replaces the other. A
  // producer that writes a PLACEHOLDER — `votes: 0` on a level with no vote total — fills the
  // column as far as this check can tell, and would still print a fabricated zero; that one has
  // to be caught where the column is declared. This catches the other half: a column that is
  // real somewhere on the level and absent on this ballot.
  // ⚠ NO `useMemo`. At most six columns against a ≤8-row preview is ~40 comparisons, nothing
  // downstream depends on referential equality, and the call site passes `?? []` — a fresh
  // array on every render, which defeats the memo it would be protecting.
  const cols = columns.filter((c) => ballotFillsColumn(ballot, c));
  const electedLabel = t("election_elected_yes");
  // ⚠ THE BAR IS SCALED TO THE LEADER, NOT TO 100%. That is the scale the party tile this canvas
  // replaced used, and the only one on which a 3% row is a visible bar rather than a hairline.
  // It is a comparison WITHIN the preview and never a claim about the whole ballot, which is why
  // the share itself is printed beside it.
  const maxPct = Math.max(1, ...ballot.preview.map((r) => r.pct));
  return (
    // ⚠ THE TABLE SCROLLS INSIDE ITS OWN BOX RATHER THAN OFF THE PAGE. Measured on the running
    // page at 375 px, with the bar and the change column in: the table wants 393 px in a 359 px
    // slot (423 before the vote count and the change dropped to `text-xs`), and the slot's own
    // `overflow: visible` simply CUT the last column off — a „Места" header over a number
    // nobody on a phone could reach. The four columns the party tile had are inside 359 px;
    // „Места" is the one this canvas keeps beyond it, and it is the one that scrolls.
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-ranked-result={ballot.kind}>
        {/* ⚠ THE CAPTION IS VISIBLE NOW, and it is still the table's `<caption>` rather than an
          `<h3>` beside it — one element, so a screen reader is not read the same title twice,
          and the map slot's own question heading gets a counterpart on the list. */}
        {/* ⚠ THE FLEX GOES ON A SPAN INSIDE, NEVER ON THE `<caption>`. `display: flex` overrides
          `display: table-caption`, so the element stops being the table's caption box and is
          laid out as an anonymous box beside the first column — measured on the running page:
          the title and its link rendered INSIDE the header row, squeezing every column. */}
        <caption className="mb-2 text-left">
          <span className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">
              {t("election_ranked_caption")}
            </span>
            {details?.available && details.to ? (
              <a
                href={details.to}
                className="text-xs text-primary hover:underline"
                onClick={() =>
                  trackSurfaceLink({
                    target: "complete_result",
                    kind,
                    level,
                    placeId,
                  })
                }
                data-ranked-details
              >
                {t("dashboard_see_details")} →
              </a>
            ) : null}
          </span>
        </caption>
        <thead>
          <tr>
            <th scope="col" className="text-left">
              {t("election_col_entry")}
            </th>
            {cols.map((c) => (
              <th
                key={c}
                scope="col"
                className="text-right pl-2 sm:pl-3 font-normal"
                data-ranked-col={c}
              >
                {t(RANKED_COLUMN_LABEL_KEYS[c])}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ballot.preview.map((row, i) => {
            const l = label(row);
            // ⚠ THE COLOUR AND THE LINK ARE THE SAME QUESTION, asked of the corpus rather than of
            // the row: only a resolved canonical party has either. A local list, an independent
            // and an unresolved id each render as plain text with no dot — which is the honest
            // answer, and never a grey dot standing in for a party nobody could name.
            const color = l.kind === "party" ? l.color : undefined;
            const slug =
              l.kind === "party" ? partySlug(row.partyId, cycle) : undefined;
            const barPct = Math.max(2, (row.pct / maxPct) * 100);
            return (
              <tr key={`${row.partyId ?? "ind"}-${i}`}>
                <th
                  scope="row"
                  className="text-left font-normal py-1"
                  data-entry-kind={row.candidateName ? "person" : l.kind}
                >
                  {/* ⚠ A PERSON'S NAME RENDERS AS-IS and everything else resolves from its id at
                    render time (§5.3). `rankedLabel` is the one resolver: it also distinguishes
                    a local-only list — whose Bulgarian name travels on the row because no
                    English form exists anywhere in the corpus — from an id nothing can resolve,
                    which is SHOWN rather than blanked, because the row still carries a real
                    vote count. */}
                  <span className="flex items-center gap-2 min-w-0">
                    {color ? (
                      <span
                        aria-hidden
                        className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: color }}
                      />
                    ) : null}
                    {slug ? (
                      <a
                        href={partyHref(slug)}
                        className="truncate font-medium"
                        onClick={() =>
                          trackSurfaceLink({
                            target: "ranked_entry",
                            kind,
                            level,
                            placeId,
                          })
                        }
                        data-ranked-entry-link
                      >
                        {row.candidateName ?? entryLabel(l, t)}
                      </a>
                    ) : (
                      <span className="truncate">
                        {row.candidateName ?? entryLabel(l, t)}
                      </span>
                    )}
                  </span>
                </th>
                {cols.map((c) => {
                  const v = rankedCell(c, row, ballot, electedLabel);
                  return (
                    <td
                      key={c}
                      className={`text-right tabular-nums pl-2 sm:pl-3 py-1 ${SMALL_CELL[c] ?? ""}`}
                      data-ranked-cell={c}
                    >
                      {c === "pct" ? (
                        <span className="flex items-center justify-end gap-2">
                          {/* ⚠ ONE ELEMENT AND A GRADIENT, not a track with a fill inside it. Two
                            nested spans per row is ~80 B brotli in a file with a ratchet on it,
                            and `background-image` over the track's own `bg-muted` paints the
                            same bar. ⚠ `aria-hidden`: the bar IS the number beside it, and a
                            screen reader reading both says the share twice. */}
                          <span
                            aria-hidden
                            className="h-2 min-w-[28px] flex-1 rounded-full bg-muted"
                            style={{
                              backgroundImage: `linear-gradient(to right, ${color ?? "#888"} ${barPct}%, transparent ${barPct}%)`,
                            }}
                          />
                          <span>{v}</span>
                        </span>
                      ) : c === "delta" && row.deltaPct !== undefined ? (
                        <span className={deltaToneClass(row.deltaPct)}>
                          {v}
                        </span>
                      ) : (
                        v
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const OutcomeCanvas: FC<{
  ballot: ElectionSurfaceBallot;
  columns: readonly ElectionRankedColumn[];
  /** The cycle, for the ranked rows' party links — see `RankedResult`. */
  cycle: string;
  /** "The complete result", offered from the ranked caption — see `RankedResult`. */
  details?: ElectionDestination;
  questionKey?: string;
  /** A screen that ALWAYS draws a map may hand its adapter in already-loaded, so the browser
   *  fetches the map libraries in parallel with the screen rather than two hops behind it. See
   *  `ElectionMapPanel`'s `preloaded`. Omitted everywhere else, which keeps Leaflet off the
   *  routes that draw no map — the reason the registry is lazy at all. */
  preloadedMap?: FC<ElectionMapAdapterProps>;
  /** The surface's own coordinates — the adapter is chosen by kind × level × mode (§6). */
  kind: ElectionKind;
  level: ElectionPlaceLevel;
  placeId: string;
}> = ({
  ballot,
  columns,
  cycle,
  details,
  questionKey,
  kind,
  level,
  placeId,
  preloadedMap,
}) => {
  const { t } = useTranslation();
  return (
    <div
      // ⚠ GRID PLACEMENT, NOT `order`. The ranked result is FIRST in the DOM and stays first
      // on mobile; at `lg` the map is placed into column 1 and the list into column 2, so the
      // visual arrangement changes without the reading order changing.
      className={CANVAS_GRID_CLASS}
      data-outcome-canvas={ballot.kind}
    >
      <div className={CANVAS_RANKED_SLOT_CLASS} data-canvas-slot="ranked">
        <RankedResult
          ballot={ballot}
          columns={columns}
          cycle={cycle}
          details={details}
          kind={kind}
          level={level}
          placeId={placeId}
        />
      </div>
      {ballot.map ? (
        <div
          className={CANVAS_MAP_SLOT_CLASS}
          data-canvas-slot="map"
          // ⚠ THE /parliamentary CARD'S CLIP ANCHOR, moved here with the map it frames. It was
          // on `DashboardCards`' map/party grid until that pair became this canvas; the capture
          // waits on a map PATH rather than on this element, because both halves render a
          // lucide icon — itself an `<svg>` — at mount.
          data-og="parliamentary-result"
          data-map-posture={ballot.map.posture}
          // WHICH ballot this map colours. §2 decision 9: on a multi-ballot page a map that
          // cannot name its ballot leaves a reader unable to tell mayor control from council
          // support. The fallback is the containing ballot, which is the only honest default.
          data-map-ballot={ballot.map.ballot ?? ballot.kind}
        >
          {questionKey ? (
            <h3 className="text-sm font-medium" data-map-question>
              {t(questionKey)}
            </h3>
          ) : null}
          {/* ⚠ THE SLOT IS `presentational` AND THAT IS A STATEMENT OF FACT, not a placeholder
              value. An `interactive` posture requires an `onSelect` and a labelled feature per
              region — the type refuses anything less, because a feature wired for selection
              with no label is silently mouse-only — and the selection binding between map and
              ranked list is Phase 4's. Declaring `interactive` here to match the artifact's own
              `posture` would be the shell asserting a keyboard contract it cannot honour.
              `features: []` for the same reason: the artifact carries no geography, the
              adapter reads its own. */}
          <ElectionMapPanel
            adapter={adapterKey(kind, level, ballot.map.defaultMode)}
            preloaded={preloadedMap}
            placeId={placeId}
            // ⚠ THE SURFACE'S OWN CYCLE AND BALLOT, for the same reason `placeId` is the
            // surface's: an adapter that resolved either for itself would draw a different
            // election — or a different question — from the ranked list it sits beside.
            cycle={cycle}
            ballot={ballot.map.ballot ?? ballot.kind}
            question={questionKey ? t(questionKey) : undefined}
            posture="presentational"
            ariaLabel={
              questionKey ? t(questionKey) : t("election_map_placeholder")
            }
            features={[]}
          />
        </div>
      ) : null}
    </div>
  );
};

export const ElectionResultsShell: FC<Props> = ({
  surface,
  digest,
  currentView,
  preloadedMap,
  scope = "shell",
}) => {
  const { t } = useTranslation();
  const uid = useId();
  const rid = (part: string) => `election-${part}-${uid}`;
  const descriptor = descriptorFor(surface.kind, surface.place.level);
  const completeResult = surface.destinations?.completeResult;
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
      {/* 1. scope — the cycle and the result status, named in words.
          ⚠ SUPPRESSED WHERE THE HEADER CARRIES IT (§4 item 1). On a migrated result page the
          cycle/status composes INTO `PlaceHeader`, beside the view pills; rendering it here as
          well would put the same two words twice on one screen and stack a second control row
          under the pills, which is the exact arrangement §4 rules out. One definition — the
          screen renders `ElectionScopeBar` into the header's slot and turns this off. */}
      {scope === "shell" ? (
        <section aria-labelledby={rid("scope")}>
          <h2 id={rid("scope")} className="sr-only">
            {t("election_scope_title")}
          </h2>
          <ElectionScopeBar
            cycle={surface.cycle}
            status={surface.status.result}
          />
        </section>
      ) : null}

      {/* 2. the cross-view digest, above this election's own facts (§4.1). */}
      {digestCells ? (
        <PlaceDigestStrip
          cells={digestCells}
          currentView={currentView}
          titleId={rid("digest")}
          kind={surface.kind}
          level={surface.place.level}
          placeId={surface.place.id}
        />
      ) : null}

      {/* 3. this election's outcome facts. */}
      <ElectionFactsGrid facts={shownFacts} titleId={rid("facts")} />

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
              preloadedMap={preloadedMap}
              ballot={b}
              cycle={surface.cycle}
              details={completeResult}
              kind={surface.kind}
              level={surface.place.level}
              placeId={surface.place.id}
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
                {/* ⚠ NO ANCHOR WHEN THE EVIDENCE IS THIS PAGE. A standout attaches to the
                    surface of the place it is ABOUT, so at both attaching levels its evidence
                    destination is the page the reader is standing on — and for months that was
                    rendered as a „виж" link that navigated nowhere. The claim keeps its
                    baseline, which is the measurement §7 actually requires; what goes is the
                    dead link. */}
                {s.evidenceOnPage || !s.evidenceTo ? null : (
                  <a
                    href={s.evidenceTo}
                    onClick={() =>
                      trackSurfaceLink({
                        target: "standout_evidence",
                        kind: surface.kind,
                        level: surface.place.level,
                        placeId: surface.place.id,
                        // ⚠ THE SIGNAL'S ENUM MEMBER, never `t(STANDOUT_LABEL_KEYS[...])`. The
                        // rendered sentence names the place and its measurement; the enum names
                        // the kind of claim, which is what a click count is about.
                        signal: s.signal,
                      })
                    }
                  >
                    {t("election_standout_evidence")}
                  </a>
                )}
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
        {/* §8's "see the complete result" leaf, required at every level and rendered by nothing
            until now — `destinations` had been generated, schema-gated and published since
            Phase 1 with no consumer at all.
            ⚠ ONLY WHEN IT IS A DIFFERENT PAGE. Before the generator learned to refuse a
            self-link, 8,704 artifacts across both kinds carried `completeResult` pointing at
            their own route with `available: true` — every region, abroad, município, country
            and settlement. Rendering the field as it stood would have put "see the complete
            result" on those pages linking back to themselves.
            ⚠ AND `same_page` RENDERS NOTHING, unlike every other unavailable reason. „The
            complete result is on this page" tells a reader only what they can already see; the
            other reasons say something they cannot. */}
        {/* §Phase 7 item 6 — the methods disclosure.
            ⚠ GATED ON THERE BEING A STANDOUT, because that is what it explains. A page with no
            findings needs no account of how findings are chosen, and the result STATUS it also
            mentions is already on the scope bar above.
            ⚠ AND THE LIMITATION IS THE POINT, not the thresholds. The numbers live in
            `standoutThresholds.ts` and change per cycle; what a reader cannot work out from the
            page is that a PERCENTILE rule always selects some places, so „изпъква" is a
            statement about this cycle's spread and never an absolute claim — the methodology's
            own §5.1 "what it excludes" row. A disclosure that recited 5% and 200 votes without
            saying that would look more precise and disclose less. */}
        {surface.standouts.length > 0 ? (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">
              {t("election_methods_summary")}
            </summary>
            <p className="mt-1">{t("election_methods_selection")}</p>
            <p className="mt-1">{t("election_methods_sample")}</p>
            <p className="mt-1">{t("election_methods_status")}</p>
          </details>
        ) : null}
        {completeResult?.available && completeResult.to ? (
          <p className="text-xs">
            <a
              href={completeResult.to}
              onClick={() =>
                trackSurfaceLink({
                  target: "complete_result",
                  kind: surface.kind,
                  level: surface.place.level,
                  placeId: surface.place.id,
                })
              }
              data-surface-complete-result
            >
              {t("election_complete_result_link")}
            </a>
          </p>
        ) : completeResult && completeResult.reason !== "same_page" ? (
          <p
            className="text-xs text-muted-foreground"
            data-surface-complete-result="none"
          >
            {t(
              UNAVAILABLE_REASON_LABEL_KEYS[
                completeResult.reason ?? "no_data_for_place"
              ],
            )}
          </p>
        ) : null}
      </section>
    </div>
  );
};
