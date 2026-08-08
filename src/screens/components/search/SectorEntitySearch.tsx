// The one search box at the top of a sector dashboard — "find your hospital,
// your medicine, your school, your court".
//
// It exists because a sector dashboard is a stack of TOP-N tiles: /sector/health
// renders 12 of 3,333 drug packs and 12 of 427 procedures, /judiciary maps 279
// judicial bodies with no finder. The destination pages already exist and are
// already served; they were simply unreachable from the page that is about them.
//
// SINCE THE HUB-SEARCH WORK THIS IS A ~30-LINE ADAPTER over `@/ux/search/HubSearch`,
// which is itself the generic adapter over `EntitySearchTile`. It used to own a
// copy of the query state, the deferred-value handling, the arm-on-first-focus
// trick and the "searched in: …" empty state — all of which HubSearch now owns,
// and all of which had to be got right twice. What is left here is the only thing
// that is sector-specific: the `EntitySearchGroup` shape its eight callers pass.
//
// Four things about its behaviour are decisions, not accidents:
//
//   1. ONE BOX PER PAGE, covering every group. Not a filter inside each tile —
//      that would put six inputs on a sector page.
//   2. EVERY RESULT NAVIGATES. `EntityRow.href` is required; there is no
//      scroll-and-highlight mode, so a group whose destination pages do not
//      exist yet does not ship.
//   3. IT IGNORES ?pscope. The obvious-looking choice — restrict results to
//      entities with activity in the selected window — is wrong: a finder must
//      find. "Your hospital does not exist" is a far worse answer than "your
//      hospital has no contracts in this window", and the destination page does
//      its own scoping anyway. (HubSearch generalises this as "scope ranks, it
//      never filters"; a sector box has no scope to rank BY, so it renders one
//      group per subject and no split.)
//   4. IT IS CLIENT-ONLY. The prerendered HTML ships an inert input that
//      hydrates, so this contributes nothing to crawlability — discovery comes
//      from the prerendered pages and the sitemap, not from here.
//
// Matching and ranking live in `@/lib/entitySearchIndex`; this file is the glue.

import { FC, useMemo } from "react";
import { HubSearch } from "@/ux/search/HubSearch";
import type { HubSearchSource } from "@/ux/search/hubSearchSources";
import type { EntitySearchGroup } from "./entityGroups";

export const SectorEntitySearch: FC<{
  /** MEMOIZE THIS. A new array identity re-runs every group's scan; the
   *  deferred query only protects the keystroke path, not a parent re-render
   *  (a ?pscope change, a React Query resolution). */
  groups: EntitySearchGroup[];
  title: { bg: string; en: string };
  /** Placeholder — say what is searchable, e.g. "болница, лекарство, пътека…". */
  placeholder: { bg: string; en: string };
  /** Line under the closed box: what this search covers. */
  hint: { bg: string; en: string };
  /** Unique per page — the shell derives its aria ids from it. */
  idPrefix: string;
  /** Fired once, on first focus. Lets a caller defer building a large index
   *  until the reader has signalled intent — a reader who never searches then
   *  pays nothing. Callers with cheap indexes can omit it. */
  onArm?: () => void;
  /** Fired on every keystroke with the raw query. For a SERVER-backed group,
   *  which has to go and fetch its rows rather than scan a client index — the
   *  caller debounces. Client-indexed callers ignore it. */
  onQueryChange?: (q: string) => void;
}> = ({ groups, title, placeholder, hint, idPrefix, onArm, onQueryChange }) => {
  // EntitySearchGroup is IndexSource minus `kind` — the two shapes were written
  // for the same job a year apart. The mapping is the whole adapter.
  const sources = useMemo<HubSearchSource[]>(
    () =>
      groups.map((g) => ({
        kind: "index",
        id: g.id,
        label: g.label,
        index: g.index,
        limit: g.limit,
        loading: g.loading,
        icon: g.icon,
      })),
    [groups],
  );

  return (
    <HubSearch
      sources={sources}
      title={title}
      placeholder={placeholder}
      hint={hint}
      idPrefix={idPrefix}
      onArm={onArm}
      onQueryChange={onQueryChange}
    />
  );
};
