// The declaration watchlist (audit T3.10) — the people a reader follows.
//
// NO ACCOUNTS, BY DESIGN. The site has no auth, and a server-side record of which reader
// follows which politician is exactly the kind of data a transparency site should not hold.
// The list lives in this browser only; the API takes it as an argument per request and
// stores nothing (098).
//
// Capped at 200: the serving function slices the array there anyway, so a list longer than
// that would silently stop alerting on its tail.

const KEY = "naiasno.watchlist.v1";
export const WATCHLIST_MAX = 200;

const read = (): string[] => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const v: unknown = JSON.parse(raw);
    // Tolerate anything: a corrupted or hand-edited key must not break the profile page.
    // Cap on READ as well as write: a list written by an older build (or by hand) would
    // otherwise report more follows than are actually honoured.
    return Array.isArray(v)
      ? v
          .filter((x): x is string => typeof x === "string" && x.length > 0)
          .slice(0, WATCHLIST_MAX)
      : [];
  } catch {
    return [];
  }
};

const write = (slugs: string[]): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(slugs.slice(0, WATCHLIST_MAX)));
  } catch {
    // Private mode / quota — following is a convenience, never a hard failure.
  }
};

/** Same-tab listeners: `storage` only fires in OTHER tabs, so the toggle would not
 *  re-render the button that triggered it. */
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export const watchlist = {
  all: read,
  has: (slug: string): boolean => read().includes(slug),
  toggle: (slug: string): boolean => {
    const cur = read();
    const next = cur.includes(slug)
      ? cur.filter((s) => s !== slug)
      : [slug, ...cur];
    write(next);
    notify();
    return next.includes(slug);
  },
  subscribe: (fn: () => void): (() => void) => {
    listeners.add(fn);
    window.addEventListener("storage", fn);
    return () => {
      listeners.delete(fn);
      window.removeEventListener("storage", fn);
    };
  },
};
