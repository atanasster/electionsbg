# Home search expansion — implementation plan v1

Status: **research complete; implementation not started**
Scope: the finder on `/` only, plus the shared search adapters and backend correctness work
required for its results to be true and reproducible.

## 1. Outcome

Expand the home finder from five visible groups to ten:

1. places;
2. public figures — mayors, councillors, magistrates, MPs, executive/public-sector officials,
   regulators and other resolved public people;
3. people from the Commerce Registry — both owners/managers linked to public money and the
   long-tail private-company people;
4. contracting institutions;
5. companies with public contracts;
6. signed public-procurement contracts;
7. public-procurement procedures/tenders;
8. EU-funds projects from ISUN + EEA/Norway;
9. Interreg operations;
10. basket products.

The implementation should **not** add a catch-all endpoint, a search service, or a second
client index. The two existing DB endpoints already execute and return every requested people
and public-money corpus. The home adapter currently discards most of those responses.

The target data flow is:

```text
Home HubSearch
├── lazy slim place catalog ─────────────────────── Places
├── /api/db/person-search ─┬────────────────────── Public figures
│                          └────────────────────── Commerce-Registry people
├── /api/db/procurement-search ─┬──────────────── Institutions
│                               ├──────────────── Companies
│                               ├──────────────── Contracts
│                               ├──────────────── Procedures / tenders
│                               ├──────────────── ISUN + EEA/Norway projects
│                               └──────────────── Interreg operations
└── /api/db/price-search ───────────────────────── Products
```

After the finder is armed, one debounced query still costs **three server requests**, exactly
as it does now: one people request, one procurement request, and one product request. The place
catalog remains lazy and local once loaded.

## 2. What the code and data say now

### 2.1 The home client drops results the backend already returns

[`src/screens/home/homeSearch.ts`](../../src/screens/home/homeSearch.ts) reads only
`body.power` from `/api/db/person-search`. It ignores:

- `money`: private people whose companies are linked to public money;
- `others`: the remaining Commerce-Registry people.

The same module exposes only `awarders` and `companies` from the shared procurement response.
[`functions/db_routes.js`](../../functions/db_routes.js) already returns six procurement groups:

- `companies`;
- `awarders`;
- `contracts`;
- `tenders`;
- `funds`;
- `interreg`.

`/api/db/procurement-search` runs those six searches today even when the home page renders only
two of them. Surfacing the other four adds client mapping and rows in the dropdown, not more SQL
or another network call.

### 2.2 The people corpus already has the requested coverage

Read-only measurements against the local Postgres corpus on 2026-09-01:

| Tier | Position type | Rows | Meaning |
| --- | --- | ---: | --- |
| P | politician | 46,159 | MPs, mayors, councillors, candidates and other political roles |
| P | executive | 8,234 | executive branch |
| P | public_sector | 5,882 | public-sector officials |
| P | magistrate | 3,535 | judges, prosecutors and other magistrates |
| P | regulator | 26 | independent regulators |
| V | private_sector | 84,557 | Commerce-Registry people linked to public money |
| N | private_sector | 445,804 | other Commerce-Registry people |
| | **Total** | **594,197** | |

The source/ranking model is already correct for the requested semantics:

- P is the authoritative public-person tier;
- V is private and money-linked;
- N is the private long tail;
- each tier has its own top-K ordered by `rank_static`, so a common private namesake does not
  outrank a public figure.

### 2.3 Why `vassil terziev` fails

The person exists in `person_search` as `Васил Александров Терзиев`, with:

- `position_type = politician`;
- `primary_role = mayor`;
- `place_label = Столична община`.

The route's fuzzy predicate compares the **whole query** against the **whole three-part name**:

```sql
name_fold %> translit_bg_latin($query)
```

Natural first+family search omits the patronymic. The whole-string similarity for
`vassil terziev` does not clear the route predicate, even though both name words match.

A read-only token-wise probe on the current index does find him:

```sql
name_fold %> translit_bg_latin('vassil')
AND name_fold %> translit_bg_latin('terziev')
```

Measured local warm plans:

| Probe | Tier | Execution |
| --- | --- | ---: |
| `vassil` + `terziev` | P | 3.47 ms |
| `ivan` + `ivanov` | P | 0.44 ms |
| `ivan` + `ivanov` | V | 5.11 ms |
| `ivan` + `ivanov` | N | 2.04 ms |

No new index is needed. Postgres either early-stops on `idx_person_search_rank` or combines the
existing trigram probes on `idx_person_search_fold`, depending on selectivity.

