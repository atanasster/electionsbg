// Company-name search for the procurement dashboard. Type a company name and
// jump to its /company/:eik page. Lives here (not in the global header search)
// because the contractors index is ~475 KB gz — most site visitors are here for
// elections, so only procurement users who actually click into the box pay for
// it. The fetch is gated on first focus.

import { FC, useEffect, useMemo, useRef, useState, KeyboardEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Search, Briefcase } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import {
  useContractorsIndex,
  filterContractors,
} from "@/data/procurement/useContractorsSearch";

const numFmt = new Intl.NumberFormat("bg-BG");

export const CompanySearchTile: FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Flips true on first focus, which enables the index fetch. Stays true after
  // blur so a returning user doesn't re-trigger the query.
  const [active, setActive] = useState(false);
  const [q, setQ] = useState("");
  // Keyboard-highlighted row index (-1 = none). Reset whenever the query
  // changes so a stale highlight can't point past the new result list.
  const [highlight, setHighlight] = useState(-1);
  const { rows, total, isLoading } = useContractorsIndex(active);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(
    () => (q.trim().length >= 2 ? filterContractors(rows, q, 20) : []),
    [rows, q],
  );
  const hasQuery = q.trim().length >= 2;

  // Keep the highlighted row scrolled into view as the user arrows through.
  useEffect(() => {
    if (highlight < 0 || !listRef.current) return;
    (
      listRef.current.children[highlight] as HTMLElement | undefined
    )?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setQ("");
      setHighlight(-1);
      return;
    }
    if (results.length === 0) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlight((h) => (h + 1) % results.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlight((h) => (h <= 0 ? results.length - 1 : h - 1));
        break;
      case "Enter": {
        e.preventDefault();
        // Highlighted row, or the first (best-ranked) match on a bare Enter.
        const pick = results[highlight >= 0 ? highlight : 0];
        if (pick) navigate(`/company/${pick.eik}`);
        break;
      }
    }
  };

  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Briefcase className="h-4 w-4 text-muted-foreground" />
          {t("procurement_company_search_title") || "Find a company"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 pt-0">
        <label className="relative block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="search"
            value={q}
            role="combobox"
            aria-expanded={hasQuery}
            aria-controls="company-search-results"
            aria-activedescendant={
              highlight >= 0
                ? `company-opt-${results[highlight].eik}`
                : undefined
            }
            aria-autocomplete="list"
            onFocus={() => setActive(true)}
            onChange={(e) => {
              setQ(e.target.value);
              setHighlight(-1);
            }}
            onKeyDown={onKeyDown}
            placeholder={
              t("procurement_company_search_ph") ||
              "Search by company name (e.g. Главболгарстрой)…"
            }
            aria-label={
              t("procurement_company_search_title") || "Find a company"
            }
            className="w-full rounded-md border bg-background pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </label>

        {hasQuery ? (
          <div
            id="company-search-results"
            ref={listRef}
            role="listbox"
            className="mt-2 max-h-72 overflow-auto rounded-md border divide-y"
          >
            {isLoading ? (
              <div className="px-3 py-3 text-sm text-muted-foreground">
                {t("loading") || "Loading…"}
              </div>
            ) : results.length === 0 ? (
              <div className="px-3 py-3 text-sm text-muted-foreground">
                {t("no_results") || "No results"}
              </div>
            ) : (
              results.map((c, i) => (
                <Link
                  key={c.eik}
                  id={`company-opt-${c.eik}`}
                  to={`/company/${c.eik}`}
                  role="option"
                  aria-selected={i === highlight}
                  onMouseEnter={() => setHighlight(i)}
                  className={`flex items-center gap-2.5 px-3 py-2 text-sm ${
                    i === highlight ? "bg-muted" : "hover:bg-muted"
                  }`}
                >
                  <Briefcase className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {c.eik}
                  </span>
                </Link>
              ))
            )}
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-muted-foreground">
            {total > 0
              ? t("procurement_company_search_hint_loaded", {
                  n: numFmt.format(total),
                })
              : t("procurement_company_search_hint") ||
                "Search every company that signed a public contract by name."}
          </p>
        )}
      </CardContent>
    </Card>
  );
};
