// The /subsidies finder's source — pure data, no JSX.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// ONE SOURCE, AND IT IS A SERVER ONE — still the only server typeahead in the search feature.
// Every other group ships a pre-folded client index; 16,702 ДФЗ recipients is past the point
// where that is free, so this queries per keystroke, debounced by the shared adapter.
//
// It reads the `agri_beneficiary` ROLLUP, not `agri_subsidies`. The GROUP-BY form over ~2M
// payment rows measured 2,152 ms for „агро"; against the rollup it is 3 ms. That is the whole
// reason the rollup exists.
//
// ⚠️ THE SEARCH IS ALL-TIME, AND THE SCOPE MUST NEVER FILTER IT. `?pscope` narrows every other
// surface in this module, and it deliberately does not narrow this one: „вашата фирма не
// съществува" is a far worse answer than „вашата фирма няма плащания през 2025", and the
// destination — /farm/:eik — scopes itself. `agri_beneficiary` is the all-time rollup for
// exactly this; `agri_beneficiary_year` (§6.1) is the scoped one and is what the RANKINGS read.
//
// If a scope group is ever wanted here, it must be TWO INDEPENDENT SOURCES through
// `scopedSources` — each with its own corpus and its own cap — never one query partitioned
// afterwards. A single capped query split after the fact starves the out-of-scope half
// whenever the in-scope half fills the cap, which turns a ranking back into a filter.
//
// ⚠️ ROWS WITH NO ЕИК ARE ABSENT BY CONSTRUCTION, not by choice. `eik` is NULL on them and
// /farm/:eik is the only destination, so such a row could not land anywhere. That is ~40% of
// the MONEY — and note it is „no ЕИК", not „natural persons": §4.3 measured €385.5m (8.8%) of
// that money on names that are unmistakably companies or municipalities, and says the
// individual share is not knowable from this corpus. So the copy says „редове без ЕИК", and
// the finder links to /subsidies/untraceable, which is the page that owns the distinction.
// ═══════════════════════════════════════════════════════════════════════════════════════════

import { Tractor } from "lucide-react";
import type { SearchItem } from "@/ux/search/EntitySearchTile";
import type {
  HubSearchSource,
  ServerSource,
} from "@/ux/search/hubSearchSources";

interface Row {
  eik: string;
  name: string;
  oblast: string | null;
  totalEur: number;
}

/** One recipient row → one result. `amountEur` is the ALL-TIME total, matching the corpus the
 *  query ran against; showing a scoped figure beside an unscoped result set would be the
 *  filter this source refuses, wearing a number. */
const toItem = (r: Row): SearchItem => ({
  id: r.eik,
  to: `/farm/${r.eik}`,
  primary: r.name,
  secondary: r.oblast ?? undefined,
  amountEur: r.totalEur,
  icon: Tractor,
});

/** A FACTORY, not a constant — which is what makes the see-all below bilingual. `seeAll` is
 *  called with the query alone, so a module-level source could only ever carry one language's
 *  label; `declarationsSearchSources(bg)` and `budgetSearchSources(bg)` solve it the same way. */
export const subsidiesSearchSources = (bg: boolean): HubSearchSource[] => [
  {
    kind: "server",
    id: "farm",
    label: { bg: "Земеделски стопани", en: "Farm beneficiaries" },
    limit: 8,
    // The signal is honoured by the adapter's own abort handling AND passed through here: an
    // in-flight request for a superseded query resolving last would show „Иванови" under
    // „Петров" with no loading indicator.
    fetch: async (query, signal) => {
      const r = await fetch(
        `/api/db/agri-search?q=${encodeURIComponent(query)}&limit=8`,
        { signal },
      );
      if (!r.ok) throw new Error(`agri-search ${r.status}`);
      const rows = (await r.json()) as Row[];
      return Array.isArray(rows) ? rows.map(toItem) : [];
    },
    // „Виж всички" goes to the BROWSE rather than to the recipients ranking, and the reason is
    // the repo's own bar for a see-all: the destination must READ `?q`. /subsidies/browse does
    // (it seeds its DbDataTable's free-text search from it); /subsidies/recipients does not.
    //
    // The browse is also the only honest „all" for a query that matched nothing here — it is the
    // one surface carrying every payment row INCLUDING the ~40% with no ЕИК, which this source
    // cannot return at all.
    seeAll: (q) => ({
      label: bg ? "Виж всички плащания" : "See all payments",
      to: `/subsidies/browse?q=${encodeURIComponent(q)}`,
    }),
  } satisfies ServerSource,
];
