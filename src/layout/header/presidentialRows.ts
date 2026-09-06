// The presidential rows of the header's election dropdown.
//
// ⚠ A PURE BUILDER, SEPARATE FROM THE COMPONENT, because the interesting half is not the
// markup. Which cycles appear, in what order, under whose name, and whether they appear at
// all are four decisions a component test can only reach through Radix — and the fourth
// one (they are WITHHELD until `/presidential/:cycle` exists) is invisible in a rendered
// menu, which is exactly the shape that needs a gate.
//
// ⚠ THE ROWS WERE BUILT AND WITHHELD, and since plan T5 they are shown. `ElectionsSelect`
// renders them only when the kind has a surface, which it asks `presidentialServable` — and
// that predicate reads the SAME list the hub and the search source read, so the three cannot
// disagree about which kinds are servable. It survives the withholding being lifted because
// the next kind added to the catalogue arrives the same way.
//
// Plan: docs/plans/presidential-elections-v1.md T4.3.

import { localDate } from "@/data/utils";
import {
  CYCLE_SURFACE,
  KINDS_WITHOUT_SURFACE,
} from "@/screens/elections/electionsHubCycle";
import type { ElectionsHubKind } from "@/screens/elections/electionsHubCycle";
import type { PresidentialElectionEntry } from "@/data/presidentialCatalogue";

/**
 * May the header show presidential cycles?
 *
 * ⚠ A PREDICATE RATHER THAN A MODULE CONSTANT, and the difference is testability. As
 * `const PRESIDENTIAL_SERVABLE = !KINDS_WITHOUT_SURFACE.includes("presidential")` inside the
 * component file it was unreachable from any gate: the only way to observe it was to render
 * Radix and count rows, and once the list emptied there was no way at all to check the RULE
 * still applied. Passing the list in is the same seam `presidentialSearchSource` uses.
 *
 * @param withheld - The kinds with no per-cycle screens. Defaults to the real list.
 * @returns Whether the dropdown may offer presidential cycles.
 */
export const presidentialServable = (
  withheld: readonly ElectionsHubKind[] = KINDS_WITHOUT_SURFACE,
): boolean => !withheld.includes("presidential");

export type PresidentialRow = {
  kind: "presidential";
  /** The cycle id — the URL key and the React key. ⚠ NEVER RENDERED. */
  name: string;
  /** The formatted round-1 date, which is what the row shows. */
  local: string;
  /**
   * The elected president's family name.
   *
   * ⚠ THE SURNAME, because the row is ~260px wide and shares it with a date and a badge.
   * „Румен Георгиев Радев" does not fit; „Радев" is how the office-holder is referred to
   * everywhere else on this site. It is NOT an identity — two cycles can return the same
   * surname for the same person (Първанов 2001 and 2006) or, in principle, for different
   * ones, so nothing may join on it.
   */
  winnerSurname: string;
  /** 1 or 2. Rendered as words, never as a bare digit. */
  decidedInRound: 1 | 2;
};

/**
 * The family name out of a Bulgarian three-part name.
 *
 * ⚠ A HYPHENATED COMPOUND IS ONE NAME WHETHER OR NOT THE SOURCE SPACED THE HYPHEN.
 * „Митева - Матеева" and „Митева-Матеева" are the same person, and this repo has already
 * met both spellings of ONE name in the ИВСС register — „… Средкова - Петрова" in 2025
 * against „…Средкова-Петрова" in 2026, which minted two person rows for one human. So the
 * hyphen is closed up first and the surname is the last whitespace token of THAT; taking
 * the last token of the raw string returns „Матеева", which is half of a real person's
 * name. The catalogue is derived from whatever ЦИК published, so the spelling is not this
 * file's to control.
 *
 * ⚠ AND IT NEVER RETURNS EMPTY, which the caller relies on: a whitespace-only name passes
 * `isPresidentialElectionEntry` (`"   "` is truthy), and an empty label beside a date
 * renders as a bare „ · ". The fallback is the input as given.
 *
 * @param president - The full published name.
 * @returns The family name, or the input itself when it carries no name-shaped token.
 */
