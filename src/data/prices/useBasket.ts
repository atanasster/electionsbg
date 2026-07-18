// "Моята кошница" — a localStorage-backed personal shopping basket. No accounts,
// no backend: the user's picked products live in their browser. A module-level
// store + useSyncExternalStore keeps every "add to basket" control and the
// /consumption/basket page in sync, and a `storage` listener syncs across tabs.
// Mirrors the procurement watchlist store (src/data/procurement/useWatchlist.ts).

import { useSyncExternalStore, useCallback } from "react";

export interface BasketItem {
  /** product slug (the /product/:slug id). */
  slug: string;
  /** product title captured at add-time, for instant display before the fetch. */
  title: string;
  addedAt: number;
}

const STORAGE_KEY = "naiasno.consumption.basket.v1";

let items: BasketItem[] = load();
const listeners = new Set<() => void>();

function load(): BasketItem[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as BasketItem[];
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

export function inBasket(slug: string): boolean {
  return items.some((i) => i.slug === slug);
}

export function addToBasket(slug: string, title: string): void {
  if (inBasket(slug)) return;
  items = [...items, { slug, title, addedAt: Date.now() }];
  persist();
  emit();
}

export function removeFromBasket(slug: string): void {
  if (!inBasket(slug)) return;
  items = items.filter((i) => i.slug !== slug);
  persist();
  emit();
}

export function toggleBasket(slug: string, title: string): void {
  if (inBasket(slug)) removeFromBasket(slug);
  else addToBasket(slug, title);
}

export function clearBasket(): void {
  if (items.length === 0) return;
  items = [];
  persist();
  emit();
}

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
const getServerSnapshot = (): BasketItem[] => [];

/** The full basket, reactive. */
export const useBasket = (): BasketItem[] =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

/** Reactive in-basket state + toggle for one product. */
export const useInBasket = (
  slug: string | undefined,
  title: string,
): { inBasket: boolean; toggle: () => void } => {
  const list = useBasket();
  const present = !!slug && list.some((i) => i.slug === slug);
  const toggle = useCallback(() => {
    if (slug) toggleBasket(slug, title);
  }, [slug, title]);
  return { inBasket: present, toggle };
};
