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
 *  NOT knife-edge: the member counts are 74 / 30 / 27 / 11 / 9 / 6 / 1×8, so
 *  ANY value in [10, 11] selects the same four sectors. Energy at 9 is one
 *  member below the floor — if it grows, it gets a box for free, which is the
 *  case this auto-mount exists for (МВР went from a handful to 74).
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
