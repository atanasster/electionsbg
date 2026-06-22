// On-site "follow" — a localStorage-backed watchlist of procurement entities
// (buyers, suppliers, politicians, places, single contracts). No accounts, no
// backend: the user's follows live in their browser. A module-level store +
// useSyncExternalStore keeps every Follow control and the /procurement/watchlist
// page in sync, and a `storage` listener syncs across tabs.
//
// Two stores live here:
//   1. the watchlist itself (what you follow)
//   2. a per-item "last seen" snapshot map — the signature (contract count,
//      total, latest contract date) of each entity the last time you looked.
//      The watchlist page diffs the live signature against this to surface
//      "new activity since you last looked" and drive the unread badge.

import { useSyncExternalStore, useCallback } from "react";

export type WatchKind = "company" | "awarder" | "person" | "place" | "contract";

export type WatchItem = {
  kind: WatchKind;
  /** EIK for company/awarder, mp-id for person, ekatte for place, contract key
   *  (12-hex) for contract. */
  id: string;
  label: string;
  addedAt: number;
};

/** The comparable "state" of a watched entity at a point in time. */
export type WatchSignature = {
  count: number;
  totalEur: number;
  /** ISO date of the most recent contract we know about, or "" if unknown. */
  latestDate: string;
};

export type SeenSnapshot = WatchSignature & { at: number };

const STORAGE_KEY = "naiasno.procurement.watchlist.v1";
const SEEN_KEY = "naiasno.procurement.watchlist.seen.v1";

const itemKey = (kind: WatchKind, id: string): string => `${kind}:${id}`;

// ---------------------------------------------------------------------------
// Store 1 — the watchlist
// ---------------------------------------------------------------------------

let items: WatchItem[] = load();
const listeners = new Set<() => void>();

function load(): WatchItem[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as WatchItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // storage full / blocked — keep the in-memory copy.
  }
}

function emit(): void {
  for (const l of listeners) l();
}

export function isFollowing(kind: WatchKind, id: string): boolean {
  return items.some((i) => i.kind === kind && i.id === id);
}

export function toggleFollow(kind: WatchKind, id: string, label: string): void {
  const exists = isFollowing(kind, id);
  if (exists) {
    items = items.filter((i) => !(i.kind === kind && i.id === id));
    dropSeen(kind, id);
  } else {
    items = [...items, { kind, id, label, addedAt: Date.now() }];
  }
  persist();
  emit();
}

export function removeFollow(kind: WatchKind, id: string): void {
  if (!isFollowing(kind, id)) return;
  items = items.filter((i) => !(i.kind === kind && i.id === id));
  dropSeen(kind, id);
  persist();
  emit();
}

// ---------------------------------------------------------------------------
// Store 2 — the "last seen" snapshot map
// ---------------------------------------------------------------------------

let seen: Record<string, SeenSnapshot> = loadSeen();
const seenListeners = new Set<() => void>();

function loadSeen(): Record<string, SeenSnapshot> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, SeenSnapshot>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function persistSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    // ignore
  }
}

function emitSeen(): void {
  for (const l of seenListeners) l();
}

function dropSeen(kind: WatchKind, id: string): void {
  const k = itemKey(kind, id);
  if (seen[k]) {
    const next = { ...seen };
    delete next[k];
    seen = next;
    persistSeen();
    emitSeen();
  }
}

export function getSeen(kind: WatchKind, id: string): SeenSnapshot | undefined {
  return seen[itemKey(kind, id)];
}

/** Record that the user has now "seen" this entity at the given signature. */
export function markSeen(
  kind: WatchKind,
  id: string,
  sig: WatchSignature,
): void {
  seen = { ...seen, [itemKey(kind, id)]: { ...sig, at: Date.now() } };
  persistSeen();
  emitSeen();
}

/** Mark several entities seen in one write (used by "mark all seen"). */
export function markManySeen(
  entries: Array<{ kind: WatchKind; id: string; sig: WatchSignature }>,
): void {
  if (entries.length === 0) return;
  const at = Date.now();
  const next = { ...seen };
  for (const e of entries) next[itemKey(e.kind, e.id)] = { ...e.sig, at };
  seen = next;
  persistSeen();
  emitSeen();
}

// ---------------------------------------------------------------------------
// Store 3 — cached "new activity" count
//
// Computing how many followed entities have new activity needs each entity's
// live rollup. That's fine on the watchlist page (it shows the data anyway),
// but the unread badge + overview digest render on EVERY procurement page — we
// don't want them fetching every rollup site-wide just for a number. So the
// watchlist page writes the freshly-computed count here, and the badge/digest
// read it with zero network. It's eventually-consistent (refreshed whenever the
// watchlist is opened), which is plenty for a fortnightly-updated dataset.
// ---------------------------------------------------------------------------

const NEWCOUNT_KEY = "naiasno.procurement.watchlist.newcount.v1";

let newCount = loadNewCount();
const newCountListeners = new Set<() => void>();

function loadNewCount(): number {
  if (typeof localStorage === "undefined") return 0;
  try {
    const n = parseInt(localStorage.getItem(NEWCOUNT_KEY) || "0", 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Cache the freshly-computed new-activity count (called by the watchlist page). */
export function setCachedNewCount(n: number): void {
  const v = Math.max(0, Math.floor(n));
  if (v === newCount) return;
  newCount = v;
  try {
    localStorage.setItem(NEWCOUNT_KEY, String(v));
  } catch {
    // ignore
  }
  for (const l of newCountListeners) l();
}

function subscribeNewCount(cb: () => void): () => void {
  newCountListeners.add(cb);
  return () => {
    newCountListeners.delete(cb);
  };
}

// ---------------------------------------------------------------------------
// Cross-tab sync: one module-level listener per store reloads + notifies when
// another tab writes the key.
// ---------------------------------------------------------------------------

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      items = load();
      emit();
    } else if (e.key === SEEN_KEY) {
      seen = loadSeen();
      emitSeen();
    } else if (e.key === NEWCOUNT_KEY) {
      newCount = loadNewCount();
      for (const l of newCountListeners) l();
    }
  });
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function subscribeSeen(cb: () => void): () => void {
  seenListeners.add(cb);
  return () => {
    seenListeners.delete(cb);
  };
}

const getSnapshot = () => items;
const getServerSnapshot = (): WatchItem[] => [];
const getSeenSnapshot = () => seen;
const getSeenServerSnapshot = (): Record<string, SeenSnapshot> => ({});

/** The full watchlist, reactive. */
export const useWatchlist = (): WatchItem[] =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

/** The full "last seen" map, reactive. */
export const useSeenMap = (): Record<string, SeenSnapshot> =>
  useSyncExternalStore(subscribeSeen, getSeenSnapshot, getSeenServerSnapshot);

/** Cached new-activity count, reactive. Clamped to the current list length so a
 *  stale cache never over-reports after items are unfollowed elsewhere. Zero
 *  network — the watchlist page refreshes the underlying value. */
export const useCachedNewCount = (): number => {
  const n = useSyncExternalStore(
    subscribeNewCount,
    () => newCount,
    () => 0,
  );
  const list = useWatchlist();
  return list.length === 0 ? 0 : Math.min(n, list.length);
};

/** Reactive follow-state + toggle for one entity. */
export const useFollow = (
  kind: WatchKind,
  id: string | undefined,
  label: string,
): { following: boolean; toggle: () => void } => {
  const list = useWatchlist();
  const following = !!id && list.some((i) => i.kind === kind && i.id === id);
  const toggle = useCallback(() => {
    if (id) toggleFollow(kind, id, label);
  }, [kind, id, label]);
  return { following, toggle };
};
