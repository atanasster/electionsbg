import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "connections-watchlist";

const readFromStorage = (): Set<number> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.mpIds)) return new Set();
    return new Set(parsed.mpIds.filter((x: unknown) => typeof x === "number"));
  } catch {
    return new Set();
  }
};

/** localStorage-backed list of starred MPs. The Connections page uses it to
 * highlight watched MPs in the chip-chain list. Cross-tab updates are picked
 * up via the `storage` event so two open tabs stay in sync. */
export const useWatchlist = () => {
  const [mpIds, setMpIds] = useState<Set<number>>(() => readFromStorage());

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      setMpIds(readFromStorage());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const persist = useCallback((next: Set<number>) => {
    setMpIds(next);
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ mpIds: Array.from(next) }),
      );
    } catch {
      // Quota exceeded or storage disabled — fail silently; the in-memory
      // state still reflects the user's intent for this session.
    }
  }, []);

  const toggle = useCallback(
    (mpId: number) => {
      const next = new Set(mpIds);
      if (next.has(mpId)) next.delete(mpId);
      else next.add(mpId);
      persist(next);
    },
    [mpIds, persist],
  );

  const isWatched = useCallback((mpId: number) => mpIds.has(mpId), [mpIds]);

  return { mpIds, isWatched, toggle };
};
