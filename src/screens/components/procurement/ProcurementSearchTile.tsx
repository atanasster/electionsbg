// Combined procurement search for the dashboard. One box over the whole
// section: politicians/officials, other Commerce-Registry people, contractors,
// buyers, contract subjects and tender subjects, grouped in a single dropdown.
// Companies/awarders/contracts/tenders and any Commerce-Registry officer by
// name come from two live DB calls (/api/db/procurement-search +
// /api/db/person-search, debounced together); the political class is also
// matched client-side against the full-corpus scanner roster so the bilingual
// (Cyrillic + transliterated Latin) token matching stays in one place, and its
// richer candidate/official links win over the generic /person/:name link when
// a name is both (dedup by folded name). Replaces the contractors-only
// CompanySearchTile.

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
  Scale,
  ArrowRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import {
  useCorpusPersonIndex,
  type PersonProcurementRow,
} from "@/data/procurement/usePersonProcurementIndex";
import { useMagistrateSearchRoster } from "@/data/judiciary/useMagistrateHoldings";
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
/** Any Commerce-Registry officer matching the name — not just the political
 *  class. Lets a company owner / board member who isn't a politician still be
 *  reached, linking to the DB-backed /person/:name portfolio. `companies` is a
 *  count serialised as a string (pg bigint). From /api/db/person-search. */
interface TrPersonRow {
  name: string;
  companies: number | string;
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
  const [trPeople, setTrPeople] = useState<TrPersonRow[]>([]);
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

  // Magistrates who declared a company (ИВСС). Same client-side, bilingual token
  // match as the political roster; links to the generic /person/:name page, which
  // carries the magistrate's declared-companies tile.
  const magistrateRows = useMagistrateSearchRoster(touched);
  const magistrateSearchRows = useMemo(
    () =>
      magistrateRows.map((row) => ({
        row,
        haystack: `${normalizeMpName(row.name)} ${normalizeMpName(
          transliterateName(row.name),
        )}`,
      })),
    [magistrateRows],
  );

  // Debounced live DB search (200 ms); stale requests aborted. Two endpoints in
  // parallel: procurement-search (companies/awarders/contracts/tenders by name)
  // and person-search (ANY Commerce-Registry officer by name, so a company
  // owner or board member who isn't a politician is still reachable). A failing
  // fetch degrades to empty for that half rather than blanking the box.
  useEffect(() => {
    if (!hasQuery) {
      setDb(EMPTY);
      setTrPeople([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctl = new AbortController();
    const id = setTimeout(() => {
      const enc = encodeURIComponent(term);
      Promise.all([
        fetch(`/api/db/procurement-search?q=${enc}`, { signal: ctl.signal })
          .then((r) => r.json() as Promise<Partial<DbResults>>)
          .catch(() => EMPTY),
        // limit=20: a small bounded set to dedup + cap client-side, not the
        // endpoint's full fuzzy match list.
        fetch(`/api/db/person-search?q=${enc}&limit=20`, { signal: ctl.signal })
          .then((r) => r.json() as Promise<{ people?: TrPersonRow[] }>)
          .catch(() => ({ people: [] as TrPersonRow[] })),
      ]).then(([search, ppl]) => {
        // A superseded (aborted) request must not clobber newer results.
        if (ctl.signal.aborted) return;
        setDb({ ...EMPTY, ...search });
        setTrPeople(ppl.people ?? []);
        setHighlight(-1);
        setLoading(false);
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

  const magistrates = useMemo(() => {
    if (!hasQuery) return [];
    const tokens = normalizeMpName(term).split(" ").filter(Boolean);
    if (tokens.length === 0) return [];
    const shown = new Set(persons.map((p) => normalizeMpName(p.name)));
    return magistrateSearchRows
      .filter(({ haystack }) => tokens.every((tok) => haystack.includes(tok)))
      .map(({ row }) => row)
      .filter((row) => !shown.has(normalizeMpName(row.name)))
      .slice(0, MAX_PERSONS);
  }, [magistrateSearchRows, persons, term, hasQuery]);

  // Commerce-Registry people matching the name, EXCLUDING anyone already shown
  // in the political group (dedup by folded name — the endpoint also returns
  // case-variant rows of the same name, which this collapses too). Gated to
  // multi-token (full-name) queries: a single token is usually a company name
  // or bare surname, where the fuzzy person-search surfaces corporate-officer
  // entities and near-matches as noise — full names are the case this group
  // exists for. The political group is unaffected (it matches any token count).
  const trPeopleFiltered = useMemo((): TrPersonRow[] => {
    const tokenCount = normalizeMpName(term).split(" ").filter(Boolean).length;
    if (!hasQuery || tokenCount < 2 || trPeople.length === 0) return [];
    const seen = new Set([
      ...persons.map((p) => normalizeMpName(p.name)),
      ...magistrates.map((m) => normalizeMpName(m.name)),
    ]);
    const out: TrPersonRow[] = [];
    for (const p of trPeople) {
      const norm = normalizeMpName(p.name);
      if (seen.has(norm)) continue;
      seen.add(norm);
      out.push(p);
      if (out.length >= MAX_PERSONS) break;
    }
    return out;
  }, [trPeople, persons, magistrates, term, hasQuery]);

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
    if (magistrates.length > 0)
      g.push({
        key: "magistrates",
        label: t("procurement_search_group_magistrates") || "Magistrates",
        items: magistrates.map((m, i) => ({
          id: `magistrate-${i}`,
          to: `/person/${encodeURIComponent(m.name)}`,
          primary: m.name,
          secondary:
            m.court ?? (i18n.language === "bg" ? "магистрат" : "magistrate"),
          icon: Scale,
        })),
      });
    if (trPeopleFiltered.length > 0)
      g.push({
        key: "people",
        label:
          t("procurement_search_group_people") || "People (Commerce Registry)",
        items: trPeopleFiltered.map((p, i) => ({
          id: `trperson-${i}`,
          to: `/person/${encodeURIComponent(p.name)}`,
          primary: p.name,
          secondary: (
            t("procurement_search_person_cos") || "{{count}} companies"
          ).replace("{{count}}", String(p.companies)),
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
  }, [
    persons,
    magistrates,
    trPeopleFiltered,
    db,
    t,
    i18n.language,
    term,
    params,
  ]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  // Stable id → flat-highlight-index lookup, so the grouped render never has
  // to recover positions with a render-time counter.
  const flatIndexById = useMemo(
    () => new Map(flat.map((item, i) => [item.id, i])),
    [flat],
  );
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