The local corpus currently has **two** Vassil Terziev person rows: one carrying the
`official_muni` mayor role and one the 2023 `local` mayor role. That is a person-identity split,
not a search-result presentation problem. A client-side “same name, same role” dedupe could merge
real namesakes and must not be used.

### 2.4 The public-money corpora and routes are already present

Local corpus sizes on 2026-09-01:

| Corpus | Rows |
| --- | ---: |
| signed procurement contracts | 410,369 |
| tender procedures | 238,304 |
| ISUN + EEA/Norway projects | 82,283 |
| Interreg operations | 1,958 |
| Interreg partner rows | 12,015 |

The live detail destinations already exist:

| Result | Destination |
| --- | --- |
| person P | route-provided `/person/:slug` |
| person V/N | route-provided/name-encoded `/person/:name` |
| institution | `/awarder/:eik` |
| company | `/company/:eik` |
| contract | `/procurement/contract/:key` |
| tender | `/tenders/:unp` |
| fund project | `/funds/contract/:contractNumber` |
| Interreg operation | `/funds/interreg/:keepId` |

[`src/screens/components/procurement/fundSearchGroup.ts`](../../src/screens/components/procurement/fundSearchGroup.ts)
is stale: it links an ISUN hit to the beneficiary company and drops a project without a
beneficiary EIK. [`src/screens/funds/FundsFinder.tsx`](../../src/screens/funds/FundsFinder.tsx)
already uses the correct project-detail route. The shared adapter should follow the latter.

### 2.5 One remaining cross-script gap is in fund-project search

Contract and tender subjects search transliterated `*_fold` columns. Interreg has a dedicated
folded partner-name arm. `search_fund_projects`, however, compares the query with the raw Cyrillic
`title` only.

Measured against the current corpus:

- `search_fund_projects('ремонт', 6)` → 6 rows;
- `search_fund_projects('remont', 6)` → 0 rows.

That inconsistency is especially visible on the global home finder, where places, people,
institutions, companies, contracts and tenders all support a Latin keyboard.

Warm local measurements after priming were 19.8 ms for a common contract query, 10.6 ms for
tenders, 20.4 ms for fund projects and 2.4 ms for Interreg. Cold-cache timings were materially
higher; these are local diagnostics, not a Cloud SQL p95 claim. Importantly, the home expansion
does not add any of these searches—the procurement route already performs them.

## 3. Design decisions

### 3.1 Keep the grouped `HubSearch` model

Do not flatten all corpora into one relevance score. Their authorities and amounts are not
comparable: a person's `rank_static`, a contract value, a project grant and an Interreg Bulgarian
partner share answer different questions. Grouping preserves that meaning and the existing
combobox/listbox accessibility model.

### 3.2 Give public and private people independent quotas

Use two home sources backed by one shared person response:

1. **Public figures** — P only;
2. **Commerce-Registry people** — a balanced V/N preview.

One combined people list with all P rows first would reproduce the current failure in a subtler
form: common public-name matches would consume the source cap before a private-company person
could appear. The private source should take one V row and one N row when both exist, then fill a
vacant slot from the other tier.

Do not put a “see all” link on the Commerce-Registry group. `/persons` browses P and V, not the
445,804-row N tier, so such a link would promise a result set the destination cannot reproduce.
The direct person result remains linkable.

### 3.3 Show the specific office, not only the broad facet

For public people, render:

```text
<localized primary_role> · <place_label>
```

and fall back to the broad `position_type` only if `primary_role` has no label. Vassil Terziev
must read as `Кмет · Столична община`, not merely `Политик · Столична община`.

Reuse `usePersonLabels().roleLabel` / the `pp_role_*` and `tr_role_*` vocabulary. Do not create a
third mayor/councillor/magistrate label map inside home search.

For V/N people, keep the identity caveat from `personSearchGroups.ts`: a name-derived identity
must say that it is a name match, and `shared_name` must retain its stronger several-people
warning. Show `public_money_eur` only for V.

### 3.4 Keep a hard 20-row dropdown budget

The proposed order and caps are:

| Order | Group id | Cap | “See all” |
| ---: | --- | ---: | --- |
| 1 | `places` | 3 | none |
| 2 | `public-people` | 3 | none in v1; `/persons` does not reproduce this endpoint's typo-tolerant matching |
| 3 | `company-people` | 2 | none |
| 4 | `awarders` | 2 | none; no awarder browser reads `?q` |
| 5 | `companies` | 2 | `/procurement/contractors?q=…&pscope=all` |
| 6 | `contracts` | 2 | `/procurement/contracts?q=…&pscope=all` |
| 7 | `tenders` | 2 | `/procurement/tenders?q=…&pscope=all` |
| 8 | `funds` | 1 | none; no fund-project browser reads `?q` |
| 9 | `interreg` | 1 | none |
| 10 | `products` | 2 | `/consumption/products?q=…` |
| | **Total** | **20** | |

