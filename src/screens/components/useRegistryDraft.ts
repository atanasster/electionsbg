// The reader-facing half of a COMMITTED-TERM search: a local draft, the committed `?q`, and the
// four values every registry screen derives from the pair. Used by /persons and /companies.
//
// ⚠️ IT LIVES ONCE FOR THE REASON `registrySearchTiming.ts` DID, AND THEN DID NOT. That module
// existed because a value and its rationale had been copied byte-identically into two screens,
// „so a correction to the reasoning would land on one page and not the other" — and it was
// deleted along with the debounce it timed. The block that replaced it was then written into
// both screens verbatim, ⚠️ comments and all: the same shape, one commit later. This is where it
// goes.
//
// THE MODEL, in one line each:
//   · `draft`   — what is in the box. Local, so typing is instant, and seen by nothing else.
//   · `query`   — the COMMITTED term (`?q`), written once per submit, and the only thing the
//                 table, the head band and every gate read.
//
// ⚠️ THERE IS NO ECHO/MOVE PROBLEM HERE, and that is why this hook is nine lines rather than
// forty. While the term was mirrored into the URL on a 350 ms debounce, each screen needed a ref
// to tell „the URL is echoing back our own write" (ignore, or a keystroke landing in that window
// is silently reverted) from „the URL moved under us" (follow). With the box→URL direction
// reduced to an explicit submit, the two can no longer race: the URL changes only because
// somebody asked it to, so a single seeding effect in the URL→box direction is the whole thing.

import { useCallback, useEffect, useState } from "react";

export interface RegistryDraft {
  /** The box's value. Report every keystroke into `setDraft`; commit with `onSubmitQuery`. */
  draft: string;
  setDraft: (v: string) => void;
  /** Commit — hand it to `RegistrySearchField`'s `onSubmit`. */
  onSubmitQuery: (v: string) => void;
  /** „Изчисти филтрите" — clears the URL AND the box. */
  onClearAll: () => void;
  /** Whether the reader has a committed term. Gates the page's search-blind surfaces. */
  searching: boolean;
}

export const useRegistryDraft = (
  /** The committed term, from the page's `?q`. */
  query: string,
  /** The URL writer for it. */
  setQuery: (v: string) => void,
  /** The page's „clear every managed param", which is URL-only. */
  clearFilters: () => void,
): RegistryDraft => {
  const [draft, setDraft] = useState(query);
  // The seed in the URL→box direction ONLY: Back, an in-app `?q` link, „Изчисти филтрите". The
  // box→URL direction is the submit, so no ref is needed to tell an echo from a move.
  useEffect(() => setDraft(query), [query]);

  // Takes the term rather than reading `draft`, because the clear × and the example chips submit
  // a value that is not in state yet — a handler reading its own state would commit the term the
  // reader has just replaced.
  const onSubmitQuery = useCallback((v: string) => setQuery(v), [setQuery]);

  // ⚠️ TWO HALVES, though no longer a race. `clearFilters` is URL-only, so a reader who typed
  // something they never submitted would otherwise watch the results clear while their term sat
  // on in the box — with „Търси" beside it offering to bring it back. „Изчисти" means the page
  // starts over, box included.
  const onClearAll = useCallback(() => {
    setDraft("");
    clearFilters();
  }, [clearFilters]);

  // ⚠️ READ FROM `?q`, NOT FROM THE BOX AND NOT FROM THE TABLE'S RESPONSE, and each wrong source
  // fails in its own direction: the box would strip the page's corpus figures mid-word, before
  // the reader has asked for anything, and the response would put them back for the length of
  // every request — which is exactly when a reader is looking at the head. The reasoning in full
  // is in either `*KpiBasis.ts`, on `searchActive`.
  const searching = query.trim().length > 0;

  return { draft, setDraft, onSubmitQuery, onClearAll, searching };
};
