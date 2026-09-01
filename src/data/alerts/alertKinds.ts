// The ONE definition of every "Последна активност" alert kind — shared by the builder that
// emits them (scripts/myarea/build_alerts.ts) and by the tile that renders them
// (src/screens/myarea/MyAreaAlertsTile.tsx).
//
// WHY IT EXISTS. The two sides drifted and the drift was silent in both directions:
// `build_alerts.ts` has emitted `kind: "open_call"` since the open-calls arm landed, while
// `MyAreaAlertKind` never listed it — so TypeScript claimed the kind could not exist while
// the tile fell through `ICONS[e.kind] ?? Activity` and `COLOR[e.kind] ?? "#888"` to a
// generic clipboard-and-grey row. Nothing errored. A forward-looking call to apply for
// rendered as an anonymous grey line beside a contract award.
//
// ⚠️ NO RUNTIME IMPORTS. The one import below is `import type`, which erases at compile time
// — a VALUE import (a lucide component, anything under `node:`) would break one of the two
// callers, because the builder is a Node script and the tile is a browser module. That is why
// the icon is a TOKEN rather than a component: the tile owns the token → component map, and
// `alertKinds.test.ts` asserts it is exhaustive, so a new kind is a compile error there rather
// than a grey row in production.
//
// Plan: docs/plans/home-dashboard-implementation-v1.md §7.1.

import type { HomeDateBasis, HomeEventCategory } from "@/data/home/homeTypes";

export const ALERT_KINDS = [
  "procurement",
  "tender",
  "eu_funds",
  "open_call",
  "local_election",
  "capital_program",
  "plenary_keyword",
  "council_resolution",
] as const;

export type AlertKind = (typeof ALERT_KINDS)[number];

/** Icon identity as a string the tile maps to a lucide component. Kept a closed union so a
 *  typo is a compile error rather than a fallback icon. */
export type AlertIconToken =
  | "fileSearch"
  | "clipboardList"
  | "coins"
  | "megaphone"
  | "crown"
  | "hammer"
  | "mic"
  | "vote";

export type AlertKindMeta = {
  icon: AlertIconToken;
  /**
   * The kind's identifying hue, used as a 13%-alpha TINT behind the icon. Hex rather than a
   * Tailwind class because it is composed at runtime (`${color}22`).
   *
   * ⚠️ IT IS NOT A GLYPH COLOUR, and that distinction is a WCAG one rather than a stylistic
   * one. Drawing the icon at this hex on a 13% tint OF THE SAME HEX puts a colour against a
   * near-copy of itself: measured against the real `--card` tokens, all eight kinds land at
   * 1.55–2.88:1 in light mode, every one of them under the 3:1 floor WCAG 1.4.11 sets for
   * non-text contrast. Darkening does not rescue it either — the tint darkens with the hue,
   * and a palette dark enough for the light card is too dark for the dark one.
   *
   * So the tile draws the glyph in the theme's own foreground token over this tint, which is
   * the treatment the sub-type chip in that same file already uses for the same reason. That
   * measures 6.39:1 light / 8.45:1 dark at worst. The kind stays distinguishable three ways —
   * the tint's hue, the icon's SHAPE (asserted distinct below), and the accessible label —
   * and `alertKinds.test.ts` holds the contrast arithmetic so this cannot silently regress.
   */
  color: string;
  /** The home feed's category vocabulary, so a myarea row and a national row can be reasoned
   *  about together without a second taxonomy. */
  category: HomeEventCategory;
  /**
   * What the row's `date` actually IS.
   *
   * ⚠️ This is the WEAKEST claim true of every row of the kind, never the best case. A kind
   * whose builder has several arms takes the weakest of them, because a default that
   * over-claims puts a false label on the rows it does not fit — and the whole point of
   * naming a basis is that "found on" and "happened on" are different sentences.
   */
  dateBasis: HomeDateBasis;
  /**
   * True when the stored date is CONSTRUCTED rather than observed, so no consumer renders it
   * as a day something happened. Two kinds are:
   *
   *  - `eu_funds` in-progress rows carry a programme-period midpoint from
   *    `inferFundsPeriod()`, which is why the tile already renders `programPeriod`
   *    ("2014-2020") in place of a date label;
   *  - `capital_program` rows are dated `${year}-01-01`, a stand-in for "adopted for that
   *    budget year".
   */
  syntheticDate: boolean;
  /** i18n key for the kind's short label. */
  labelKey: string;
};

