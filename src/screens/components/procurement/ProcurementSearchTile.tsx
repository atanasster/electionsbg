// Combined procurement search for the dashboard. One box over the whole section:
// people (in power / linked to public money / other Commerce-Registry owners), contractors,
// buyers, contract subjects and tender subjects, grouped in a single dropdown.
//
// People come from /api/db/person-search (S1), which returns THREE ranked, folded tiers —
// power (public figures), money (owners whose company took public money) and others (the
// long-tail private owners). The old client-side rosters (useCorpusPersonIndex,
// useMagistrateSearchRoster) are retired: the server route now does the bilingual (Cyrillic +
// transliterated Latin) fold + ranking in one place, and covers MPs, officials, magistrates AND
// private owners together. The three people groups are built by the pure buildPersonGroups helper
// (unit-tested). Companies/awarders/contracts/tenders/funds still come from
// /api/db/procurement-search, fetched in parallel.

import { FC, useEffect, useMemo, useState } from "react";
import { To, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Briefcase,
  Landmark,
  Receipt,
  ClipboardList,
  FolderPlus,
} from "lucide-react";
import {
  EntitySearchTile,
  type SearchGroup,
} from "@/ux/search/EntitySearchTile";
import {
  fundSearchGroup,
  interregSearchGroup,
  type FundRow,
  type InterregRow,
} from "./fundSearchGroup";
import {
  buildPersonGroups,
  EMPTY_PEOPLE,
  type PersonSearchResult,
} from "./personSearchGroups";
import { projectHref } from "@/data/procurement/projectStore";
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
  interreg: InterregRow[];
  // Total matches (bounded to 100 server-side; equals the shown length when the
  // preview isn't capped) — drives the "6 of N" hint on the "see all" links.
  contractsTotal: number;
  tendersTotal: number;
  /** The shliokavitsa-rewritten needle the rows actually came from, or null. See the
   *  `linkTerm` note below — a "see all" built from the typed query lands on a browse table
   *  that cannot reproduce the preview. */
  altQuery: string | null;
}

const EMPTY: DbResults = {
  companies: [],
  awarders: [],
  contracts: [],
  tenders: [],
  funds: [],
  interreg: [],
  contractsTotal: 0,
  tendersTotal: 0,
  altQuery: null,
};

/** "6 of 12" suffix for a capped preview: the bounded total (100 → "99+") when
 *  there's more than shown, else nothing. */
const moreCount = (shown: number, total: number): string =>
  total > shown ? ` (${total >= 100 ? "99+" : total})` : "";

export const ProcurementSearchTile: FC = () => {
  const { t, i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const [params] = useSearchParams();
  const [q, setQ] = useState("");
  const [db, setDb] = useState<DbResults>(EMPTY);
  const [people, setPeople] = useState<PersonSearchResult>(EMPTY_PEOPLE);
  const [loading, setLoading] = useState(false);

  const term = q.trim();
  const hasQuery = term.length >= 2;

  // Debounced live DB search (200 ms); stale requests aborted. Two endpoints in parallel:
  // procurement-search (companies/awarders/contracts/tenders by name) and person-search (the
  // three ranked people tiers). A failing fetch degrades to empty for that half.
  useEffect(() => {
    if (!hasQuery) {
      setDb(EMPTY);
      setPeople(EMPTY_PEOPLE);
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
        fetch(`/api/db/person-search?q=${enc}`, { signal: ctl.signal })
          .then((r) => r.json() as Promise<Partial<PersonSearchResult>>)
          .catch(() => EMPTY_PEOPLE),
      ]).then(([search, ppl]) => {
        // A superseded (aborted) request must not clobber newer results.
        if (ctl.signal.aborted) return;
        setDb({ ...EMPTY, ...search });
        setPeople({ ...EMPTY_PEOPLE, ...ppl });
        setLoading(false);
      });
    }, 200);
    return () => {
      clearTimeout(id);
      ctl.abort();
    };
  }, [term, hasQuery]);

  const groups = useMemo((): SearchGroup[] => {
    // "See all" links carry the query into the browser's search box (?q=, read
    // by DbDataTable) and pivot to the FULL corpus (?pscope=all). A search can
    // match contracts/procedures from any year, but the browse tables default to
    // the selected parliament's window — which would land on 0 rows for an older
    // topic. "See all" must mean all-time.
    // `altQuery` when the server answered through the shliokavitsa rewrite. The browse
    // tables these links land on run their own search and do NOT carry that rewrite, so a
    // link built from what the reader typed advertises rows the destination cannot find —
    // „6umen" previews 6 contracts and /procurement/contracts?q=6umen returns 1.
    const linkTerm = db.altQuery || term;
    const peopleLinkTerm = people.altQuery || term;
    const seeAllTo = (pathname: string): To => {
      const p = new URLSearchParams(params);
      p.set("q", linkTerm);
      p.set("pscope", "all");
      return { pathname, search: `?${p.toString()}` };
    };
    // The /persons "see all" carries only ?q (the browse search seed) + sector=all (inert until
    // S3 adds the private slice); pscope is a procurement param /persons does not read.
    const seeAllPersons: To = {
      pathname: "/persons",
      search: `?q=${encodeURIComponent(peopleLinkTerm)}&sector=all`,
    };

    // People — three ranked tiers (built by the pure, unit-tested helper).
    const g: SearchGroup[] = buildPersonGroups(people, bg, seeAllPersons);

    // ── Procurement entities (unchanged) ────────────────────────────────────
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
    const fundGroup = fundSearchGroup(db.funds, bg);
    if (fundGroup) g.push(fundGroup);
    // INTERREG — separate from ИСУН above because it is a separate corpus with
    // no shared key, and because its amount is the Bulgarian partners' share of
    // a cross-border project rather than a beneficiary's contract value.
    const interregGroup = interregSearchGroup(db.interreg, bg);
    if (interregGroup) g.push(interregGroup);
    // Footer on-ramp (§4.3b): turn the current search into a project file.
    if (term.length >= 2)
      g.push({
        key: "project-file",
        label: bg ? "Проследи темата" : "Track this topic",
        items: [
          {
            id: "create-project-file",
            to: projectHref({
              title: { bg: term },
              search: [{ terms: term }],
            }),
            primary: bg
              ? `Създай досие за „${term}“`
              : `Create a file for “${term}”`,
            secondary: bg
              ? "проследи договорите и процедурите по темата"
              : "track its contracts & procedures",
            icon: FolderPlus,
          },
        ],
      });
    return g;
  }, [people, db, t, bg, term, params]);

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
      onChange={setQ}
      loading={loading}
      groups={groups}
    />
  );
};
