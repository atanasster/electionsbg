// HubSearch — the one search box a dashboard hub puts above its tiles.
//
// A hub points with TILES: a fixed set of curated destinations. A reader who arrives already
// knowing what they want („Желязков", „бюджет 2026", „моята болница") cannot say so — they
// have to guess which tile contains their subject, land on a browser, and search there. This
// is the box that lets them say it.
//
// THIN ADAPTER over `EntitySearchTile`, which owns the card, the combobox/listbox ARIA,
// keyboard navigation, highlight + scroll-into-view and the loading/empty states. What this
// file adds is BOTH SOURCE KINDS in one box: SectorEntitySearch scans pre-folded client
// indexes, ProcurementSearchTile fetches from /api/db, and every hub needs a mix
// (declarations: server people + client officials; parliament: client MPs + server topics).
//
// The source model and the scope rule live in `./hubSearchSources` — read that first.
//
// It is CLIENT-ONLY. The prerendered HTML ships an inert input that hydrates, so this
// contributes nothing to crawlability — discovery comes from the prerendered pages and the
// sitemap, not from here.

import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import {
  EntitySearchTile,
  type SearchGroup,
  type SearchItem,
} from "@/ux/search/EntitySearchTile";
import { searchIndex } from "@/lib/entitySearchIndex";
import {
  DEBOUNCE_MS,
  DEFAULT_LIMIT,
  MIN_QUERY,
  type HubSearchSource,
  type I18nPair,
  type ServerSource,
} from "./hubSearchSources";

const pick = (p: I18nPair, bg: boolean): string => (bg ? p.bg : p.en);

/** One source, one group, capped at its own limit. */
const toGroup = (
  src: HubSearchSource,
  items: SearchItem[],
  bg: boolean,
  query: string,
): SearchGroup[] => {
  if (items.length === 0) return [];
  const seeAll = src.seeAll?.(query);
  return [
    {
      key: src.id,
      label: pick(src.label, bg),
      items: items.slice(0, src.limit ?? DEFAULT_LIMIT),
      ...(seeAll ? { seeAll: { label: seeAll.label, to: seeAll.to } } : {}),
    },
  ];
};

/** What a server source's rows are stored against: the query they answered, plus which
 *  fetches failed. Both are load-bearing.
 *
 *  THE QUERY, because rows keyed only by source id outlive the query that produced them —
 *  a reader who types „иван" and then „петров" saw Иванови under Петров until the second
 *  request resolved, with no loading indicator, because a client-index group rendering
 *  alongside made the dropdown non-empty.
 *
 *  THE FAILURES, because the "searched in: …" sentence must not name a group whose fetch
 *  threw. „No matches in people" is a claim about the data; a 500 is a claim about us. */
interface ServerState {
  query: string;
  rows: Record<string, SearchItem[]>;
  failed: Set<string>;
}
const EMPTY_SERVER: ServerState = { query: "", rows: {}, failed: new Set() };