/**
 * ⚠️ EVERY FIELD HERE IS A CLAIM ABOUT `scripts/myarea/build_alerts.ts`, not a preference.
 * `alertKinds.test.ts` reads that file and fails when the kinds diverge; the `dateBasis` and
 * `syntheticDate` columns were read off the builders one by one:
 *
 *   procurement        c.date                    contract date          → occurred
 *   tender             t.publicationDate         notice publication     → published
 *   eu_funds           sortDate | startDate |    programme-period mid,  → first_seen (the
 *                      c.detectedAt              or our detection day      weakest of three)
 *   open_call          r.firstSeenAt             when WE first saw it   → first_seen
 *   local_election     e.date                    polling day            → occurred
 *   capital_program    `${year}-01-01`           the budget year        → effective
 *   plenary_keyword    sess.date                 the sitting            → occurred
 *   council_resolution r.decidedOn               the vote               → occurred
 */
export const ALERT_KIND_META: Record<AlertKind, AlertKindMeta> = {
  procurement: {
    icon: "fileSearch",
    color: "#5E8AC7",
    category: "procurement",
    dateBasis: "occurred",
    syntheticDate: false,
    labelKey: "alert_kind_procurement",
  },
  tender: {
    icon: "clipboardList",
    color: "#6366F1",
    category: "procurement",
    dateBasis: "published",
    syntheticDate: false,
    labelKey: "alert_kind_tender",
  },
  eu_funds: {
    icon: "coins",
    color: "#E0A22C",
    category: "funds",
    // Three arms, and they do not share a basis: two source-derived dates (one of which is a
    // programme-period midpoint rather than a day) and one `detectedAt`. The weakest is what
    // is true of all of them.
    dateBasis: "first_seen",
    syntheticDate: true,
    labelKey: "alert_kind_eu_funds",
  },
  open_call: {
    icon: "megaphone",
    color: "#0E9384",
    category: "funds",
    // The DEADLINE leads the headline because it is the actionable fact, but the row is DATED
    // by `first_seen_at` — dating it by the closing date would park it permanently at the top
    // of a feed sorted by date desc and quietly redefine the axis. The builder's header says
    // so; this field is the same statement in a form a consumer can read.
    dateBasis: "first_seen",
    syntheticDate: false,
    labelKey: "alert_kind_open_call",
  },
  local_election: {
    icon: "crown",
    color: "#56A86F",
    category: "parliament_elections",
    dateBasis: "occurred",
    syntheticDate: false,
    labelKey: "alert_kind_local_election",
  },
  capital_program: {
    icon: "hammer",
    color: "#A6792F",
    category: "budget_debt",
    // `${year}-01-01` is the budget year, not an adoption day.
    dateBasis: "effective",
    syntheticDate: true,
    labelKey: "alert_kind_capital_program",
  },
  plenary_keyword: {
    icon: "mic",
    color: "#C97AAA",
    category: "parliament_elections",
    dateBasis: "occurred",
    syntheticDate: false,
    labelKey: "alert_kind_plenary_keyword",
  },
  council_resolution: {
    icon: "vote",
    // Amber tint matches the band's old council-vote treatment so the visual continuity
    // carries over now that council rows live in this tile.
    color: "#D97706",
    category: "local",
    dateBasis: "occurred",
    syntheticDate: false,
    labelKey: "alert_kind_council_resolution",
  },
};

/** Narrowing guard for a kind read off a payload. A row whose kind is not in the registry is
 *  dropped by the caller rather than rendered anonymously — the failure this file exists to
 *  end. */
export const isAlertKind = (value: unknown): value is AlertKind =>
  typeof value === "string" &&
  Object.prototype.hasOwnProperty.call(ALERT_KIND_META, value);
