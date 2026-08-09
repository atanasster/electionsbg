// The /funds hub's finder — one search box over the module's OWN subjects.
//
// WHY THIS EXISTS. The hub's tiles are a fixed set of curated destinations. A reader who
// arrives already knowing what they want cannot say so; they have to guess which tile contains
// their subject. See docs/plans/funds-module-v2.md §5.2 and the dashboard-hub skill's "a hub
// needs a finder".
//
// TWO CORPORA, TWO GROUPS — NOT ONE MERGED LIST. `search_fund_projects` (086) covers ИСУН +
// EEA/Norway; `search_interreg_operations` (138) covers Interreg, which does not run on ИСУН at
// all. They are keyed differently — a fund project by contract_number, an Interreg operation
// only by its keep.eu id (operation_id is NULL for every 2014-2020 row) — so merging them would
// force a NULL key on one side. /api/db/procurement-search returns them as separate groups for
// that reason; we keep the separation rather than flattening it here.
//
// WHAT IS ACTUALLY SEARCHABLE — and why the copy is narrower than it could be.
// `search_fund_projects` matches `f.title` ONLY (086: `WHERE f.title IS NOT NULL … q <% title`,
// a trigram word-similarity over the raw Cyrillic title). `beneficiary_name`, `program_name` and
// `contract_number` come back on the row for DISPLAY but are never matched. The Interreg side
// additionally matches its partner names (`partner_hit`). So the placeholder promises a project
// title and an Interreg partner — not a company, not a contract number. Promising „фирма" or
// „номер на договор" here would invite queries neither group can serve, which reads as "we have
// no data on your company" rather than "this box does not search that".
//
// SCOPE RANKS, IT NEVER FILTERS. Neither corpus is scoped by a /funds selector today, so there
// is no partition. If one is ever added, use `scopedSources()` from hubSearchSources rather than
// filtering — „нищо подобно не е финансирано" is a far worse answer than „в твоята община няма,
// но в областта има 12".
//
// NO NEW BACKEND. Both groups ship on /api/db/procurement-search, whose funds and interreg
// tiers degrade to [] on a database predating 086/138 (its allSettled).

import { FC, useMemo } from "react";
import { Coins, Globe2 } from "lucide-react";
import { HubSearch } from "@/ux/search/HubSearch";
import type { HubSearchSource } from "@/ux/search/hubSearchSources";
import type { SearchItem } from "@/ux/search/EntitySearchTile";
import { decodeEntities } from "@/lib/decodeEntities";

// Only the fields this box renders. The destination pages fetch the full rows.
interface FundRow {
  contractNumber: string;
  title: string | null;
  beneficiaryName: string | null;
  programName: string | null;
  totalEur: number | null;
}

interface InterregRow {
  // `keep_id` is an INTEGER column (138), so JSON carries a number. Typing it `string` would
  // silently compile and then hand `String(undefined)` to the href if the shape ever changed.
  keepId: number | string;
  title: string | null;
  programmeBg: string | null;
  period: string | null;
  bgBudgetEur: number | null;
  partnerHit: string | null;
}

interface SearchResponse {
  funds?: FundRow[];
  interreg?: InterregRow[];
}

const LIMIT = 6;

const joinSub = (parts: (string | null | undefined)[]): string | undefined => {
  const s = parts
    .filter((p): p is string => !!p && p.trim() !== "")
    .map((p) => decodeEntities(p))
    .join(" · ");
  return s === "" ? undefined : s;
};

/** ONE request serves BOTH groups, and failures PROPAGATE.
 *
 *  Sharing is safe because `HubSearch` creates a single `AbortController` per debounced query
 *  and passes that one signal to every source (see its effect), so both sources are awaiting a
 *  promise bound to a signal they jointly own — there is no source that can abort out from
 *  under the other. Without sharing this fires two identical requests per keystroke at a route
 *  that runs 9–15 statements.
 *
 *  It deliberately does NOT swallow errors. `HubSearch` tracks a `failed` set built from sources
 *  whose `fetch` THROWS, and drops failed sources from the „търсено в: …“ line rather than
 *  reporting them as searched-and-empty. Returning `{}` on a 500 would assert an empty corpus.
 *  Both sibling modules (`parliamentSearch.ts`, `declarationsSearch.ts`) throw for the same
 *  reason.
 *
 *  Two consequences of sharing, both accepted:
 *  - a failure fails BOTH groups, since there is only one request. That is honest here: the two
 *    groups come from one endpoint, so its being down really does mean neither was searched.
 *  - verified 2026-08-08 by forcing a 500: the sources leave the „търсено в“ list as intended,
 *    but HubSearch's all-failed empty state still renders a bare „Няма съвпадения.“ Making that
 *    say "search failed" is a change to the SHARED component (it would also affect /parliament
 *    and /governance/declarations), so it is flagged rather than made here. */
