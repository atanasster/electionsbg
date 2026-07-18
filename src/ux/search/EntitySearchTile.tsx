// EntitySearchTile — the generic "one box, grouped dropdown" search shell.
// It owns the presentation and interaction that every combined-search tile
// shares: the card + combobox input, the grouped role=listbox render, keyboard
// navigation (arrows / enter / escape), highlight + scroll-into-view, and the
// loading / empty states. It is CONTROLLED: the caller owns the query value and
// supplies the already-built `groups` (so all data fetching, debouncing and
// entity-specific matching lives in a thin per-domain adapter, e.g.
// ProcurementSearchTile / ConsumptionSearchTile).

import { FC, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, To, useNavigate } from "react-router-dom";
import { Search, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";

/** One selectable dropdown row, whatever the entity. */
export interface SearchItem {
  id: string;
  to: string;
  primary: string;
  secondary?: string;
  amountEur?: number | null;
  icon: FC<{ className?: string }>;
}

export interface SearchGroup {
  key: string;
  label: string;
  items: SearchItem[];
  /** Optional "see all" target carrying the query forward. */
  seeAll?: { label: string; to: To };
}

interface Props {
  title: string;
  placeholder: string;
  /** hint shown under the box before a query is entered. */
  hint: string;
  ariaLabel?: string;
  /** prefix for the results-container + option element ids (aria wiring). */
  idPrefix: string;
  /** i18n language, for compact-euro formatting of amounts. */
  lang: string;
  loadingLabel: string;
  noResultsLabel: string;
  /** controlled query value (already lives in the adapter). */
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  loading?: boolean;
  /** the already-built groups for the current query. */
  groups: SearchGroup[];
}

export const EntitySearchTile: FC<Props> = ({
  title,
  placeholder,
  hint,
  ariaLabel,
  idPrefix,
  lang,
  loadingLabel,
  noResultsLabel,
  value,
  onChange,
  onFocus,
  loading = false,
  groups,
}) => {
  const navigate = useNavigate();
  const [highlight, setHighlight] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);

  const term = value.trim();
  const hasQuery = term.length >= 2;

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  // Stable id → flat-highlight-index lookup, so the grouped render never has to
  // recover positions with a render-time counter.
  const flatIndexById = useMemo(
    () => new Map(flat.map((item, i) => [item.id, i])),
    [flat],
  );
  const empty = flat.length === 0;

  // Whenever the result set changes (new query or fetch landed), clear the
  // highlight so a stale index can't point at a different row.
  useEffect(() => setHighlight(-1), [groups]);

  // Keep the highlighted row scrolled into view as the user arrows through.
  useEffect(() => {
    if (highlight < 0 || !listRef.current) return;
    listRef.current
      .querySelector<HTMLElement>(`[data-idx="${highlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onChange("");
      setHighlight(-1);
      return;
    }
    if (flat.length === 0) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlight((h) => (h + 1) % flat.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlight((h) => (h <= 0 ? flat.length - 1 : h - 1));
        break;
      case "Enter": {
        e.preventDefault();
        const pick = flat[highlight >= 0 ? highlight : 0];
        if (pick) navigate(pick.to);
        break;
      }
    }
  };

  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 pt-0">
        <label className="relative block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="search"
            value={value}
            role="combobox"
            aria-expanded={hasQuery}
            aria-controls={`${idPrefix}-results`}
            aria-activedescendant={
              highlight >= 0 && flat[highlight]
                ? `${idPrefix}-opt-${flat[highlight].id}`
                : undefined
            }
            aria-autocomplete="list"
            onFocus={onFocus}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            aria-label={ariaLabel ?? title}
            className="w-full rounded-md border bg-background pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </label>

        {hasQuery ? (
          <div
            id={`${idPrefix}-results`}
            ref={listRef}
            role="listbox"
            className="mt-2 max-h-96 overflow-auto rounded-md border"
          >
            {loading && empty ? (
              <div className="px-3 py-3 text-sm text-muted-foreground">
                {loadingLabel}
              </div>
            ) : empty ? (
              <div className="px-3 py-3 text-sm text-muted-foreground">
                {noResultsLabel}
              </div>
            ) : (
              groups.map((g) => (
                // role="group": the listbox's children are labelled groups of
                // options, so AT doesn't announce the visual header (hidden —
                // the group label carries it) as a stray non-option node.
                <div key={g.key} role="group" aria-label={g.label}>
                  <div
                    aria-hidden="true"
                    className="sticky top-0 bg-muted/80 backdrop-blur-sm px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground border-b"
                  >
                    {g.label}
                  </div>
                  {g.items.map((item) => {
                    const i = flatIndexById.get(item.id) ?? -1;
                    return (
                      <Link
                        key={item.id}
                        id={`${idPrefix}-opt-${item.id}`}
                        data-idx={i}
                        to={item.to}
                        role="option"
                        aria-selected={i === highlight}
                        onMouseEnter={() => setHighlight(i)}
                        className={`flex items-center gap-2.5 px-3 py-2 text-sm border-b border-border/40 last:border-b-0 ${
                          i === highlight ? "bg-muted" : "hover:bg-muted"
                        }`}
                      >
                        <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{item.primary}</span>
                          {item.secondary ? (
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {item.secondary}
                            </span>
                          ) : null}
                        </span>
                        {item.amountEur != null && item.amountEur > 0 ? (
                          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                            {formatEurCompact(item.amountEur, lang)}
                          </span>
                        ) : null}
                      </Link>
                    );
                  })}
                  {g.seeAll ? (
                    <Link
                      to={g.seeAll.to}
                      className="flex items-center justify-end gap-1 px-3 py-1.5 text-xs text-primary hover:underline border-b border-border/40"
                    >
                      {g.seeAll.label}
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  ) : null}
                </div>
              ))
            )}
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-muted-foreground">{hint}</p>
        )}
      </CardContent>
    </Card>
  );
};