`HubSearch` already scroll-bounds the dropdown at `max-h-96`; the cap limits keyboard traversal
and keeps a broad query from turning the global finder into a browser.

Contract/tender “see all” links must use the response's `altQuery` and `pscope=all`, as the
existing procurement tile does. The current public-people see-all link is removed in this pass:
`/api/db/person-search` is typo-tolerant while `/persons?q=` is token-substring search, so the
user's `vassil terziev` example can succeed in the preview and fail at the alleged full result.
Never add a see-all destination merely because a route exists; the destination must reproduce
the query semantics and represent the same corpus.

### 3.5 Keep ISUN/EEA/Norway and Interreg separate

They have different keys and different money meanings:

- a fund project is keyed by `contract_number` and shows its project amount;
- an Interreg operation is keyed by `keep_id` and shows the Bulgarian partners' share, not the
  cross-border operation total.

Do not combine them under one result heading or amount formatter.

## 4. Implementation plan

### Phase 1 — fix person-name matching without changing ranking

1. Extract the existing qualifying-word logic from
   [`functions/db_table.js`](../../functions/db_table.js) into one exported pure helper used by
   both `searchFoldTokens` and the route:
   - split on Unicode whitespace;
   - normalize NFC and deduplicate case-insensitively;
   - keep words at `SEARCH_MIN_CHARS` or longer;
   - stop at `MAX_SEARCH_WORDS`;
   - return the existing single-query path when fewer than two words qualify.
2. In the `person-search` handler in
   [`functions/db_routes.js`](../../functions/db_routes.js), retain the whole-fold `exactQ` and
   replace only the multi-word fuzzy predicate with one `%>` predicate per qualifying word,
   ANDed against the same `name_fold`.
3. Keep `ORDER BY rank_static DESC LIMIT …` byte-visible in the route. Do not add a dynamic
   similarity sort over the full match set; the existing comments record a 231 ms regression
   for common names when early-stop ranking was lost.
4. Apply the same helper to an alternate shliokavitsa needle because `tierRows` must have one
   matching contract regardless of which needle produced it.
5. Preserve the `decl=1|0` predicates and missing-migration degradation.

Tests:

- extend `functions/db_routes.person_search.test.js` for two-token SQL/params, word dedupe, word
  cap, single-word fallback, `decl`, and alternate-query paths;
- extend `scripts/db/tests/person_search.data.test.ts` so `vassil terziev`, `vasil terziev` and
  `васил терзиев` return the mayor row;
- retain the route-source gate for `ORDER BY rank_static`;
- use `EXPLAIN` to fail on a sequential scan for the representative multi-word probes, but do
  not make wall-clock milliseconds a CI assertion.

### Phase 2 — repair the known Vassil identity split through the identity layer

1. Verify the exact two source mentions currently split across:
   - `official_muni:vasil-aleksandrov-terziev-049f64`;
   - `local:2023_10_29_mi:SOF:mayor`.
2. Record an audited ref-level merge through the existing person-override workflow
   (`data/person/link_overrides.json` / `person:override`), with evidence and reviewer metadata.
3. Re-run the person resolver and all dependent serving layers through the repository's
   `update-persons` workflow, including slug retirement/redirects, declarations, person browse,
   and `person_search`.
4. Add a data gate that the two refs resolve to one active person and that the home query produces
   one Vassil mayor hit.

Do **not** add a client or SQL `DISTINCT ON (name, role, place)` workaround. Two real people can
share those display fields; the person identity layer is the only authority licensed to merge
them.

### Phase 3 — make the two server responses reusable as result sources

#### Person adapter

Create `src/screens/components/search/personSearchSource.ts` (or move the equivalent pure pieces
there) with:

- the canonical `PersonHit` / response types, imported by the home and procurement consumers;
- one in-flight promise keyed by the full request key (`q` plus any route modifiers such as
  `decl`), evicted after rejection/abort;
- `fetchPublicPeople` and `fetchCompanyPeople` adapters that await that same promise;
- a deterministic V/N quota helper;
- shared person-to-route, role subtitle, identity caveat and `altQuery` handling.

The signal sharing is safe because `HubSearch` supplies one `AbortController` to every source for
one debounced query. A rejected promise must still throw to every awaiting source so an outage is
not reported as an empty corpus.