const makeSharedFetch = (): ((
  q: string,
  signal: AbortSignal,
) => Promise<SearchResponse>) => {
  let key: string | null = null;
  let inflight: Promise<SearchResponse> | null = null;
  return (q, signal) => {
    if (key !== q || !inflight) {
      key = q;
      inflight = (async () => {
        const res = await fetch(
          `/api/db/procurement-search?q=${encodeURIComponent(q)}&limit=${LIMIT}`,
          { signal },
        );
        if (!res.ok) throw new Error(`procurement-search ${res.status}`);
        return (await res.json()) as SearchResponse;
      })();
      // A rejected shared promise must not be cached, or a retry of the same query is served
      // the old failure for ever. Attach the reset WITHOUT converting the rejection into a
      // value — both awaiting sources must still see it throw.
      inflight.catch(() => {
        if (key === q) {
          key = null;
          inflight = null;
        }
      });
    }
    return inflight;
  };
};

export const FundsFinder: FC<{ className?: string }> = ({ className }) => {
  const sources = useMemo<HubSearchSource[]>(() => {
    const shared = makeSharedFetch();
    return [
      {
        kind: "server",
        id: "funds",
        label: { bg: "Проекти по еврофондове", en: "EU-funds projects" },
        limit: LIMIT,
        fetch: async (q, signal): Promise<SearchItem[]> => {
          const d = await shared(q, signal);
          return (d.funds ?? []).map((r) => ({
            id: r.contractNumber,
            to: `/funds/contract/${encodeURIComponent(r.contractNumber)}`,
            primary: decodeEntities(r.title?.trim() || r.contractNumber),
            secondary: joinSub([r.beneficiaryName, r.programName]),
            amountEur: r.totalEur,
            icon: Coins,
          }));
        },
        // NO `seeAll`. The obvious target, /procurement/contracts?q=, is a browser over the ЗОП
        // `contracts` table — a DIFFERENT corpus that holds none of these rows (086's own note)
        // and is `?pscope`-windowed on top. No funds-project browser reads `?q` yet, and the
        // skill's rule is that a count which links somewhere must be nameable there. When such
        // a browser exists, add the see-all and carry the route's `altQuery` (its shliokavitsa
        // rewrite) rather than the raw needle.
      },
      {
        kind: "server",
        id: "interreg",
        // A DIFFERENT CORPUS, named as one. keep.eu publishes these titles in English only
        // (interreg-funds-ingest-v1 §7), and this label is what tells a Bulgarian reader why the
        // rows under it are in English. It stays explicit rather than folded into the group
        // above — we do not machine-translate the titles.
        label: {
          bg: "Interreg (заглавия на английски)",
          en: "Interreg (English titles)",
        },
        limit: LIMIT,
        fetch: async (q, signal): Promise<SearchItem[]> => {
          const d = await shared(q, signal);
          return (d.interreg ?? []).map((r) => ({
            id: String(r.keepId),
            to: `/funds/interreg/${encodeURIComponent(String(r.keepId))}`,
            primary: decodeEntities(r.title?.trim() || String(r.keepId)),
            secondary: joinSub([r.programmeBg, r.period, r.partnerHit]),
            amountEur: r.bgBudgetEur,
            icon: Globe2,
          }));
        },
      },
    ];
  }, []);

  return (
    <HubSearch
      sources={sources}
      idPrefix="funds-finder"
      className={className}
      title={{ bg: "Намери проект", en: "Find a project" }}
      placeholder={{
        bg: "заглавие на проект, партньор по Interreg…",
        en: "project title, Interreg partner…",
      }}
      hint={{
        bg: "Търси по заглавие на проекта в ИСУН и ЕЕА/Норвегия, и по заглавие или партньор в Interreg.",
        en: "Searches project titles in ИСУН and EEA/Norway, and titles or partners in Interreg.",
      }}
    />
  );
};
