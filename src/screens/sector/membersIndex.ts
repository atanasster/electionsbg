// The members-as-a-search-group helper, kept out of the component file so that
// file only exports components (react-refresh/only-export-components).

import { buildEntityIndex } from "@/lib/entitySearchIndex";
import type { SectorDashboardConfig } from "./sectorDashboards";

/** Below this a sector's roster fits on screen and a box is noise. Ten rather
 *  than twenty so МТС (11) is covered: its members are the ones with acronyms a
 *  reader types (НКЖИ, БДЖ, ИАЖА) and the least guessable full names. */
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
