// The source model behind <HubSearch> — pure data and one helper, no JSX.
//
// Split out of HubSearch.tsx for the same reason entityGroups.ts is split out of
// SectorEntitySearch: a module that exports both a component and plain values trips
// react-refresh/only-export-components, and a hub's registry wants the types without
// pulling in the component.
//
// ===========================================================================
// SCOPE RANKS, IT NEVER FILTERS — and ONE SOURCE IS ONE GROUP.
//
// A hub has a selector (?elections, ?pscope) and the tempting move is to restrict results
// to it. That is wrong: a finder must FIND. „Your hospital does not exist" is a far worse
// answer than „your hospital has no contracts in this window", and the destination page
// scopes itself anyway. So a scoped subject yields TWO groups — in-scope first, out-of-scope
// second and labelled for the scope it is outside.
//
// `scopedSources()` expands one declaration into exactly that pair, and the pair is TWO
// INDEPENDENT SOURCES with their own corpora and their own caps.
//
// THAT INDEPENDENCE IS THE WHOLE POINT, and the first draft got it wrong. It kept ONE
// source with a `partition` callback applied to the rows that came back — which means the
// ranked scan has to REACH an out-of-scope row before the partition can ever see one. With
// 240 in-scope MPs ranked above 1,880 out-of-scope ones, a scan capped at any multiple of
// the display limit returns nothing but in-scope rows, the second group renders empty, and
// the box has silently become a filter again. Caught by its own test on a 12-row fixture.
// ===========================================================================

import type { FC } from "react";
import type { SearchItem } from "@/ux/search/EntitySearchTile";
import type { EntityIndex, EntityRow } from "@/lib/entitySearchIndex";

/** Below this the dropdown stays closed — a one-character query matches most of a corpus,
 *  so it is noise rather than a result set. Same floor the other adapters use. */
export const MIN_QUERY = 2;
export const DEFAULT_LIMIT = 8;
/** A keystroke is not a query. Long enough that typing a name is one request, short enough
 *  that the dropdown does not feel detached from the box. */
export const DEBOUNCE_MS = 250;

export interface I18nPair {
  bg: string;
  en: string;
}

interface SourceBase {
  id: string;
  /** This group's label. ONE SOURCE IS ONE GROUP — a scoped subject declares two, via
   *  `scopedSources()`. */
  label: I18nPair;
  /** This group's cap. Independent of every other source's. */
  limit?: number;
  icon?: FC<{ className?: string }>;
  /** Optional "see all" target carrying the query forward. */
  seeAll?: (query: string) => { label: string; to: string } | undefined;
}

export interface IndexSource extends SourceBase {
  kind: "index";
  /** null when the caller has not built it — either not YET (the `onArm` deferral) or not
   *  EVER (nothing to build from). Those are different states and only the first is a
   *  loading state; see `loading`. */
  index: EntityIndex | null;
  /** True only while the index is still COMING. A null index alone must not put the box in
   *  a loading state: a caller whose data genuinely does not exist would hold the whole
   *  dropdown on "Зареждане…" for ever, which reads as a hang rather than as an empty
   *  group, AND would suppress the "searched in …" sentence for every other source. */
  loading?: boolean;
  toItem?: (row: EntityRow) => SearchItem;
}

export interface ServerSource extends SourceBase {
  kind: "server";
  /** Called at most once per debounced query. MUST honour the signal — an in-flight request
   *  for a superseded query resolving last would show stale rows under a newer query. */
  fetch: (query: string, signal: AbortSignal) => Promise<SearchItem[]>;
}

export type HubSearchSource = IndexSource | ServerSource;

/** Expand ONE scoped subject into the in-scope + out-of-scope pair the rule above requires.
 *
 *  Use this rather than hand-writing two entries: it is what stops the second group being
 *  forgotten, and it enforces the three properties that make the split a ranking rather
 *  than a filter — each half gets its OWN corpus, its OWN cap, and only the in-scope half
 *  carries the "see all" (on the other it would mean "see all of a set this page is not
 *  about").
 *
 *  Pass `outSource: null` when the subject genuinely has nothing outside the scope; you get
 *  one group and no empty heading. */
export const scopedSources = <S extends HubSearchSource>(spec: {
  id: string;
  label: I18nPair;
  /** NAME THE SCOPE IT IS OUTSIDE („депутати от други НС"), never „други" — the same reason
   *  a band is never called „Още". */
  outLabel: I18nPair;
  limit?: number;
  // `id`/`label`/`limit` are omitted because this helper MINTS them: the out source must be
  // `<id>:out`, and a caller free to name them could give the pair one id and collapse the
  // two groups back into one. `seeAll` is omitted from the OUT half by type, not by
  // convention — a doc comment saying "in-scope only" is not a constraint.
  inSource: Omit<S, "id" | "label" | "limit">;
  outSource: Omit<S, "id" | "label" | "limit" | "seeAll"> | null;
}): HubSearchSource[] => [
  { ...spec.inSource, id: spec.id, label: spec.label, limit: spec.limit } as S,
  ...(spec.outSource
    ? [
        {
          ...spec.outSource,
          id: `${spec.id}:out`,
          label: spec.outLabel,
          limit: spec.limit,
        } as S,
      ]
    : []),
];
