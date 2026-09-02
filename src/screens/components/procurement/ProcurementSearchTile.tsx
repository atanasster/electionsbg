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
import { isBg } from "@/i18n";
import { To, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FolderPlus } from "lucide-react";
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
import {
  awarderItems,
  companyItems,
  contractItems,
  moreCountLabel,
  tenderItems,
  type NamedProcurementEntity,
  type ProcurementContractRow,
  type ProcurementTenderRow,
} from "@/screens/components/search/procurementSearchSource";
import { projectHref } from "@/data/procurement/projectStore";

interface DbResults {
  companies: NamedProcurementEntity[];
  awarders: NamedProcurementEntity[];
  contracts: ProcurementContractRow[];
  tenders: ProcurementTenderRow[];
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

export const ProcurementSearchTile: FC = () => {
  const { t, i18n } = useTranslation();
  const bg = isBg(i18n.language);
  const [params] = useSearchParams();
  const [q, setQ] = useState("");
  const [db, setDb] = useState<DbResults>(EMPTY);
  const [people, setPeople] = useState<PersonSearchResult>(EMPTY_PEOPLE);
  const [loading, setLoading] = useState(false);
  // ⚠️ AN OUTAGE IS NOT AN ABSENCE. Both fetches used to swallow every failure into the
  // empty payload, so a 500 rendered as „Няма резултати" — indistinguishable from „no such
  // company", which is a claim about the data rather than about us. `sharedProcurementSearch`
  // makes the opposite choice for the same reason („Throw rather than degrade"); this box has
  // no „searched in: …" affordance to name WHICH half died, so it says at least that one did.
  const [failed, setFailed] = useState(false);

  const term = q.trim();
  const hasQuery = term.length >= 2;

  // Debounced live DB search (200 ms); stale requests aborted. Two endpoints in parallel:
  // procurement-search (companies/awarders/contracts/tenders by name) and person-search (the
  // three ranked people tiers). A failing fetch degrades to empty for that half.
  useEffect(() => {
    if (!hasQuery) {
      setDb(EMPTY);
      setPeople(EMPTY_PEOPLE);
      setFailed(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctl = new AbortController();
    const id = setTimeout(() => {
      const enc = encodeURIComponent(term);
      // ⚠️ `r.ok` BEFORE `r.json()`. Without it a non-ok body was spread straight into state
      // — harmless only because the error shape happens to share no keys with the payload.
      // `null` is the sentinel for „this half failed"; an abort is not a failure and is
      // discarded by the `aborted` guard below.
      const arm = <T,>(url: string): Promise<T | null> =>
        fetch(url, { signal: ctl.signal })
          .then((r) => (r.ok ? (r.json() as Promise<T>) : null))
          .catch(() => null);
      Promise.all([
        arm<Partial<DbResults>>(`/api/db/procurement-search?q=${enc}`),
        arm<Partial<PersonSearchResult>>(`/api/db/person-search?q=${enc}`),
      ]).then(([search, ppl]) => {
        // A superseded (aborted) request must not clobber newer results.
        if (ctl.signal.aborted) return;
        setDb({ ...EMPTY, ...(search ?? {}) });
        setPeople({ ...EMPTY_PEOPLE, ...(ppl ?? {}) });
        setFailed(search === null || ppl === null);
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
    // ⚠️ THE SHARED BUILDERS, NOT A LOCAL `.map`. `companyItems` is where
    // `isLinkableCompanyKey` lives — this tile hand-rolled the mapping and was therefore
    // the one surface still linking `ph-`/`np-` synthetic contractor keys and the
    // empty-string key (whose href matches no route). ⚠️ And the group guard must test the
    // BUILT list, not the raw row count: a needle matching only synthetic keys would
    // otherwise render an empty „Изпълнители" header.
    const companies = companyItems(db, bg);
    const awarders = awarderItems(db, bg);
    if (companies.length > 0)
      g.push({
        key: "companies",
        label: t("procurement_search_group_companies") || "Contractors",
        items: companies,
      });
    if (awarders.length > 0)
      g.push({
        key: "awarders",
        label: t("procurement_search_group_awarders") || "Awarders",
        items: awarders,
      });
    if (db.contracts.length > 0)
      g.push({
        key: "contracts",
        label: t("procurement_search_group_contracts") || "Contracts",
        seeAll: {
          label:
            (t("procurement_search_see_all_contracts") ||
              "See all in Contracts") +
            moreCountLabel(db.contractsTotal, db.contracts.length),
          to: seeAllTo("/procurement/contracts"),
        },
        // Shared with the home finder and the funds box, so the three cannot disagree
        // about where a contract goes or what its subtitle names.
        items: contractItems(db),
      });
    if (db.tenders.length > 0)
      g.push({
        key: "tenders",
        label: t("procurement_search_group_tenders") || "Tenders",
        seeAll: {
          label:
            (t("procurement_search_see_all_tenders") || "See all in Tenders") +
            moreCountLabel(db.tendersTotal, db.tenders.length),
          to: seeAllTo("/procurement/tenders"),
        },
        items: tenderItems(db),
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
      // ⚠️ A NOTICE, NOT A SWAPPED `noResultsLabel`. This box always offers a „Създай
      // досие за …" row, so its result list is never empty and the empty state is
      // unreachable — an outage folded into it would be a message nobody can see.
      notice={
        failed
          ? t("search_unavailable") ||
            "Search is unavailable right now — this is not an empty result."
          : undefined
      }
      lang={i18n.language}
      value={q}
      onChange={setQ}
      loading={loading}
      groups={groups}
    />
  );
};
