# Home search expansion — implementation plan v1

Status: **research complete; audited 2026-09-01; implementation not started**
Scope: the finder on `/` only, plus the shared search adapters and backend correctness work
required for its results to be true and reproducible.

> **Audit note (2026-09-01).** Every figure in this document was re-measured read-only
> against the local Postgres corpus, and every code claim re-checked against the file it
> names. Four things the first draft asserted were wrong and are corrected in place — the
> identity split's SIZE (§2.6), how the §2.3 timings must be measured (§2.3), the `shared_name`
> caveat (§3.3), and the person destination rule (§2.4). The corrections are marked ⚠️ where
> a reader of the first draft would otherwise carry the old claim forward.

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
8. EU-funds projects from ISUN (+ a small EEA/Norway tail — see §2.5);
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
│                               ├──────────────── ISUN projects
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

**Verified 2026-09-01:** `/api/db/procurement-search` runs all six searches on every call —
`groupQueries(needle)` builds the six unconditionally and `Promise.allSettled` awaits them —
even when the home page renders only two. It also already pays for `contractsTotal` /
`tendersTotal` and the shliokavitsa `altQuery`. Surfacing the other four groups adds client
mapping and rows in the dropdown, **not more SQL and not another network call**.

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

### 2.3 Why `vassil terziev` fails — and how the fix must be MEASURED

The person exists in `person_search` as `Васил Александров Терзиев`, with:

- `position_type = politician`;
- `primary_role = mayor`;
- `place_label = Столична община`.

The route's fuzzy predicate compares the **whole query** against the **whole three-part name**:

```sql
name_fold %> translit_bg_latin($query)
```

`%>` is `word_similarity(query, name_fold) > threshold`, i.e. the query must match one
CONTINUOUS extent of words inside the name. Natural first+family search omits the patronymic,
so `vassil terziev` is scored against the extent `vasil aleksandrov terziev` and the
intervening patronymic sinks it below the threshold.

A token-wise probe on the current index does find him, with no new index:

```sql
name_fold %> translit_bg_latin('vassil')
AND name_fold %> translit_bg_latin('terziev')
```

⚠️ **THE TIMINGS DEPEND ON HOW THE QUERY REACHES POSTGRES, AND THE SPREAD IS 500×.** The
first draft of this plan published a table of low-millisecond figures without saying how they
were produced; re-measured three ways, same query, same corpus, warm — tier N, `ivan` +
`ivanov`, the most expensive shape in the corpus:

| how the query reaches Postgres | plan node | time | buffers |
| --- | --- | ---: | ---: |
| psql **literal** constants | `Index Scan using idx_person_search_rank` | 0.46 ms | 7 |
| `PREPARE`/`EXECUTE`, custom plan | `Bitmap Heap Scan` + Sort (27,010 rows) | **190 ms** | 11,980 |
| `PREPARE`/`EXECUTE`, generic plan | `Bitmap Heap Scan` + Sort | **465–539 ms** | 11,980 |
| **node-postgres unnamed statement — what `dbRows` actually does** | `Index Scan using idx_person_search_rank` | **0.11 ms** | **7** |

The last row is production. It is fast **only because Postgres plans an UNNAMED
extended-protocol statement at Bind time with the real parameter values**, which is what lets
it estimate `translit_bg_latin($2)`'s selectivity and choose the `rank_static` early-stop over
the trigram bitmap. That dependency is invisible in the SQL and is one connection-layer change
away from the 190–539 ms plan: a NAMED prepared statement, a client-side statement cache, or a
pooler in transaction mode would each drop it.

⚠️ **CLAUDE.md's „measure with `PREPARE`, never a psql literal" rule points the WRONG WAY
here**, and would make a correct implementation look like a blocker. Both rules are special
cases of one: **measure through the driver the route uses** —
`client.query('EXPLAIN (ANALYZE, BUFFERS) …', params)` over `pg`.

Measured that way, the new predicate is also FASTER than today's on the adversarial case —
two individually-common words that never co-occur, which is the worst case for a `rank_static`
early-stop because the scan must walk the whole tier before it can stop:

| probe (node-postgres path, tier N) | two-token (proposed) | one-token (today) |
| --- | ---: | ---: |
| `ivan` + `ivanov` | 0.11 ms / 7 buf | 0.16 ms / 7 buf |
| zero-match `ivanov` + `georgiev` | **23 ms / 613 buf** | **62 ms / 6,936 buf** |
| `dimitrov` + `petrov` | 20 ms / 1,645 buf | — |
| `vassil` + `terziev`, tier P | 2.0 ms / 260 buf | (returns nothing) |

No new index is needed: `idx_person_search_fold` is `gin (name_fold gin_trgm_ops)`, which
serves `%>`, and two ANDed probes on the SAME column are a BitmapAnd — strictly more selective
than one. All figures are LOCAL; re-measure on Cloud SQL before shipping (`db-perf-optimized-N-2`,
and this is the table family with a 4h41m incident behind it).

### 2.4 The public-money corpora and routes are already present

Local corpus sizes on 2026-09-01:

| Corpus | Rows |
| --- | ---: |
| signed procurement contracts | 410,369 |
| tender procedures | 238,304 |
| ISUN + EEA/Norway fund projects | 82,283 |
| Interreg operations | 1,958 |
| Interreg partner rows | 12,015 |

The live detail destinations already exist:

| Result | Destination |
| --- | --- |
| person, `key` starts `slug:` | route-provided `href` = `/person/:slug` |
| person, `key` starts `fold:` | `/person/:name`, `encodeURIComponent`d |
| institution | `/awarder/:eik` |
| company | `/company/:eik` |
| contract | `/procurement/contract/:key` |
| tender | `/tenders/:unp` |
| fund project | `/funds/contract/:contractNumber` |
| Interreg operation | `/funds/interreg/:keepId` |

⚠️ **THE PERSON ROW BRANCHES ON THE KEY NAMESPACE, NEVER ON THE TIER — and the existing
helper gets this wrong.** `personTo()` in
[`personSearchGroups.ts`](../../src/screens/components/procurement/personSearchGroups.ts) is
`h.tier === "P" ? h.href : '/person/' + encodeURIComponent(h.name)`. But tier and key
namespace are different questions:

