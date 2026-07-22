// Incremental (typeahead) entity search — lets a user scope a project file to a
// specific state awarder (e.g. АПИ) OR contractor/supplier (e.g. Сиела Норма) the
// way the curated starters do, instead of a hardcoded EIK. Debounced backend
// search over the existing procurement-search endpoint, reading either its
// `awarders` group (buyer scope, default) or its `companies` group (contractor
// scope) per the `group` prop. Reusable: the hub build form and the in-page thread
// editor both mount it. Select a suggestion → a chip with a clear ×; clearing
// returns to the input.

import { useEffect, useState, type FC } from "react";

export interface AwarderChoice {
  eik: string;
  name: string;
}

/** Which procurement-search result group + labels this instance drives. */
export type AwarderSearchGroup = "awarders" | "companies";

const GROUP_LABELS: Record<
  AwarderSearchGroup,
  {
    chip: { bg: string; en: string };
    clear: { bg: string; en: string };
    search: { bg: string; en: string };
    placeholder: { bg: string; en: string };
  }
> = {
  awarders: {
    chip: { bg: "Възложител: ", en: "Buyer: " },
    clear: { bg: "Изчисти възложителя", en: "Clear buyer" },
    search: { bg: "Търси възложител", en: "Search buyer" },
    placeholder: {
      bg: "Възложител (по избор) — напр. Пътна инфраструктура…",
      en: "Buyer (optional) — e.g. Road Infrastructure Agency…",
    },
  },
  companies: {
    chip: { bg: "Изпълнител: ", en: "Contractor: " },
    clear: { bg: "Изчисти изпълнителя", en: "Clear contractor" },
    search: { bg: "Търси изпълнител", en: "Search contractor" },
    placeholder: {
      bg: "Изпълнител (по избор) — напр. Сиела Норма…",
      en: "Contractor (optional) — e.g. Ciela Norma…",
    },
  },
};

export const AwarderSearch: FC<{
  value: AwarderChoice | null;
  onChange: (a: AwarderChoice | null) => void;
  bg: boolean;
  /** Which entity to search — buyers (`awarders`, default) or contractors
   *  (`companies`). Picks the procurement-search response group + the labels. */
  group?: AwarderSearchGroup;
  /** Placeholder for the empty input. */
  placeholder?: string;
  /** Extra classes on the wrapper (e.g. a fixed width on a one-row layout). */
  className?: string;
}> = ({ value, onChange, bg, group = "awarders", placeholder, className }) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AwarderChoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const labels = GROUP_LABELS[group];

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctl = new AbortController();
    const id = setTimeout(() => {
      fetch(`/api/db/procurement-search?q=${encodeURIComponent(term)}`, {
        signal: ctl.signal,
      })
        .then(
          (r) =>
            r.json() as Promise<
              Partial<Record<AwarderSearchGroup, AwarderChoice[]>>
            >,
        )
        .then((j) => {
          if (ctl.signal.aborted) return;
          setResults(
            (j[group] ?? [])
              .slice(0, 8)
              .map((a) => ({ eik: a.eik, name: a.name })),
          );
          setLoading(false);
        })
        .catch(() => {
          if (!ctl.signal.aborted) {
            setResults([]);
            setLoading(false);
          }
        });
    }, 200);
    return () => {
      clearTimeout(id);
      ctl.abort();
    };
  }, [query, group]);

  if (value) {
    return (
      <div
        className={`flex min-w-0 items-center gap-2 text-sm ${className ?? ""}`}
      >
        <span className="min-w-0 flex-1 truncate rounded-md border bg-muted px-2 py-1.5">
          <span className="text-muted-foreground">
            {bg ? labels.chip.bg : labels.chip.en}
          </span>
          {value.name}
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="shrink-0 rounded-md border px-2 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={bg ? labels.clear.bg : labels.clear.en}
        >
          ×
        </button>
      </div>
    );
  }
  return (
    <div className={`relative ${className ?? ""}`}>
      <input
        className="w-full rounded-md border px-3 py-1.5 text-sm bg-background"
        value={query}
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-label={bg ? labels.search.bg : labels.search.en}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Delay so an option's onMouseDown/onClick fires before the list closes.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={
          placeholder ?? (bg ? labels.placeholder.bg : labels.placeholder.en)
        }
      />
      {open && (loading || results.length > 0) && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-background shadow-lg">
          {results.length === 0 && loading ? (
            <li className="px-3 py-1.5 text-sm text-muted-foreground">
              {bg ? "Търсене…" : "Searching…"}
            </li>
          ) : (
            results.map((a) => (
              <li key={a.eik}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange(a);
                    setQuery("");
                    setOpen(false);
                  }}
                  className="block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-muted"
                >
                  {a.name}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
};
