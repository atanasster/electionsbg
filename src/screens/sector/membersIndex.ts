// The members-as-a-search-group helper, kept out of the component file so that
// file only exports components (react-refresh/only-export-components).

import { buildEntityIndex } from "@/lib/entitySearchIndex";
import type { SectorDashboardConfig } from "./sectorDashboards";

/** Below this a sector's roster fits on screen and a box is noise.
 *
 *  Ten rather than twenty so МТС (11) is covered: its members carry the
 *  acronyms a reader actually types (НКЖИ, БДЖ, ИАЖА) behind the least
 *  guessable full names.
 *
 *  ⚠ Energy DID grow, and this is what that looked like. The counts are now
 *  74 / 30 / 27 / 11 / 10 / 6 / 1×8: adding ДП РАО (2026-08-13) took energy from
 *  9 to 10, so it crossed the floor and got a box for free — precisely the
 *  auto-mount this exists for (МВР went from a handful to 74). Its roster is the
 *  same shape as МТС's, acronyms a reader types (АЕЦ, ЕСО, НЕК, ДП РАО) behind
 *  unguessable full names, so the box earns its place at 10 exactly as at 11.
 *
 *  The consequence, stated rather than left to be rediscovered: the floor is no
 *  longer slack. It USED to be true that any value in [10, 11] picked the same
 *  four sectors; energy now sits exactly ON 10, so 11 would silently take its box
 *  away. What stays invariant — and is what the test actually guards — is that no
 *  single-member sector can ever qualify, since the gap from 10 down to 1 is the
 *  real margin. Moving this number now trades one sector's box; moving it below
 *  6 changes the feature.
 *
 *  It cannot reach /judiciary: that is a bespoke screen whose 283 bodies are a
 *  PG dimension, not a `members` array. Its finder is T5d. */
export const MEMBER_SEARCH_MIN = 10;

/** The members of one sector as a search group. Exported so a bespoke screen
 *  (defense, culture) can reuse it without re-deriving the shape. */
export const buildMembersIndex = (
  members: SectorDashboardConfig["members"],
  bg: boolean,
) =>
  buildEntityIndex(
    members,
    (m) => ({
      id: m.eik,
      label: bg ? m.name.bg : m.name.en,
      sub: m.group ? (bg ? m.group.bg : m.group.en) : undefined,
      href: `/awarder/${m.eik}`,
    }),
    // Both languages AND the sub-group label: an acronym embedded in the name
    // ("(НКЖИ)", "ИА „Морска администрация“") folds for free because the folder
    // strips punctuation, but a reader may equally type the universe ("рибарство",
    // "въздухоплаване") or the EIK off a contract.
    (m) => [m.name.bg, m.name.en, m.eik, m.group?.bg, m.group?.en],
  );