| tier | key namespace | rows |
| --- | --- | ---: |
| P | `slug:` | 63,836 |
| V | **`slug:`** | **69,367** |
| V | `fold:` | 15,190 |
| N | `fold:` | 445,804 |

**82% of V rows carry a real slug and a real `/person/<slug>` href that the client throws
away.** `load_person_search_pg.ts`'s V-real arm exists for exactly the opposite reason — its
own comment: „they belong in the money (V) tier by their REAL slug … Without this they would
fall through to the tr_officers arm and route by `/person/<name>` with a `name_fold` badge
despite being verified." The shared adapter must branch on `key.startsWith("slug:")`, and the
existing helper must be fixed in the same pass (§4 Phase 3) or `/procurement` keeps the defect
while the home gets the fix.

Contract keys are URL-safe — **0 of 410,369 contain a character outside `[A-Za-z0-9_-]`** — so
Phase 3's blanket `encodeURIComponent` on path segments is defensive rather than load-bearing,
which is the right way round.

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

⚠️ **„ISUN + EEA/Norway" attributes 82,283 rows to a label whose second half is 0.32%.**
Measured by `program_code`: `BGCULTURE` 55, `BGLD` 64, `BGENERGY` 64, `BGENVIRONMENT` 34,
`BGHOMEAFFAIRS` 22, `BGJUSTICE` 17, `DF` 7 — **263 rows**. (`BNSF` 116 and `DEP` 65 are
neither an ИСУН OP nor EEA/Norway.) Keep the group label „Еврофондове (ИСУН)" exactly as it is
today, and attribute the 82,283 to the corpus rather than to the pair.

### 2.6 ⚠️ The Vassil duplicate is a CLASS of 4,766 rows, not an instance

The first draft called this „a person-identity split, not a search-result presentation
problem" — correct — and then proposed a single override, which is not. Measured 2026-09-01:

```
person_id 58448  official_muni  vasil-aleksandrov-terziev-049f64  mayor  SFO_CITY
person_id 58449  local          2023_10_29_mi:SOF:mayor           mayor  SFO_CITY
```

| measure | count |
| --- | ---: |
| name folds holding an `official_muni` AND a `local` role — the population | 5,244 |
| …of those, name folds those two sources DO union correctly | 4,033 |
| …of those, name folds SPLIT across the two sources | **1,211** |
| (fold, role, place_code) TRIPLES naming two person rows | **1,127** — on **1,101** distinct folds |
| `person_search` P rows inside a same-(fold, place_label, primary_role) duplicate cluster | **4,766 of 63,836 (7.5%)** |

⚠️ **1,127 and 1,101 are two different things and the first draft used one number for both.**
1,127 counts TRIPLES — a person split across two offices contributes two — while 1,101 is the
number of split FOLDS at least one of those triples falls on. The coverage figure is
**1,101 of 1,211 (90.9%)**; 1,127 is what the ratchet's second ceiling counts.

⚠️ **The 1,211 is the CONSERVATIVE reading, by 2 rows.** The predicate is „>1 person on the
fold AND both sources present somewhere on it", which also admits a fold holding two genuinely
different humans who each merged their own pair correctly. Measured: the strict „no person
holds both sources" count is **1,209**, so 2 of the 1,211 (0.17%) are not splits. The looser
predicate is the right direction for a ratchet and the ceiling is left at 1,211; the sentence
„one human published as two pages" is exactly true of 1,209 of them.

**To re-derive any figure here**, run the queries in
`scripts/db/tests/person_identity_duplicates.data.test.ts` — each `scalar()` call is the whole
derivation, and every number above is one of them. Cloud SQL takes the same queries through
the proxy (`npm run db:proxy:cloud`, then `127.0.0.1:5434`).

Samples are unambiguous — same fold, same role, same `place_code`, two person_ids:

```
adrian miroslavov marinov      local/councillor/VID37#106 | official_muni/councillor/VID37#110
albena cherkezova kostadinova  local/councillor/PDV42#531 | official_muni/councillor/PDV42#487
albina alekseeva aneva tomova  local/councillor/BLG03#617 | official_muni/councillor/BLG03#616
```

Three things follow:

- **Something already unions these two sources and misses ~23% of the time** (4,033 vs 1,211).
  That is a tier bug with a strong, cheap signature — the (fold, role, place_code) triple —
  not 1,211 independent adjudications. `person_link_override` is explicitly the escape hatch
  for what the deterministic tiers get WRONG; it is not a substitute for a tier.
  **Diagnosed 2026-09-02 — see §2.7 for which tier and why.**
- **It is not a home-search defect.** `/persons?q=vasil terziev` already returns both rows
  (`person_browse_table` carries both slugs), because `persons.name` carries
  `searchFoldTokens: true`. The home finder makes it more visible, nothing more.
- **A client-side „same name, same role" dedupe still must not be used.** Two real people can
  share those display fields. The identity layer is the only authority licensed to merge them.

⚠️ **Verified on Cloud SQL 2026-09-02, and the warning was the right one.** Every figure in
the table above is **byte-identical on both databases** (1,211 / 1,127 / 4,033 / 4,766 of
63,836), so the split is deterministic and not a local artifact — but the SLUGS are not.
Local publishes him as `vasil-aleksandrov-terziev-049f64` + `…-049f64-2`; **Cloud SQL
publishes `vasil-aleksandrov-terziev-049f64` + `vasil-terziev-44st9w`**. A ref override
naming the local slug would therefore have been correct locally and wrong on prod. (The refs
themselves — `official_muni:vasil-aleksandrov-terziev-049f64` and
`local:2023_10_29_mi:SOF:mayor` — DO match on both, so a ref-keyed override is portable where
a slug-keyed one is not. That is not luck: `person_link_override` keys on refs precisely
because `person_id` and slugs are per-database.)

### 2.7 WHICH tier misses, and why it is a resolver fix rather than 1,211 adjudications

Diagnosed 2026-09-02. `resolve_persons.ts` unions two mentions of one name only when a tier
licenses it, and for the `official_muni` ↔ `local` pair the available licences are:

