// Combined procurement search for the dashboard. One box over the whole
// section: politicians/officials, other Commerce-Registry people, contractors,
// buyers, contract subjects and tender subjects, grouped in a single dropdown.
// Companies/awarders/contracts/tenders and any Commerce-Registry officer by
// name come from two live DB calls (/api/db/procurement-search +
// /api/db/person-search, debounced together); the political class is also
// matched client-side against the full-corpus scanner roster so the bilingual
// (Cyrillic + transliterated Latin) token matching stays in one place, and its
// richer candidate/official links win over the generic /person/:name link when
// a name is both (dedup by folded name).
//
// This is a thin adapter: it owns the data (fetch + rosters + group building)
// and hands the built groups to the generic EntitySearchTile shell, which owns
// the box, the grouped dropdown, keyboard nav and highlight.

import { FC, useEffect, useMemo, useState } from "react";
import { To, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Briefcase,
  Landmark,
  Receipt,
  ClipboardList,
  Users,
  Scale,
  FolderPlus,
} from "lucide-react";
import {
  EntitySearchTile,
  type SearchGroup,
} from "@/ux/search/EntitySearchTile";
import { fundSearchGroup, type FundRow } from "./fundSearchGroup";
import { projectHref } from "@/data/procurement/projectStore";
import {
  useCorpusPersonIndex,
  type PersonProcurementRow,
} from "@/data/procurement/usePersonProcurementIndex";
import { useMagistrateSearchRoster } from "@/data/judiciary/useMagistrateHoldings";
import { normalizeMpName } from "@/lib/utils";
import { transliterateName } from "@/data/candidates/transliterateName";
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
  funds: FundRow[];
  // Total matches (bounded to 100 server-side; equals the shown length when the
  // preview isn't capped) — drives the "6 of N" hint on the "see all" links.
  contractsTotal: number;
  tendersTotal: number;
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
  funds: [],
  contractsTotal: 0,
  tendersTotal: 0,
};

/** "6 of 12" suffix for a capped preview: the bounded total (100 → "99+") when
 *  there's more than shown, else nothing. */
const moreCount = (shown: number, total: number): string =>
  total > shown ? ` (${total >= 100 ? "99+" : total})` : "";

const MAX_PERSONS = 5;

export const ProcurementSearchTile: FC = () => {
  const { t, i18n } = useTranslation();
  const [params] = useSearchParams();
  const [q, setQ] = useState("");
  const [touched, setTouched] = useState(false);
  const [db, setDb] = useState<DbResults>(EMPTY);
  const [trPeople, setTrPeople] = useState<TrPersonRow[]>([]);
  const [loading, setLoading] = useState(false);

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

  const groups = useMemo((): SearchGroup[] => {
    // "See all" links carry the query into the browser's search box (?q=, read
    // by DbDataTable) and pivot to the FULL corpus (?pscope=all). A search can
    // match contracts/procedures from any year, but the browse tables default to
    // the selected parliament's window — which would land on 0 rows for an older
    // topic (e.g. every Sofia-ring-road contract predates the 2026 parliament).
    // "See all" must mean all-time.
    const seeAllTo = (pathname: string): To => {
      const p = new URLSearchParams(params);
      p.set("q", term);
      p.set("pscope", "all");
      return { pathname, search: `?${p.toString()}` };
    };
    const g: SearchGroup[] = [];
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
            (t("procurement_search_see_all_contracts") ||
              "See all in Contracts") +
            moreCount(db.contracts.length, db.contractsTotal),
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
            (t("procurement_search_see_all_tenders") || "See all in Tenders") +
            moreCount(db.tenders.length, db.tendersTotal),
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
    // ЕВРОФОНДОВЕ · ИСУН projects (§4.1) — built by a pure helper so the
    // "no linkable rows → no empty header" guard is unit-tested.
    const fundGroup = fundSearchGroup(db.funds, i18n.language === "bg");
    if (fundGroup) g.push(fundGroup);
    // Footer on-ramp (§4.3b): turn the current search into a project file —
    // /procurement/project resolves the УНП spine into a lifecycle report.
    if (term.length >= 2)
      g.push({
        key: "project-file",
        // Bilingual-inline (the sector-pack convention) — these are new labels
        // with no i18n keys; t() would echo the raw key for a missing translation.
        label: i18n.language === "bg" ? "Проследи темата" : "Track this topic",
        items: [
          {
            id: "create-project-file",
            to: projectHref({
              title: { bg: term },
              search: [{ terms: term }],
            }),
            primary:
              i18n.language === "bg"
                ? `Създай досие за „${term}“`
                : `Create a file for “${term}”`,
            secondary:
              i18n.language === "bg"
                ? "проследи договорите и процедурите по темата"
                : "track its contracts & procedures",
            icon: FolderPlus,
          },
        ],
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

  return (
    <EntitySearchTile
      idPrefix="psearch"
      title={t("procurement_search_title") || "Search procurement"}
      placeholder={
        t("procurement_search_ph") ||
        "Search a company, awarder, politician, contract or tender…"
      }
      hint={
        t("procurement_search_hint") ||
        "One search across companies, state buyers, politicians, contract subjects and tender procedures."
      }
      loadingLabel={t("loading") || "Loading…"}
      noResultsLabel={t("no_results") || "No results"}
      lang={i18n.language}
      value={q}
      onChange={(v) => {
        setTouched(true);
        setQ(v);
      }}
      onFocus={() => setTouched(true)}
      loading={loading}
      groups={groups}
    />
  );
};