export const HubSearch: FC<{
  /** MEMOIZE THIS where convenient. Not memoizing is only wasteful on the client — the
   *  fetch effect deliberately does not depend on this array's identity. */
  sources: HubSearchSource[];
  title: I18nPair;
  /** Say what is searchable, e.g. „депутат, тема на гласуване…". */
  placeholder: I18nPair;
  /** Line under the closed box: what this search covers. */
  hint: I18nPair;
  /** Unique per page — the shell derives its aria ids from it. */
  idPrefix: string;
  /** Fired once, on first focus or first keystroke. Lets a caller defer building a large
   *  index until the reader has signalled intent. */
  onArm?: () => void;
  className?: string;
}> = ({ sources, title, placeholder, hint, idPrefix, onArm, className }) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const [query, setQuery] = useState("");
  const [server, setServer] = useState<ServerState>(EMPTY_SERVER);
  const armed = useRef(false);

  // Arm on focus OR on the first keystroke. Focus alone is not reliable: a browser that is
  // not the frontmost window may never deliver a focus event, and a reader arriving with the
  // box already focused (autofill, back-navigation, a screen reader moving the caret) can
  // type without one. Missing the arm leaves every index null and the box silently answers
  // "no matches".
  const arm = useCallback(() => {
    if (armed.current) return;
    armed.current = true;
    onArm?.();
  }, [onArm]);

  // NOT `useDeferredValue`. Deferring would let the index groups lag the input by a frame
  // while the server groups track it, so the two halves of one dropdown could describe two
  // different queries. The index scan is a few thousand indexOf calls; the fetch is the slow
  // half and it is debounced.
  const active = query.trim();
  const serverSources = useMemo(
    () => sources.filter((s): s is ServerSource => s.kind === "server"),
    [sources],
  );
  // The effect below must NOT depend on `sources` identity. A caller who forgets to memoize
  // — or who re-renders for an unrelated reason, including the `onArm` deferral this
  // component itself ships — would otherwise abort the in-flight request and re-issue every
  // fetch on each render.
  const latest = useRef(serverSources);
  latest.current = serverSources;
  const serverKey = serverSources.map((s) => s.id).join("|");

  useEffect(() => {
    const srcs = latest.current;
    if (active.length < MIN_QUERY || srcs.length === 0) {
      setServer(EMPTY_SERVER);
      return;
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      Promise.all(
        srcs.map(async (s) => {
          try {
            return [s.id, await s.fetch(active, ctl.signal), false] as const;
          } catch {
            // try/catch rather than .catch(): a source whose `fetch` throws SYNCHRONOUSLY
            // never returns a promise for .catch() to attach to, and the rejection would
            // escape Promise.all and leave the box loading for ever.
            return [s.id, [] as SearchItem[], true] as const;
          }
        }),
      ).then((results) => {
        // A superseded request resolving last would paint stale rows under a newer query.
        if (ctl.signal.aborted) return;
        setServer({
          query: active,
          rows: Object.fromEntries(results.map(([id, rows]) => [id, rows])),
          failed: new Set(results.filter(([, , bad]) => bad).map(([id]) => id)),
        });
      });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
    // serverKey, not serverSources: see the ref above.
  }, [active, serverKey]);

  // Rows are only usable when they answered THE CURRENT query.
  const fresh = server.query === active;

  const groups = useMemo<SearchGroup[]>(() => {
    if (active.length < MIN_QUERY) return [];
    return sources.flatMap((src) => {
      const icon = src.icon ?? Search;
      const items: SearchItem[] =
        src.kind === "index"
          ? searchIndex(src.index, active, src.limit ?? DEFAULT_LIMIT).map(
              (row) => ({
                // ALWAYS namespaced by source id, including when the caller supplies
                // `toItem`. Two sources returning the same entity — an MP who is also an
                // official — would otherwise emit two options with the same DOM id, and the
                // combobox marks BOTH aria-selected while arrow keys land on one.
                ...(src.toItem?.(row) ?? {
                  id: row.id,
                  to: row.href,
                  primary: row.label,
                  secondary: row.sub,
                  icon,
                }),
                id: `${src.id}:${row.id}`,
              }),
            )
          : fresh
            ? (server.rows[src.id] ?? []).map((it) => ({
                ...it,
                id: `${src.id}:${it.id}`,
              }))
            : [];
      return toGroup(src, items, bg, active);
    });
  }, [sources, server, fresh, active, bg]);

  // Only sources that could still GAIN rows. A null index that is not `loading` is a source
  // the caller has nothing to build — an empty group, not a pending one.
  const awaitingServer =
    active.length >= MIN_QUERY && serverSources.length > 0 && !fresh;
  const loading =
    awaitingServer || sources.some((s) => s.kind === "index" && s.loading);

  // Name what was searched — a bare "no results" leaves the reader unsure whether the box
  // even covers the entity they wanted. A source with no index was not searched, and one
  // whose fetch FAILED was not answered, so neither may be named: claiming either would
  // report our own outage as an absence of data.
  const searched = sources
    .filter((s) =>
      s.kind === "server" ? !server.failed.has(s.id) : Boolean(s.index),
    )
    .map((s) => pick(s.label, bg).toLowerCase());
  const noResultsLabel = searched.length
    ? bg
      ? `Няма съвпадения в: ${searched.join(", ")}`
      : `No matches in: ${searched.join(", ")}`
    : bg
      ? "Няма съвпадения."
      : "No matches.";

  return (
    <div className={className}>
      <EntitySearchTile
        idPrefix={idPrefix}
        title={pick(title, bg)}
        placeholder={pick(placeholder, bg)}
        hint={pick(hint, bg)}
        loadingLabel={bg ? "Зареждане…" : "Loading…"}
        noResultsLabel={noResultsLabel}
        lang={i18n.language}
        value={query}
        onChange={(v) => {
          arm();
          setQuery(v);
        }}
        onFocus={arm}
        loading={loading}
        groups={groups}
      />
    </div>
  );
};