Migrate home first. Reuse the types/mappers in `ProcurementSearchTile`, governance and declarations
where doing so is behavior-preserving; do not merge their different scope/`decl` semantics.

#### Procurement adapter

Expand
[`src/screens/components/search/procurementSearchSource.ts`](../../src/screens/components/search/procurementSearchSource.ts)
from two response groups to the complete route shape:

- typed entity, contract, tender, fund and Interreg rows;
- shared fetchers/item builders for all six groups;
- query-keyed `altQuery`, `contractsTotal` and `tendersTotal` metadata for valid see-all links;
- URI encoding for every path parameter;
- `decodeEntities` on every externally sourced display string;
- `isLinkableCompanyKey` for contractor destinations.

Refactor `FundsFinder` and `ProcurementSearchTile` to reuse these row mappers or pure item builders
so the home, procurement and funds surfaces cannot disagree about destinations or money fields.
Keep the procurement tile's project-file footer as a tile-only concern.

Update `fundSearchGroup.ts` so every valid `contractNumber` links directly to
`/funds/contract/:number`; a missing beneficiary EIK must no longer hide a real project.

### Phase 4 — make fund titles bilingual like the sibling groups

1. In
   [`scripts/db/schema/pg/086_search_fund_projects.sql`](../../scripts/db/schema/pg/086_search_fund_projects.sql),
   add an idempotent GIN trigram expression index on `translit_bg_latin(title)`.
2. Search and rank on `translit_bg_latin(q)` versus `translit_bg_latin(title)` so Cyrillic and
   Latin queries use the same representation and index.
3. Keep the result grain and ranking tiebreaks unchanged: one row per `contract_number`, similarity
   first, amount second, key last.
4. Add a data test proving a representative Latin query returns project rows also reachable by
   its Cyrillic spelling and that `EXPLAIN` uses the folded index.

This phase does **not** broaden fund matching to beneficiary name, programme name or contract
number. The home copy must promise project-title search only. Those fields can be a measured
follow-up with their own precision and index review.

### Phase 5 — expand the home configuration and copy

1. Update [`src/screens/home/homeSearch.ts`](../../src/screens/home/homeSearch.ts):
   - replace `people` with `public-people` and `company-people`;
   - add contracts, tenders, funds and Interreg sources;
   - apply the group order and caps in §3.4;
   - keep places as the only local index and every other group server-backed;
   - keep the sum-of-caps gate at 20.
2. In [`src/screens/HomeDashboardScreen.tsx`](../../src/screens/HomeDashboardScreen.tsx), pass the
   shared person role labeler and update the bilingual copy. Recommended Bulgarian copy:
   - placeholder: `място, човек, фирма, договор, поръчка или проект…`;
   - hint: `Места; публични лица и лица от Търговския регистър; възложители и изпълнители; договори и процедури по ЗОП; заглавия на проекти по еврофондове и заглавия/партньори по Interreg; продукти.`
3. Keep `onArm`, the lazy place catalog and the existing debounce/cancellation behavior unchanged.
4. Name the contract/tender groups precisely:
   - `Договори по ЗОП` / `Procurement contracts`;
   - `Процедури по ЗОП` / `Procurement procedures`.
   “Procurements” is the umbrella in copy, not a redundant third corpus.

## 5. Verification gates

### 5.1 Unit and component tests

Update `src/screens/home/homeSearch.test.ts` to pin:

- ten group ids in the specified order;
- bilingual non-identical labels;
- sum of caps `<= 20`;
- two people sources issue one person request;
- six procurement sources issue one procurement request;
- query changes do not reuse stale responses;
- aborted/failed shared promises are evicted and retried;
- failed sources throw and disappear from “searched in”, rather than report an absence;
- public rows prefer localized `primary_role` and show place;
- Commerce-Registry rows preserve identity caveats and V/N quota;
- contract, tender, fund and Interreg rows resolve to their direct detail routes;
- only destinations that consume `?q` receive see-all links;
- contract/tender/company see-all links use all-time procurement scope;
- product response remains a bare-array contract.

Add focused tests beside `procurementSearchSource.ts` for the full response normalization, totals,
`altQuery`, HTML entity decoding, synthetic company-key filtering and path encoding.

Update `fundSearchGroup.test.ts` and `ProcurementSearchTile.test.tsx` to expect the direct project
route and to keep projects whose beneficiary EIK is null.

### 5.2 Data and route tests

- `vassil terziev` returns one `Васил Александров Терзиев` public hit with `primary_role=mayor`;
- a representative magistrate and councillor are returned in P;
- representative V and N rows remain reachable and retain their identity confidence;
- Cyrillic/Latin fund-title probes both return rows;
- contract/tender/fund/Interreg search functions return unique keys and use their expected indexes;
- the route still degrades an absent optional migration group without blanking all other groups.

