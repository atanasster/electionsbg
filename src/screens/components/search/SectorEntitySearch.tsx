// The one search box at the top of a sector dashboard — "find your hospital,
// your medicine, your school, your court".
//
// It exists because a sector dashboard is a stack of TOP-N tiles: /sector/health
// renders 12 of 3,333 drug packs and 12 of 427 procedures, /judiciary maps 283
// judicial bodies with no finder. The destination pages already exist and are
// already served; they were simply unreachable from the page that is about them.
//
// THIS IS A THIN ADAPTER over `@/ux/search/EntitySearchTile`, the repo's generic
// "one box, grouped dropdown" shell — the same relationship ProcurementSearchTile
// and ConsumptionSearchTile have with it. The shell owns the card, the
// combobox/listbox ARIA, keyboard navigation, highlight + scroll-into-view and
// the loading/empty states; this file owns only what is sector-specific: groups
// backed by a pre-folded `EntityIndex` rather than by a debounced fetch.
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
//      its own scoping anyway.
//   4. IT IS CLIENT-ONLY. The prerendered HTML ships an inert input that
//      hydrates, so this contributes nothing to crawlability — discovery comes
//      from the prerendered pages and the sitemap, not from here.
//
// Matching and ranking live in `@/lib/entitySearchIndex`; this file is the glue.

import { FC, useDeferredValue, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import {
  EntitySearchTile,
  type SearchGroup,
} from "@/ux/search/EntitySearchTile";
import { searchIndex } from "@/lib/entitySearchIndex";
import type { EntitySearchGroup } from "./entityGroups";

/** Below this the dropdown stays closed — a one-character query matches most of
 *  a corpus, so it is noise rather than a result set. Same floor the other
 *  EntitySearchTile adapters use. */
const MIN_QUERY = 2;
const DEFAULT_LIMIT = 8;

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
}> = ({ groups, title, placeholder, hint, idPrefix, onArm }) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const [query, setQuery] = useState("");
  const armed = useRef(false);
  // Arm on focus OR on the first keystroke. Focus alone is the natural trigger
  // but not a reliable one: a browser that is not the frontmost window may
  // never deliver a focus event, and a reader arriving with the box already
  // focused (autofill, back-navigation, a screen reader moving the caret) can
  // type without one. Missing the arm leaves every index null and the box
  // silently answers "no matches" — so take whichever signal comes first.
  const arm = () => {
    if (armed.current) return;
    armed.current = true;
    onArm?.();
  };
  // The query the RESULTS reflect: typing stays responsive while a large index
  // is scanned, because React renders the input with the new value first and
  // re-renders the (expensive) list afterwards at lower priority.
  const deferred = useDeferredValue(query);

  const searchGroups = useMemo<SearchGroup[]>(() => {
    if (deferred.trim().length < MIN_QUERY) return [];
    return groups.flatMap((g) => {
      const rows = searchIndex(g.index, deferred, g.limit ?? DEFAULT_LIMIT);
      if (rows.length === 0) return [];
      return [
        {
          key: g.id,
          label: bg ? g.label.bg : g.label.en,
          items: rows.map((row) => ({
            id: `${g.id}:${row.id}`,
            to: row.href,
            primary: row.label,
            secondary: row.sub,
            icon: g.icon ?? Search,
          })),
        },
      ];
    });
  }, [groups, deferred, bg]);

  // "Loading" only counts groups that could still gain rows. A group whose
  // index is genuinely absent (the caller has nothing to build from) must not
  // hold the whole box in a loading state for ever.
  const loading = groups.some((g) => g.loading);

  return (
    <EntitySearchTile
      idPrefix={idPrefix}
      title={bg ? title.bg : title.en}
      placeholder={bg ? placeholder.bg : placeholder.en}
      hint={bg ? hint.bg : hint.en}
      loadingLabel={bg ? "Зареждане…" : "Loading…"}
      // Name what was searched — a bare "no results" leaves the reader unsure
      // whether the box even covers the entity they wanted. Groups with no
      // index are omitted: they were not searched, so claiming they were is a
      // false negative.
      noResultsLabel={
        bg
          ? `Няма съвпадения в: ${groups
              .filter((g) => g.index)
              .map((g) => g.label.bg.toLowerCase())
              .join(", ")}`
          : `No matches in: ${groups
              .filter((g) => g.index)
              .map((g) => g.label.en.toLowerCase())
              .join(", ")}`
      }
      lang={i18n.language}
      value={query}
      onChange={(v) => {
        arm();
        setQuery(v);
      }}
      onFocus={arm}
      loading={loading}
      groups={searchGroups}
    />
  );
};