export const surnameOf = (president: string): string => {
  const norm = president.trim().replace(/\s*-\s*/g, "-");
  const parts = norm.split(/\s+/).filter(Boolean);
  const last = parts.length ? parts[parts.length - 1] : "";
  return last || president;
};

/**
 * The i18n key naming which round elected the president.
 *
 * ⚠ IT LIVES HERE RATHER THAN IN THE JSX SO IT CAN BE TESTED. As an inline ternary it had
 * no gate at all: inverting it published „избран на първи тур" beside five presidents who
 * every one of them reached office in a runoff — a false claim about named office-holders,
 * in the header of every page — with the typecheck, the lint, the row gates and the i18n
 * gate all green.
 *
 * ⚠ EXPLICIT ON BOTH ARMS rather than „1 or else runoff". `decidedInRound` reaches the
 * component through a cast, so an out-of-range value would otherwise render „балотаж" —
 * a specific claim — instead of nothing.
 *
 * @param round - `decidedInRound` from the catalogue.
 * @returns A translation key, or `null` when the round is not one this corpus can describe.
 */
export const decidedLabelKey = (round: number): string | null => {
  if (round === 1) return "presidential_decided_round1";
  if (round === 2) return "presidential_decided_runoff";
  return null;
};

/** What picking a dropdown row should do. */
export type PickAction = { select: string } | { navigate: string };

/**
 * Where a picked row goes.
 *
 * ⚠ EXHAUSTIVE OVER THE KIND. The `else` this replaced sent every non-parliamentary row to
 * `/local/<id>`, so a presidential row navigated to `/local/2021_11_14_pvr` — a page about
 * a different electoral system, rendered from a tree that does not exist. `CYCLE_SURFACE`
 * is the one place a kind's destination is written, shared with the hub.
 *
 * @param row - The picked row's kind and cycle id.
 * @returns `select` for a parliamentary cycle (it re-anchors the whole site through
 *   `ElectionContext`), `navigate` for the others (they are their own pages).
 */
export const pickAction = (row: {
  kind: ElectionsHubKind;
  name: string;
}): PickAction =>
  row.kind === "parliamentary"
    ? { select: row.name }
    : { navigate: CYCLE_SURFACE[row.kind].href(row.name) };

/**
 * Build the dropdown's presidential rows, newest first.
 *
 * ⚠ SORTED HERE RATHER THAN TRUSTED, the same rule `ELECTION_EVENTS` states: the catalogue
 * is newest-first today and would go on reading correctly right up until a cycle is
 * appended rather than prepended, at which point the menu quietly opens with 2001 at the
 * top of its own section.
 *
 * @param catalogue - `presidential_elections.json`.
 * @returns One row per cycle.
 */
export const presidentialRows = (
  catalogue: PresidentialElectionEntry[],
): PresidentialRow[] =>
  catalogue
    .slice()
    .sort((a, b) => b.round1Date.localeCompare(a.round1Date))
    .map((e) => ({
      kind: "presidential" as const,
      name: e.name,
      // ⚠ FROM `round1Date`, never from `name` — and NOT because the id would render badly.
      // Measured: `localDate` splits on „_" and reads the first three parts, so it ignores
      // the `_pvr` suffix and returns „14/11/2021" for either input. The reason is
      // provenance: the id is a key that happens to begin with a date today, and the
      // catalogue publishes the date as data. A future cycle id that is not date-shaped
      // would render as „Invalid Date" from `name` and correctly from here.
      local: localDate(e.round1Date.replace(/-/g, "_")),
      winnerSurname: surnameOf(e.winnerTicket.president),
      decidedInRound: e.decidedInRound,
    }));