### 5.3 Browser acceptance

At `/`:

1. Before focus, no person, procurement, product or place-catalog request is sent.
2. Typing `vassil terziev` sends one request to each of the three server endpoints and shows one
   `Васил Александров Терзиев — Кмет · Столична община` result linking to his canonical page.
3. Fixture searches surface a magistrate, a councillor, a V private person and an N private person.
4. `ремонт` surfaces contract/tender/fund rows; `remont` also surfaces fund rows.
5. Clicking one representative result from every group lands on the correct detail/browser route.
6. Arrow keys traverse all visible options, Enter opens the selected route, Escape closes, sticky
   group labels remain readable, and group names are announced through `role=group`.
7. At 390 px the dropdown remains within its scroll container and does not widen the page.
8. Force one endpoint to 500 and verify the no-results sentence does not claim that its groups
   were searched.

### 5.4 Regression commands

Run at minimum:

```bash
cd functions && npm test
npx vitest run src/screens/home/homeSearch.test.ts
npx vitest run src/screens/components/procurement
npm run test:data -- scripts/db/tests/person_search.data.test.ts
npm run test:data -- scripts/db/tests/search.data.test.ts
npm run build
```

Use the repository's normal broader gates if any shared `HubSearch`, person-label or table-search
module changes beyond the boundaries above.

## 6. Rollout order

1. Land and verify the folded fund-search index/function locally.
2. Apply migration 086 to Cloud SQL through the funds loader's schema path before the UI depends on
   it. `--payloads-only` still applies the schemas and avoids a needless full 128k-shard reload;
   verify that behavior on the implementation branch before running it.
3. Apply the audited Vassil identity merge and rebuild the dependent person serving layers through
   the project skill/workflow.
4. Deploy the DB function route change.
5. Deploy the frontend/adapters.
6. Run the browser acceptance set against the deployed environment and record one real network
   trace. Only propose an aggregate endpoint if that trace shows the three-request design missing
   its latency budget.

Rollback is separable:

- the frontend can remove the new groups without reverting schema or data;
- the person route can return to whole-query fuzzy matching independently;
- the folded fund index/function is additive and can remain even if the home UI rolls back;
- identity overrides must use the person workflow's reviewed inverse/split path, never an ad-hoc
  SQL delete.

## 7. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| More groups cause duplicate network calls | Both people groups share one keyed promise; all six procurement groups share another |
| An abort poisons a query cache | Evict the exact in-flight entry on rejection/abort; preserve the rejection |
| Public results starve private people | Independent public and Commerce-Registry source caps; balanced V/N preview |
| A duplicate display row hides a real namesake | Never presentation-dedupe people; resolve the known split in the identity layer |
| Specific roles render as raw codes | Reuse `usePersonLabels().roleLabel`; broad facet only as fallback |
| A fund hit lands on a beneficiary rather than the project | Canonical direct `/funds/contract/:number` adapter |
| Latin fund query silently misses Cyrillic titles | Folded expression index and folded query predicate |
| A “see all” page cannot reproduce the preview | Offer links only where the destination reads the query and covers the same corpus |
| An endpoint outage reads as “no data exists” | Source fetchers throw; `HubSearch` excludes failed groups from its searched list |
| Common-name performance regresses | Keep per-tier `rank_static` early-stop; no global dynamic similarity sort; inspect plans |
| ISUN and Interreg amounts are conflated | Separate groups and keep `bgBudgetEur` for Interreg |

## 8. Explicit non-goals

- replacing the header search;
- adding Elasticsearch/Meilisearch or a new global-search API;
- building another client-side people/procurement index;
- adding all N-tier people to the `/persons` browser;
- searching fund beneficiary/programme/contract-number fields in this pass;
- searching procurement identifiers in addition to the existing subject/title search;
- changing `/persons` browse search from substring/token matching to typo-tolerant ranking;
- merging ISUN/EEA/Norway and Interreg into one corpus;
- changing product or place ranking;
- creating one cross-corpus relevance score;
- adding open calls, news, or full-text page content to the home finder.

## 9. Definition of done

The work is complete when the home finder can find the user's example by Latin first+family name,
labels him specifically as Sofia's mayor, does not duplicate his identity, exposes public and
private people without one starving the other, renders direct contract/tender/fund/Interreg
results, preserves the current three-request cost and lazy load, passes the unit/data/build gates,
and has a deployed browser trace confirming the grouped expansion does not require a new search
backend.