| licence | applies here? |
| --- | --- |
| Tier 0 — gold key | **never.** Neither source carries one (`hardId` is the parliament mp id) |
| Tier 1 `shareUic` / `birthDate` | **never.** Neither source carries a company EIK or a birth date |
| Tier 1 `weakBoth` — party AND place both present and equal | rarely: a local officeholder often has no party at all (an инициативен комитет carries `primaryCanonicalId: null`) |
| Tier 1 `samePartyOffice` — a NATIONAL party office | a handful: it needs the Сметна палата `party_leader` category, which almost no municipal officeholder holds. This is the most likely explanation for the 6 merged folds that are NOT Tier-2a eligible |
| Tier 1 `sameLocalSeat` | **never.** `official_muni` carries no `localSeat` corroborant — `resolve_persons.ts` sets it only when `r.source === "local"` — so `seatTerm()` returns null and the rule cannot fire across the two sources at all |
| Tier 2a — same unique full name (`namesake_risk <= 1`) | yes, and in practice this is the only one |
| Tier 2b — register-anchored | **never.** Its condition 3 refuses a `local`-only component by design, because a council roll implies no filing |

Measured over the whole corpus, and it is decisive:

| folds spanning both sources | count | of which `namesake_risk <= 1` |
| --- | ---: | ---: |
| **MERGE** | 4,033 | **4,027 (99.9%)** |
| **SPLIT** | 1,211 | **21 (1.7%)** |

Party is not the discriminator (a partyless local mention appears in 23.5% of merged folds
and 33.4% of split ones). `namesake_risk` is.

⚠️⚠️ **AND `namesake_risk` DOES NOT COUNT PEOPLE.** It is
`officer_name_counts.company_count` — how many COMPANIES an officer of that name appears on —
and `cluster.ts`'s own Tier 2a comment already says so: „it refuses a man for sitting on two
boards". So the rule that decides whether a mayor is one person or two is a count of
Commerce-Registry rows, and **a mayor who sits on two boards is split from their own
officials record**. That is precisely why Васил Александров Терзиев — a businessman — is
published twice as mayor of Столична община, and why the split population is 1,211 rather
than a handful.

