// On-site "follow" — a localStorage-backed watchlist of procurement entities
// (buyers, suppliers, politicians, places). No accounts, no backend: the user's
// follows live in their browser. A module-level store + useSyncExternalStore
// keeps every Follow button and the /procurement/watchlist page in sync, and a
// `storage` listener syncs across tabs.

import { useSyncExternalStore, useCallback } from "react";

export type WatchKind = "company" | "awarder" | "person" | "place";

export type WatchItem = {
  kind: WatchKind;
  /** EIK for company/awarder, mp-id for person, ekatte for place. */
  id: string;
  label: string;
  addedAt: number;
};

const STORAGE_KEY = "naiasno.procurement.watchlist.v1";

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
  } else {
    items = [...items, { kind, id, label, addedAt: Date.now() }];
  }
  persist();
  emit();
}

export function removeFollow(kind: WatchKind, id: string): void {
  if (!isFollowing(kind, id)) return;
  items = items.filter((i) => !(i.kind === kind && i.id === id));
  persist();
  emit();
}

// Cross-tab sync: one module-level listener reloads + notifies when another
// tab writes the key (not one listener per subscriber).
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      items = load();
      emit();
    }
  });
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

const getSnapshot = () => items;
const getServerSnapshot = (): WatchItem[] => [];

/** The full watchlist, reactive. */
export const useWatchlist = (): WatchItem[] =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

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
