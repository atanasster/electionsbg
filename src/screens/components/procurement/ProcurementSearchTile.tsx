// Combined procurement search for the dashboard. One box over the whole
// section: politicians/officials, contractors, buyers, contract subjects and
// tender subjects, grouped in a single dropdown. Companies/awarders/contracts/
// tenders come from one live DB call (/api/db/procurement-search, debounced);
// persons are matched client-side against the full-corpus scanner roster so
// the bilingual (Cyrillic + transliterated Latin) token matching stays in one
// place. Replaces the contractors-only CompanySearchTile.

import { FC, useEffect, useMemo, useRef, useState, KeyboardEvent } from "react";
import { Link, To, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Search,
  Briefcase,
  Landmark,
  Receipt,
  ClipboardList,
  Users,
  ArrowRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import {
  useCorpusPersonIndex,
  type PersonProcurementRow,
} from "@/data/procurement/usePersonProcurementIndex";
import { normalizeMpName } from "@/lib/utils";
import { transliterateName } from "@/data/candidates/transliterateName";
import { formatEurCompact } from "@/lib/currency";
import { decodeEntities } from "@/lib/decodeEntities";

interface EntityRow {
  eik: string;
  name: string;
  contracts: number;
  contractsEur: number;
}
interface ContractRow {
  key: string;
  title: string;
  date: string;
  awarderName: string;
  contractorName: string;
  amountEur: number | null;
}
interface TenderRow {
  unp: string;
  subject: string;
  publicationDate: string;
  buyerName: string;
  estimatedValueEur: number | null;
}
interface DbResults {
  companies: EntityRow[];
  awarders: EntityRow[];
  contracts: ContractRow[];
  tenders: TenderRow[];
}

const EMPTY: DbResults = {
  companies: [],
  awarders: [],
  contracts: [],
  tenders: [],
};

/** One selectable dropdown row, whatever the entity. */
interface Item {
  id: string;
  to: string;
  primary: string;
  secondary?: string;
  amountEur?: number | null;
  icon: FC<{ className?: string }>;
}
interface Group {
  key: string;
  label: string;
  items: Item[];
  /** Optional "see all" target carrying the query forward. */
  seeAll?: { label: string; to: To };
}

const MAX_PERSONS = 5;

export const ProcurementSearchTile: FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [q, setQ] = useState("");
  const [touched, setTouched] = useState(false);
  const [db, setDb] = useState<DbResults>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);

  const term = q.trim();
  const hasQuery = term.length >= 2;

  // Person roster is fetched once, on first interaction (focus/typing) — the
  // dashboard doesn't pay the ~20 KB up front.
  const personRows = useCorpusPersonIndex(touched);
  const personSearchRows = useMemo(
    () =>
      personRows.map((row) => ({
        row,
        haystack: `${normalizeMpName(row.name)} ${normalizeMpName(
          transliterateName(row.name),
        )}`,
      })),
    [personRows],
  );

  // Debounced live DB search (200 ms); stale requests aborted.
  useEffect(() => {
    if (!hasQuery) {
      setDb(EMPTY);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctl = new AbortController();
    const id = setTimeout(() => {
      fetch(`/api/db/procurement-search?q=${encodeURIComponent(term)}`, {
        signal: ctl.signal,
      })
        .then((r) => r.json())
        .then((j: Partial<DbResults>) => {
          setDb({ ...EMPTY, ...j });
          setHighlight(-1);
          setLoading(false);
        })
        .catch(() => {
          /* aborted or failed — keep prior results */
        });
    }, 200);
    return () => {
      clearTimeout(id);
      ctl.abort();
    };
  }, [term, hasQuery]);

  const persons = useMemo((): PersonProcurementRow[] => {
    if (!hasQuery) return [];
    const tokens = normalizeMpName(term).split(" ").filter(Boolean);
    if (tokens.length === 0) return [];
    return personSearchRows
      .filter(({ haystack }) => tokens.every((tok) => haystack.includes(tok)))
      .slice(0, MAX_PERSONS)
      .map(({ row }) => row);
  }, [personSearchRows, term, hasQuery]);

  const groups = useMemo((): Group[] => {
    // "See all" links keep the section state (?pscope, elections) AND carry
    // the query into the browser's search box (?q=, read by DbDataTable).
    const seeAllTo = (pathname: string): To => {
      const p = new URLSearchParams(params);
      p.set("q", term);
      return { pathname, search: `?${p.toString()}` };
    };
    const g: Group[] = [];
    if (persons.length > 0)
      g.push({
        key: "persons",
        label:
          t("procurement_search_group_persons") || "Politicians & officials",
        items: persons.map((p) => ({
          id: `person-${p.kind}-${p.kind === "mp" ? p.mpId : p.slug}`,
          to:
            p.kind === "mp"
              ? `/candidate/mp-${p.mpId}`
              : `/officials/${p.slug}`,
          primary: p.name,
          secondary:
            p.kind === "mp"
              ? t("procurement_search_kind_mp") || "MP"
              : t("procurement_search_kind_official") || "Official",
          amountEur: p.totalEur,
          icon: Users,
        })),
      });
    if (db.companies.length > 0)
      g.push({
        key: "companies",
        label: t("procurement_search_group_companies") || "Contractors",
        items: db.companies.map((c) => ({
          id: `company-${c.eik}`,
          to: `/company/${c.eik}`,
          primary: decodeEntities(c.name),
          secondary: c.eik,
          amountEur: c.contractsEur,
          icon: Briefcase,
        })),
      });
    if (db.awarders.length > 0)
      g.push({
        key: "awarders",
        label: t("procurement_search_group_awarders") || "Awarders",
        items: db.awarders.map((a) => ({
          id: `awarder-${a.eik}`,
          to: `/awarder/${a.eik}`,
          primary: decodeEntities(a.name),
          secondary: a.eik,
          amountEur: a.contractsEur,
          icon: Landmark,
        })),
      });
    if (db.contracts.length > 0)
      g.push({
        key: "contracts",
        label: t("procurement_search_group_contracts") || "Contracts",
        seeAll: {
          label:
            t("procurement_search_see_all_contracts") || "See all in Contracts",
          to: seeAllTo("/procurement/contracts"),
        },
        items: db.contracts.map((c) => ({
          id: `contract-${c.key}`,
          to: `/procurement/contract/${c.key}`,
          primary: decodeEntities(c.title),
          secondary: `${c.date} · ${decodeEntities(c.contractorName || c.awarderName)}`,
          amountEur: c.amountEur,
          icon: Receipt,
        })),
      });
    if (db.tenders.length > 0)
      g.push({
        key: "tenders",
        label: t("procurement_search_group_tenders") || "Tenders",
        seeAll: {
          label:
            t("procurement_search_see_all_tenders") || "See all in Tenders",
          to: seeAllTo("/procurement/tenders"),
        },
        items: db.tenders.map((td) => ({
          id: `tender-${td.unp}`,
          to: `/tenders/${td.unp}`,
          primary: decodeEntities(td.subject),
          secondary: `${td.publicationDate} · ${decodeEntities(td.buyerName)}`,
          amountEur: td.estimatedValueEur,
          icon: ClipboardList,
        })),
      });
    return g;
  }, [persons, db, t, term, params]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const empty = flat.length === 0;

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
      setQ("");
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

  // Flat index offsets per group so highlight maps onto the grouped render.
  let idx = -1;

  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          {t("procurement_search_title") || "Search procurement"}
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
            aria-controls="procurement-search-results"
            aria-activedescendant={
              highlight >= 0 && flat[highlight]
                ? `psearch-opt-${flat[highlight].id}`
                : undefined
            }
            aria-autocomplete="list"
            onFocus={() => setTouched(true)}
            onChange={(e) => {
              setTouched(true);
              setQ(e.target.value);
              setHighlight(-1);
            }}
            onKeyDown={onKeyDown}
            placeholder={
              t("procurement_search_ph") ||
              "Search a company, awarder, politician, contract or tender…"
            }
            aria-label={t("procurement_search_title") || "Search procurement"}
            className="w-full rounded-md border bg-background pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </label>

        {hasQuery ? (
          <div
            id="procurement-search-results"
            ref={listRef}
            role="listbox"
            className="mt-2 max-h-96 overflow-auto rounded-md border"
          >
            {loading && empty ? (
              <div className="px-3 py-3 text-sm text-muted-foreground">
                {t("loading") || "Loading…"}
              </div>
            ) : empty ? (
              <div className="px-3 py-3 text-sm text-muted-foreground">
                {t("no_results") || "No results"}
              </div>
            ) : (
              groups.map((g) => (
                <div key={g.key}>
                  <div className="sticky top-0 bg-muted/80 backdrop-blur-sm px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground border-b">
                    {g.label}
                  </div>
                  {g.items.map((item) => {
                    idx += 1;
                    const i = idx;
                    return (
                      <Link
                        key={item.id}
                        id={`psearch-opt-${item.id}`}
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
                            {formatEurCompact(item.amountEur, i18n.language)}
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
          <p className="mt-2 text-[11px] text-muted-foreground">
            {t("procurement_search_hint") ||
              "One search across companies, state buyers, politicians, contract subjects and tender procedures."}
          </p>
        )}
      </CardContent>
    </Card>
  );
};