**The shape of the fix, for whoever takes it.** 1,101 of the 1,211 split folds (90.9%) carry
an IDENTICAL (fold, role, place_code) triple across the two sources — one name, one office,
one place. That is the same exclusivity argument `sameLocalSeat` already rests on („a село
has ONE кмет"), applied across the two SOURCES instead of across two CYCLES. It is a resolver
tier, it belongs in `scripts/person/` with its own gate, and it is a larger piece of work than
this plan.

**Decision (Phase 2a, 2026-09-02): scope it OUT, ratchet it, and let the home expansion ship
beside it.** The evidence says the class is homogeneous — one missing licence, one signature,
90.9% coverage — so 1,211 hand-audited overrides would be the wrong instrument for it, and
Phase 2b's precondition („only if 2a says the class is genuinely heterogeneous") is not met.
Phase 2b is therefore NOT performed. What ships instead is
`scripts/db/tests/person_identity_duplicates.data.test.ts`: a ceiling on all three numbers
that may fall and never rise, non-vacuity assertions so an unresolved corpus cannot read as a
fix, the merged-vs-split diagnosis pinned as its own assertion so a future tier change fails
loudly rather than silently invalidating this section, and a source gate on `cluster.ts` so
`namesake_risk` changing meaning is caught rather than assumed.

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

### 3.3 Show the specific office, and ADD the identity caveat that is missing

For public people, render:

```text
<localized primary_role> · <place_label>
```

and fall back to the broad `position_type` only if `primary_role` has no label. Vassil Terziev
must read as `Кмет · Столична община`, not merely `Политик · Столична община`.

Reuse `usePersonLabels().roleLabel` / the `pp_role_*` and `tr_role_*` vocabulary. Do not create a
third mayor/councillor/magistrate label map inside home search. **Verified 2026-09-01: all 56
distinct `person_search.primary_role` codes have a `pp_role_*` key in
`src/locales/{bg,en}/translation.json` — the CORE corpus, not a deferred bundle** — so this
cannot leak a raw code on a page whose bundle has not loaded. `usePersonLabels` is memoized on
`t`, so passing `roleLabel` into `homeSearchSources` does not churn the `useMemo`.

⚠️ **The first draft said `shared_name` „must retain its stronger several-people warning".
There is no such warning to retain.** `firmsText()` in `personSearchGroups.ts` branches on
`identity_confidence === "name_fold"` and nothing else:

| tier | identity_confidence | rows | caveat shown today |
| --- | --- | ---: | --- |
| V | `verified` | 64,991 | none |
| V | `name_fold` | 15,190 | „съвпадение по име" |
| V | `shared_name` | **4,376** | **none** |
| N | `name_fold` | 445,804 | „съвпадение по име" |

`shared_name` is „the same money-linked private owner on a fold the registry positively says is
≥2 people" (081). `/person` and `/persons` both render a stronger warning for it
(`isSharedNameIdentity`, `pp_identity_shared_name`); the search dropdown does not. **ADD it**,
reusing that predicate and that copy rather than minting a fourth vocabulary — the same
argument this section already makes for `roleLabel`. Show `public_money_eur` only for V.

### 3.4 Keep a hard 20-row dropdown budget — and order by INTENT

The proposed order and caps are:

| Order | Group id | Cap | “See all” |
| ---: | --- | ---: | --- |
| 1 | `places` | 3 | none |
| 2 | `public-people` | 3 | none in v1; `/persons` does not reproduce this endpoint's typo tolerance |
| 3 | `products` | 2 | ⚠️ **none — removed after measurement, see below** |
| 4 | `awarders` | 2 | none; no awarder browser reads `?q` |
| 5 | `companies` | 2 | `/procurement/contractors?q=…&pscope=all` |
| 6 | `contracts` | 2 | `/procurement/contracts?q=…&pscope=all` |
| 7 | `tenders` | 2 | `/procurement/tenders?q=…&pscope=all` |
| 8 | `company-people` | 2 | none |
| 9 | `funds` | 1 | none; no fund-project browser reads `?q` |
| 10 | `interreg` | 1 | none |
| | **Total** | **20** | |

⚠️ **Products is THIRD, not tenth, and the ordering axis is reader intent rather than corpus
taxonomy.** Today products is 5th of 5 — roughly row 15. A naive taxonomy order puts it 10th of
10, behind 9 sticky headers and 18 rows, inside a `max-h-96` (384 px) scroll box holding
~1,100 px of content, i.e. effectively invisible. „кисело мляко" is a first-class home query
and the consumption hub is the newest thing the home is trying to surface.

The mitigation that does the real work is that **empty groups collapse** — `toGroup` returns
`[]` at zero rows — so the 10-deep worst case only occurs on a broad word („ремонт", „София").
Say that in the copy review rather than relying on the cap alone.

`HubSearch` already scroll-bounds the dropdown at `max-h-96`; the cap limits keyboard traversal
and keeps a broad query from turning the global finder into a browser.

**Four rules on “see all”, and three of them are new:**

- **`altQuery`, on EVERY see-all that has one.** The response's `altQuery` is the needle the
  rows actually came from. `/procurement/contractors` runs its own `DbDataTable` search too.
  ⚠️ Its `searchFold` arm carries a `shlyo_query_fold` rewrite that is NOT the route's
  `shlyoAlt` — there are three different shliokavitsa triggers in this repo — so „the
  destination has a rewrite" is not „the destination has THIS rewrite".

  ⚠️ **AND THAT ARGUMENT KILLED THE PRODUCTS SEE-ALL, which this section originally required
  it for.** `/api/db/price-search` matches through `shlyoCandidates` (which covers the
  phonetic i-glide spellings) while `/consumption/products` matches through
  `shlyo_query_fold` (which does not) — the divergence CLAUDE.md already records by name.
  Measured 2026-09-02: „mliako", „biala", „rakiia" and „iogurt" each preview **20 real
  products** and the destination returns **0** — four of nine probe terms, so a class rather
  than an instance. And there is no `altQuery` to carry: that route returns a bare array and
  supplies no rewrite. The link is therefore REMOVED, as a seventh documented refusal.
  Restoring it means giving `price-search` the needle it matched on — the `procurement-search`
  shape — as a field BESIDE the array, never an envelope, since two consumers depend on the
  bare-array contract.
- **`pscope=all` on the three procurement links**, as the existing procurement tile does: the
  browse tables default to the selected parliament's window.
- ⚠️ **Suppress every see-all below `SEARCH_MIN_CHARS` (3).** `HubSearch` opens at
  `MIN_QUERY = 2`, and every see-all destination is a `DbDataTable` at
  `searchMinChars = SEARCH_MIN_CHARS = 3`, which renders „въведете поне 3 знака" instead of
  results while the server REFUSES the term with a 400. So a two-character query shows a
  preview with rows and four links to a page that cannot run it. Count with `termLength`, not
  `.length` — the engine counts characters, not UTF-16 code units.
- **The public-people see-all is REMOVED in this pass, and the reason is narrower than it
  looks.** `/persons` already ANDs name tokens (`persons.name` carries
  `searchFoldTokens: true`, shipped by
  [`person-search-token-match-v1.md`](./person-search-token-match-v1.md)), so `vasil terziev`
  DOES reproduce there. What does not reproduce is the TYPO — `vassil`, a doubled letter no
  shliokavitsa rewrite touches — because `/persons` is substring matching and `person-search`
  is trigram. Never add a see-all destination merely because a route exists; the destination
  must reproduce the query SEMANTICS and represent the same corpus.

⚠️ **A see-all row is not reachable by arrow key, and that is pre-existing.**
`EntitySearchTile` renders it inside `role="group"` but not as `role="option"` and not in its
`flat` array, so arrow keys skip it and a non-`option` interactive child violates the
`listbox`/`group` content model. §5.3's „arrow keys traverse all visible options" will
therefore PASS while four links stay unreachable. Name the exclusion in the acceptance list or
fix it; do not let the criterion imply coverage it does not have.

### 3.5 Keep ISUN and Interreg separate

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
   - keep words at `SEARCH_MIN_CHARS` or longer (`termLength`, not `.length`);
   - stop at `MAX_SEARCH_WORDS`;
   - return the existing single-query path when fewer than two words qualify.
   ⚠️ That helper is shared with `persons.name`'s `searchFoldTokens` arm, so a regression here
   breaks `/persons`, not the home. `functions/db_table.test.js` must stay green.
2. In the `person-search` handler in
   [`functions/db_routes.js`](../../functions/db_routes.js), retain the whole-fold `exactQ` and
   replace only the multi-word fuzzy predicate with one `%>` predicate per qualifying word,
   ANDed against the same `name_fold`.
3. Keep `ORDER BY rank_static DESC LIMIT …` byte-visible in the route. Do not add a dynamic
   similarity sort over the full match set; the existing comments record a 231 ms regression
   for common names when early-stop ranking was lost. ⚠️ **Record in the route's comment that
   the plan shape depends on BIND-TIME planning of an unnamed statement** (§2.3) — a named
   prepared statement or a transaction-mode pooler moves this to 190–539 ms.
4. Apply the same helper to an alternate shliokavitsa needle because `tierRows` must have one
   matching contract regardless of which needle produced it.
5. Preserve the `decl=1|0` predicates and missing-migration degradation.

Tests:

- extend `functions/db_routes.person_search.test.js` for two-token SQL/params, word dedupe, word
  cap, single-word fallback, `decl`, and alternate-query paths;
- extend `scripts/db/tests/person_search.data.test.ts` so `vassil terziev`, `vasil terziev` and
  `васил терзиев` return the mayor row;
- retain the route-source gate for `ORDER BY rank_static`;
- ⚠️ the `EXPLAIN` gate must run through `pg` with **bound parameters**
  (`client.query('EXPLAIN (ANALYZE, BUFFERS) …', params)`), never `PREPARE`/`EXECUTE` and never
  literals. Fail on a sequential scan and on a buffer ceiling for the representative multi-word
  probes, including the zero-match conjunction from §2.3. Do not make wall-clock milliseconds a
  CI assertion.

### Phase 2 — repair the identity split as a CLASS, then as an instance

**2a — measure and decide (blocking). ✅ DONE 2026-09-02.**

1. ✅ Re-ran §2.6's measurements against **Cloud SQL** as well as local: byte-identical on both,
   so the split is deterministic. The slugs are NOT — see §2.6.
2. ✅ Diagnosed: only Tier 2a can license this pair in practice, and it gates on
   `namesake_risk`, a COMPANY count. §2.7 has the tier table and the 99.9%-vs-1.7% measurement.
3. ✅ Decided, in writing (§2.7): **a resolver tier, scoped OUT of this plan.** The class is
   homogeneous — 1,101 of 1,211 share one signature — so overrides are the wrong instrument,
   and §9 says plainly that identity duplication is not a done-criterion of this work.
4. ✅ Ratchet shipped: `scripts/db/tests/person_identity_duplicates.data.test.ts` — ceilings on
   split folds (1,211), exact-signature triples (1,127) and duplicate `person_search` P rows
   (4,766), **each PAIRED WITH A FLOOR on its own denominator** (5,244 cross-source folds,
   31,966 scoped role rows, 63,836 tier-P rows, at a 0.95 band). The pairing is the design:
   measured on the gate's own first cut, a coarser fold takes the split count to 481 and losing
   half the local roles takes it to 658 — both under the ceiling, both green, and the header
   then tells the operator to re-cut and lock the regression in. Over-merging in the resolver,
   the defamation-critical direction, has the same signature. Plus the diagnosis pinned as its
   own two-sided test, a code-not-prose source pin (`stripComments`, because
   `namesakeRisk <= 1` appears four times in `cluster.ts` and only once as the rule — deleting
   that line left a naive pin green), and a self-check that the pin still rejects the mutation
   it exists for.

**2b — the instance. NOT PERFORMED, and that is the decision rather than an omission.**

Its precondition was „only if 2a says the class is genuinely heterogeneous". 2a says the
opposite. Running it anyway would spend a full `db:resolve:persons` + the whole dependent
person chain (~18 min on Cloud SQL, with `/persons`, `/officials/assets`, `/mp-assets` and
`/declarations/crypto` at 500 for ~5 minutes of it) to fix 2 rows of 4,766, and would leave an
override row that a later resolver tier then has to be reconciled against.

Should a future operator decide to do it anyway, the two refs are portable across both
databases (the slugs are not):

- `official_muni:vasil-aleksandrov-terziev-049f64`
- `local:2023_10_29_mi:SOF:mayor`

via `npm run person:override -- merge --ref <a> --ref-b <b> --note … --by …`, then the person
chain, then re-cut the ceilings in the ratchet gate.

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
- ⚠️ **a person-to-route helper that branches on `key.startsWith("slug:")`, not on `tier`** —
  §2.4. Fix `personTo()` in `personSearchGroups.ts` in the same pass, and pin a `slug:`-keyed V
  row to its `href` in a unit test;
- ⚠️ **the `shared_name` caveat** (§3.3), reusing `isSharedNameIdentity` and
  `pp_identity_shared_name`;
- the role subtitle and `altQuery` handling.

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
- ⚠️ **query-keyed `altQuery` / `contractsTotal` / `tendersTotal` metadata.** `seeAll` is a
  SYNCHRONOUS render-time callback (`toGroup` calls `src.seeAll?.(query)`), so it cannot await
  the shared promise — the values must come from a map keyed by the exact needle, written when
  the fetch resolves. The single-slot mutable `lastPersonAlt` in `homeSearch.ts` today is
  exactly the shape that does not survive six sources sharing one promise; replace it.
- URI encoding for every path parameter;
- `decodeEntities` on every externally sourced display string;
- `isLinkableCompanyKey` for contractor destinations **only**. ⚠️ Awarder ids go through
  `isValidEik` (9–13 digits); two live awarders — ЕСО `1752013040`, АДФИ `175076479999` — sit
  outside 9/13 and resolve, so routing an awarder through the contractor predicate de-links a
  working page.

Refactor `FundsFinder` and `ProcurementSearchTile` to reuse these row mappers or pure item builders
so the home, procurement and funds surfaces cannot disagree about destinations or money fields.
Keep the procurement tile's project-file footer as a tile-only concern.

Update `fundSearchGroup.ts` so every valid `contractNumber` links directly to
`/funds/contract/:number`; a missing beneficiary EIK must no longer hide a real project.

### Phase 4 — make fund titles bilingual, the way Interreg already does it

⚠️ **Do NOT replace the predicate. ADD a folded arm beside the raw one.** The first draft said
„keep the result grain and ranking tiebreaks unchanged" while replacing `q <% f.title` with a
folded comparison — which changes the SIMILARITY VALUES for every existing Cyrillic query
(`ж` → `zh` changes the trigram set) against a function that pins
`pg_trgm.word_similarity_threshold = 0.5`. Both the ranking and the membership of today's
results would move, silently.

The repo already contains the right shape one migration over.
`search_interreg_operations` (138) UNIONs a raw arm and a folded arm and carries an explicit
`arm` rank column so an exact hit outranks a folded one at equal similarity — with a comment
recording the exact regression that motivated it („Благоевград": three Latin-named partners tied
at 1.000 and displaced `Община Благоевград` from a 6-row preview). Copy that.

1. ✅ In
   [`scripts/db/schema/pg/086_search_fund_projects.sql`](../../scripts/db/schema/pg/086_search_fund_projects.sql),
   an idempotent GIN trigram **expression** index on `translit_bg_latin(title)` — the same
   shape as `idx_interreg_partners_name_fold_trgm` (137).
2. ✅ The body is `hits` = raw arm (`q <% f.title`, `arm = 0`) `UNION ALL` folded arm
   (`translit_bg_latin(q) <% translit_bg_latin(f.title)`, `arm = 1`), then
   `DISTINCT ON (contract_number)` keeping the strongest arm.
3. ✅ Ordered `sim DESC, arm, total_eur DESC NULLS LAST, contract_number`.
   `idx_fund_projects_title` stays — it is the raw arm's index.
4. ✅⚠️ **NEW, AND IT IS THE DIFFERENCE BETWEEN A FIX AND A REGRESSION: the folded arm is
   GATED on the query carrying no Cyrillic.** Measured on the full corpus after building it
   ungated: for „ремонт" the raw arm returns 701 candidates **at the 0.5 threshold the
   function pins** (689 at pg_trgm's 0.6 default — always quote the threshold with a candidate
   count here), the folded arm returns 701, and the folded arm contributes **zero** rows the
   raw arm did not — 82,236 of 82,283 titles are Cyrillic, so folding both sides of a Cyrillic
   query re-derives the same matches. It is not free: the gin index is lossy for `<%`, so every
   candidate is rechecked by evaluating `translit_bg_latin(title)` again, and „енергийна
   ефективност" went **124 ms → 384 ms**.

   ⚠️ **And the gate is a CORRECTNESS property, not only a cost one** — on „оса" an ungated
   fold changes **5 of the 6 rows** returned. The „a Cyrillic result set is unchanged" claim is
   true only because the folded arm does not run for a Cyrillic query.

   The 47 Latin-only titles are English project names („OddStorm Parsers", „Maritsa PV+BESS"),
   and **zero** of them are reachable from any of nine common Bulgarian query words through the
   fold — so the gate loses nothing real. Latin works: `remont` 0 → 6 rows, `obuchenie` 0 → 6,
   `energiina efektivnost` 0 → 6.

   ⚠️ **RESULT is byte-identical; COST is not, and an earlier draft of this line claimed
   both.** Measured through the function in max shared buffers (the portable signal — wall
   clock hides it locally at 120 ms → 145 ms, because everything is in `shared_buffers`):
   „енергийна ефективност" 1,268 → 2,424, „обучение" 509 → 2,142, „училище" 493 → 1,444,
   „ремонт" 431 → 1,300. That is ~2-3×, in absolute terms well inside the ~2,000-per-view
   budget, and an order of magnitude below the **22,624** it cost before the `LIMIT` was pushed
   in front of the join-back — with it below the join, `best` handed all 5,053 candidates to a
   PK lookup and 5,047 were then discarded.
5. ✅ Gate: `scripts/db/tests/fund_search_fold.data.test.ts` (6 tests). It does NOT compare
   against a snapshot (which would rot with the corpus) — it asserts the INVARIANT that a
   Cyrillic query returns exactly what the raw arm alone returns, in the raw arm's order, over
   eight probes; that a Latin probe returns rows **and** that the raw arm alone returns none
   for it, so the assertion cannot pass on a coincidence; a buffer ceiling; that the folded arm
   rides its expression index and is `never executed` for a Cyrillic query; and that the
   REINDEX obligation is written down.

   ⚠️ **Three things about it were wrong in the first cut and are worth carrying forward.**
   Its „raw arm alone" baseline ran at pg_trgm's 0.6 DEFAULT while the function pins 0.5, so it
   was comparing against a different predicate and passed by accident (at `lim = 60` the two
   disagree outright). Its plan assertions ran against an INLINED COPY of the function body, so
   replacing the gate with `WHERE true` in the migration left all five tests green — the one
   test whose whole subject is the gate was asserting against its own restatement of it; it now
   reads the body out of `pg_get_functiondef`. And its structural assertions were file greps,
   which pass on a database where a different body was applied by hand. Mutation-verified:
   removing the gate, dropping the arm rank from either ORDER BY, and moving the threshold to
   0.6 each fail it now.

Four operational facts, three of which the first draft hedged on or omitted:

- **Why an expression index and not a STORED `title_fold`** like `contracts.title_fold` /
  `tenders.subject_fold`: a STORED generated column REWRITES the heap into a new relfilenode
  whose visibility map is EMPTY (the `price_products.title_fold` incident — `ANALYZE` alone is
  the disguise; the fix is `VACUUM (ANALYZE, PARALLEL 0)`). A reviewer will otherwise ask why
  this breaks the sibling pattern.
- ⚠️ **The REINDEX obligation is recorded in 086's own header**, and the gate asserts both that
  it is there and that 176 still does not handle it (so the obligation moves the day it does).
  `176_translit_homoglyph_refold` recomputes STORED generated folds and the loader-written
  `tender_search_text.fold`; it touches NO expression index, and Postgres does not reindex on
  an IMMUTABLE function-body change. Three such indexes existed (`idx_official_roster_fold`,
  `idx_mp_roster_fold`, `idx_interreg_partners_name_fold_trgm`); this is the fourth.
- **`--payloads-only` DOES apply the schema files** — settled 2026-09-01, no longer a caveat.
  `loadFundsPg` runs all six `exec(readFileSync(...))` calls — 015, 016, 043, 086, 005
    and 189 — before the
  `payloadsOnly ? [] : …` branch. Drop the „verify that behavior on the implementation branch"
  hedge.
- **`exec()` sends a migration as ONE transaction, so the index cannot be `CONCURRENTLY`.** It
  is a ShareLock over 82,283 rows — seconds — but say so, because this file is applied on the
  Cloud SQL publish path.

This phase does **not** broaden fund matching to beneficiary name, programme name or contract
number. The home copy must promise project-title search only. Those fields can be a measured
follow-up with their own precision and index review.

### Phase 5 — expand the home configuration and copy

1. Update [`src/screens/home/homeSearch.ts`](../../src/screens/home/homeSearch.ts):
   - replace `people` with `public-people` and `company-people`;
   - add contracts, tenders, funds and Interreg sources;
   - apply the group order and caps in §3.4 (products third);
   - suppress every see-all below `SEARCH_MIN_CHARS`;
   - keep places as the only local index and every other group server-backed;
   - keep the sum-of-caps gate at 20;
   - **fix the file header**, which still says „five groups, four requests" while its own body
     says three.
2. In [`src/screens/HomeDashboardScreen.tsx`](../../src/screens/HomeDashboardScreen.tsx), pass the
   shared person role labeler (`usePersonLabels().roleLabel`, memoized on `t`) and update the
   bilingual copy. Recommended Bulgarian copy:
   - placeholder: `място, човек, фирма, договор, поръчка или проект…`;
   - hint: `Места; публични лица и лица от Търговския регистър; възложители и изпълнители; договори и процедури по ЗОП; заглавия на проекти по еврофондове и заглавия/партньори по Interreg; продукти.`
3. Keep `onArm`, the lazy place catalog and the existing debounce/cancellation behavior unchanged.
4. Name the contract/tender groups precisely:
   - `Договори по ЗОП` / `Procurement contracts`;
   - `Процедури по ЗОП` / `Procurement procedures`.
   “Procurements” is the umbrella in copy, not a redundant third corpus.
5. ✅ **The „searched in" sentence is capped.** Measured at ten groups it ran **178
   characters** — „Няма съвпадения в: места, публични лица, продукти, институции, фирми,
   договори по ЗОП, процедури по ЗОП, търговски регистър, проекти по еврофондове,
   трансгранични проекти (interreg)" — reciting the whole taxonomy, which is the opposite of
   the reassurance it exists to give. `HubSearch` now names the first four and counts the rest
   („…и още 6"), which is **69 characters**; sources are declared in reader-intent order, so
   „the first four" is that order's own answer rather than an arbitrary slice. A box with five
   or fewer groups is unchanged, so no existing hub's sentence moves. Gated in
   `HubSearch.test.tsx`.

## 5. Verification gates

### 5.1 Unit and component tests

Update `src/screens/home/homeSearch.test.ts` to pin:

- ten group ids in the specified order (products third);
- bilingual non-identical labels;
- sum of caps `<= 20`;
- two people sources issue one person request;
- six procurement sources issue one procurement request;
- query changes do not reuse stale responses;
- aborted/failed shared promises are evicted and retried;
- failed sources throw and disappear from “searched in”, rather than report an absence;
- public rows prefer localized `primary_role` and show place;
- Commerce-Registry rows preserve the `name_fold` caveat, **carry the new `shared_name`
  caveat**, and honour the V/N quota;
- **a `slug:`-keyed V row links to its `href`, a `fold:`-keyed row to the encoded name**;
- contract, tender, fund and Interreg rows resolve to their direct detail routes;
- only destinations that consume `?q` receive see-all links;
- **no see-all is emitted below `SEARCH_MIN_CHARS`**;
- **every see-all carries `altQuery` when the response supplied one** — companies and products
  included;
- contract/tender/company see-all links use all-time procurement scope;
- product response remains a bare-array contract.

Add focused tests beside `procurementSearchSource.ts` for the full response normalization, totals,
`altQuery`, HTML entity decoding, synthetic company-key filtering and path encoding.

Update `fundSearchGroup.test.ts` and `ProcurementSearchTile.test.tsx` to expect the direct project
route and to keep projects whose beneficiary EIK is null.

### 5.2 Data and route tests

- `vassil terziev` returns one `Васил Александров Терзиев` public hit with `primary_role=mayor`
  (conditional on Phase 2's outcome — see §2.6);
- a representative magistrate and councillor are returned in P;
- representative V and N rows remain reachable and retain their identity confidence;
- **Cyrillic fund-title hit SET is unchanged after Phase 4, and the Latin probe returns rows**;
- contract/tender/fund/Interreg search functions return unique keys and use their expected indexes;
- **the person-search `EXPLAIN` gate runs through `pg` with bound parameters** (§2.3) and asserts
  no sequential scan plus a buffer ceiling, including the zero-match conjunction;
- **the duplicate-identity ratchet** from Phase 2a;
- the route still degrades an absent optional migration group without blanking all other groups.

### 5.3 Browser acceptance

At `/`:

1. Before focus, no person, procurement, product or place-catalog request is sent.
2. Typing `vassil terziev` sends one request to each of the three server endpoints and shows one
   `Васил Александров Терзиев — Кмет · Столична община` result linking to his canonical page.
3. Fixture searches surface a magistrate, a councillor, a V private person and an N private person.
4. `ремонт` surfaces contract/tender/fund rows; `remont` also surfaces fund rows.
5. Clicking one representative result from every group lands on the correct detail/browser route.
6. Arrow keys traverse all `role="option"` rows, Enter opens the selected route, Escape closes,
   sticky group labels remain readable, and group names are announced through `role=group`.
   ⚠️ **See-all links are deliberately NOT options and are reachable by Tab only** (§3.4) — this
   criterion does not cover them.
7. At 390 px the dropdown remains within its scroll container and does not widen the page; a
   broad query („София") is checked for scroll depth against the §3.4 ordering.
8. A two-character query shows no see-all links.
9. Force one endpoint to 500 and verify the no-results sentence does not claim that its groups
   were searched.

### 5.4 Regression commands

⚠️ **`npm run test:data -- <file>` DOES NOT SCOPE TO A FILE.** `test:data` is
`vitest run scripts/db/tests`, so the extra argument adds a SECOND filter rather than narrowing
the first and the whole suite runs — the one this repo records as flaky under load and as
capable of a silent worker OOM. Use `npx vitest run <path>`.

```bash
npm run lint
npm run functions:test
npx vitest run src/screens/home/homeSearch.test.ts
npx vitest run src/screens/components/procurement src/screens/components/search
npx vitest run src/entryGraph.test.ts
npx vitest run scripts/db/tests/person_search.data.test.ts
npx vitest run scripts/db/tests/search.data.test.ts
npm run build
```

`src/entryGraph.test.ts` is in the list because Phase 3 adds imports to a module the `/` route
pulls; that gate exists because one constant taken from a registry put ~265 KB of source into the
entry chunk. If the home bundle moves at all, re-check `tests/perf.spec.ts`'s byte budgets or state
that it did not.

Use the repository's normal broader gates if any shared `HubSearch`, person-label or table-search
module changes beyond the boundaries above.

## 6. Rollout order

1. Land and verify the folded fund-search arm/index locally (Phase 4).
2. Apply migration 086 to Cloud SQL through the funds loader's schema path —
   `npm run db:load:funds:pg:cloud -- --payloads-only` applies the schemas and skips the ~128k
   shard reload (verified 2026-09-01). Off-peak: the index build is a ShareLock over 82,283 rows
   inside `exec()`'s single transaction, so it cannot be `CONCURRENTLY`.
3. Complete Phase 2a and apply whatever it decides, rebuilding the dependent person serving layers
   through the project skill/workflow.
4. Deploy, in this order:

```bash
npm run deploy                    # 1. hosting live with the new bundle
npm run deploy:db                 # 2. route change; fresh instances fetch the CURRENT shell
SKIP_PREDEPLOY=1 npm run deploy   # 3. purge the edge entries step 2 could not
```

⚠️ **Hosting LEADS, and the third step is not optional.** The first draft shipped `deploy:db`
before `deploy`. Nothing here adds a NEW `/api/db` route — Phase 1 edits an existing handler and
Phase 4 edits a Postgres function — so the function-first exception does not apply. Function-first
would leave a warm `db` instance serving the PRE-deploy SPA shell for up to `SPA_SHELL_TTL_MS`,
and `/person/**`'s `s-maxage=3600` pins that stale HTML at the edge, advertising a deleted
`/assets/index-<hash>.js` — a white screen `main.tsx`'s stale-chunk recovery cannot reach.
Verify with the two-`curl` hash check:

```bash
curl -s https://electionsbg.com/person/mp-3643 | grep -oE '/assets/index-[^"]+\.js'
curl -s https://electionsbg.com/ | grep -oE '/assets/index-[^"]+\.js'
```

5. Run the browser acceptance set against the deployed environment and record one real network
   trace. Only propose an aggregate endpoint if that trace shows the three-request design missing
   its latency budget.

Rollback is separable:

- the frontend can remove the new groups without reverting schema or data;
- the person route can return to whole-query fuzzy matching independently;
- the folded fund arm/index is additive and can remain even if the home UI rolls back;
- identity overrides must use the person workflow's reviewed inverse/split path, never an ad-hoc
  SQL delete.

## 7. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| More groups cause duplicate network calls | Both people groups share one keyed promise; all six procurement groups share another |
| An abort poisons a query cache | Evict the exact in-flight entry on rejection/abort; preserve the rejection |
| Public results starve private people | Independent public and Commerce-Registry source caps; balanced V/N preview |
| A duplicate display row hides a real namesake | Never presentation-dedupe people; resolve the split in the identity layer |
| **The identity split is treated as one person when it is 4,766 rows** | Phase 2a measures the class and ratchets it before 2b touches an instance |
| **The person-search plan silently degrades 500×** | It rests on Bind-time planning of an UNNAMED statement; the route comments it and the gate measures through `pg` with bound parameters |
| Specific roles render as raw codes | Reuse `usePersonLabels().roleLabel`; all 56 codes verified present in the CORE locale corpus |
| **A verified private owner loses their canonical page** | Route on the `slug:`/`fold:` key namespace, never on tier |
| **A `shared_name` row renders with no caveat** | Add the caveat, reusing `isSharedNameIdentity` / `pp_identity_shared_name` |
| A fund hit lands on a beneficiary rather than the project | Canonical direct `/funds/contract/:number` adapter |
| Latin fund query silently misses Cyrillic titles | Folded expression index and folded query predicate |
| **Folding the fund search reorders today's Cyrillic results** | Two arms with an `arm` rank (138's shape); the gate asserts the Cyrillic hit set is unchanged |
| **The folded expression index goes stale on a `translit_bg_latin` change** | 176 touches no expression index — record the `REINDEX` obligation beside the other three |
| A “see all” page cannot reproduce the preview | Offer links only where the destination reads the query and covers the same corpus; carry `altQuery`; suppress below `SEARCH_MIN_CHARS` |
| An endpoint outage reads as “no data exists” | Source fetchers throw; `HubSearch` excludes failed groups from its searched list |
| Common-name performance regresses | Keep per-tier `rank_static` early-stop; no global dynamic similarity sort; inspect plans through the driver |
| ISUN and Interreg amounts are conflated | Separate groups and keep `bgBudgetEur` for Interreg |
| **Products get buried below eight money corpora** | Order by intent (products third), and rely on empty-group collapse rather than on the cap alone |
| **Deploying the function before hosting white-screens function-served pages** | Three-step deploy, hosting first, with the two-`curl` hash check |

## 8. Explicitly out of scope for this pass

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
- adding open calls, news, or full-text page content to the home finder;
- **making the see-all row a `role="option"`** — named in §3.4 so it is a decision, not an
  oversight.

## 9. Definition of done

The work is complete when the home finder can find the user's example by Latin first+family name,
labels him specifically as Sofia's mayor, exposes public and private people without one starving
the other, routes every person to their canonical page, carries the identity caveats their
confidence licenses, renders direct contract/tender/fund/Interreg results, preserves the current
three-request cost and lazy load, passes the unit/data/build gates, and has a deployed browser
trace confirming the grouped expansion does not require a new search backend.

⚠️ **Identity duplication is NOT in this definition, and that is deliberate.** §2.6 measures
4,766 duplicated P rows; Phase 2a decides how many of them this repo closes and by what
instrument. Claiming „does not duplicate his identity" as a done-criterion would be true for one
person on the surface that makes duplication maximally visible, and false for the other 4,764.
The honest criterion is the ratchet: **the duplicate-cluster count is measured, published here,
and does not grow.**

## 10. Confirmed correct — verified 2026-09-01, keep explicit

Recorded so a later refactor cannot quietly undo them:

- **`/api/db/procurement-search` really does run all six searches today**, plus both bounded
  totals and the shliokavitsa rewrite. Surfacing four more groups adds client mapping only.
- **`isLinkableCompanyKey` is contractor-only.** Awarder ids are validated by `isValidEik`, and
  ЕСО `1752013040` / АДФИ `175076479999` sit outside 9/13 and resolve.
- **All 56 distinct `person_search.primary_role` codes have a `pp_role_*` key in the CORE
  `translation.json`** — not in `budget.json` or `methodology.json` — so §3.3's specific-office
  label cannot leak a raw code on an unloaded bundle.
- **Contract keys are URL-safe**: 0 of 410,369 contain a character outside `[A-Za-z0-9_-]`.
- **`translit_bg_latin` is `IMMUTABLE`**, so Phase 4's expression index is legal (subject to the
  REINDEX obligation).
- **`idx_person_search_fold` is `gin (name_fold gin_trgm_ops)`**, which serves `%>`; two ANDed
  probes on the same column are a BitmapAnd and need no new index.
- **`--payloads-only` applies the schema files** before its shard-reading branch.
