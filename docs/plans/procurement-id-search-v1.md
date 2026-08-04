# Search by procedure number (УНП / ocid / contract number), v1

Status: **draft, ready to implement.** Drafted 2026-08-03 from a reproduced live failure.
Every number below is measured against local Postgres (236,855 tenders / 408,229 contracts)
or against the live API.

**The gap.** A procedure number is the most natural thing to paste into a search box, and no
search surface in the app indexes one. Reproduced on live:

```
GET /api/db/procurement-search?q=05947-2023-0042
→ {"companies":[],"awarders":[],"contracts":[],"tenders":[],"funds":[],
   "contractsTotal":0,"tendersTotal":0}
```

…while `GET /api/db/tender?unp=05947-2023-0042` returns a fully populated procedure with two
awarded contracts. The record is there; nothing can find it by its own name.

---

## 1. Why every arm returns zero

Not a ranking problem — the identifier is not a match target anywhere:

| surface | what its free-text term actually matches |
|---|---|
| header search (`Search.tsx`, cmdk + Fuse) | places, sections, officials, persons, budget units, votes. **No procurement entity at all** |
| `/api/db/procurement-search` | `contracts.title_fold`, `tenders.subject_fold`, name folds on `contractor_search` / `awarder_search`, `fund_projects.title` |
| `/api/db/table` (contracts, tenders browsers) | `awarder_name`, `contractor_name`, `title_fold` / `buyer_fold`, `subject_fold` |
| `search_all` (007) | company + officer + contractor name folds |

`unp` is declared `filter: "in"` on both browser specs (`db_table.js:89`, `:320`) — reachable
programmatically by the project-file resolver, never by a user's search box.

And the fold makes a near-miss impossible rather than merely unlikely: `fold_prefix_tsquery`
(`035_procurement_search.sql:62`) strips every non-alphanumeric, so `05947-2023-0042` becomes the
token `0594720230042`, which appears in no subject. There is no accidental partial hit to build on.

## 2. The identifier namespaces that exist — measured

| column | rows | shape | index |
|---|---|---|---|
| `tenders.unp` | 236,855 (99.9% canonical) | `05947-2023-0042` | **PK** |
| `tenders.ocid` | all | `ocds-e82gsb-339310` | `idx_tenders_ocid` btree |
| `contracts.unp` | 291,896 of 408,229 (71.5%), all canonical | `05947-2023-0042` | `idx_contracts_unp` btree partial |
| `contracts.cais_id` | 304,737 | `= unp`, else `T<caisTenderId>` | `idx_contracts_cais_id` btree |
| `contracts.ocid` | 408,229 | 4 namespaces: `aop-` 244,979 · `eop-` 122,217 · `ocds-` 20,830 · `rop-` 20,203 | `idx_contracts_ocid` btree |
| `fund_projects.contract_number` | all | `BG-RRP-1.001-0002` | **PK** |
| `kzk_appeals.complaint_no` | all | `ВХР-2300-29.07.2026` | **PK** |

The worked example spans three of them at once: tender `05947-2023-0042` (ocid
`ocds-e82gsb-339310`) → two contracts, both `unp = cais_id = 05947-2023-0042`,
`ocid = eop-05947-2023-0042`.

**Every target column is already btree-indexed. This plan adds no index and no new table.**

## 3. Decision: exact match only

Measured on `contracts` (408,229 rows), worst case:

| predicate | plan | time | buffers |
|---|---|---|---|
| `unp = '05947-2023-0042'` | Index Scan `idx_contracts_unp` | **0.062 ms** | 4 |
| `unp LIKE '05947-2023%'` | Parallel Seq Scan | 314 ms | 120,624 |
| `unp ILIKE '%05947-2023-0042%'` | Parallel Seq Scan | 145 ms | 120,624 |
| `ocid = 'eop-05947-2023-0042'` | Index Scan `idx_contracts_ocid` | 0.034 ms | 4 |
| `tenders.unp = …` | Index **Only** Scan `tenders_pkey` | 0.082 ms | 4 |

Exact match is three to four orders of magnitude cheaper and needs nothing new. Prefix
(`05947-2023` → "all 2023 procedures of buyer 05947") would need `text_pattern_ops` twins on four
columns; it is **explicitly out of v1** — the use case the gap describes is pasting a whole number.

**This is also the trap to avoid.** The naive fix — flipping `unp` to `search: true` on the two
browser specs — compiles to the plain arm `unp ILIKE '%q%'` (`db_table.js:1629`) ORed into every
free-text search. That is the 145 ms / 120k-buffer seq-scan above, added to *every* search on the
contracts browser, including the ones that work today. v1 introduces an anchored arm instead (§5).

## 4. L1 — `/api/db/procurement-search`

New SQL in `035_procurement_search.sql` (`CREATE OR REPLACE`, so `apply_functions.ts` ships it;
plpgsql keeps the body unresolved at create time, so the file stays contracts-only-safe as its
header requires):

```
normalize_procurement_id(q text) → text[]   -- IMMUTABLE, the candidate forms
search_procurement_ids(q text)   → TABLE (kind, id, unp, label, sublabel, amount_eur)
```

`normalize_procurement_id` trims, drops internal whitespace, and expands one pasted string into
every form it could be stored as: a canonical УНП also yields `eop-<unp>`; an
`ocds-e82gsb-<n>` also yields `T<n>` (the `cais_id` fallback form, `079_contracts_cais_id.sql:34`);
a bare `eop-`/`rop-`-prefixed string also yields its stripped tail. Cheap because every lookup is
an equality seek.

`search_procurement_ids` fires **only** when the term is identifier-shaped — no whitespace, at
least one digit, and nothing outside `[A-Za-z0-9.\-]` plus the Cyrillic block (for `ВХР-`). Every
ordinary query short-circuits to zero rows before touching a table, so the common path is
unaffected.

`kind` is one of `tender` · `contract` · `fund` · `appeal`, resolved against:

- `tenders.unp` (PK), `tenders.ocid`
- `contracts.unp`, `contracts.cais_id`, `contracts.ocid` — keeping the existing
  `consortium_role IS DISTINCT FROM 'member'` gate so an identifier hit cannot double-count a
  consortium
- `fund_projects.contract_number` (PK)
- `kzk_appeals.complaint_no` (PK) and `kzk_appeals.unp`

Route change in `functions/db_routes.js:1847`: one more `Promise.allSettled` arm, then **prepend**
its hits to the existing `tenders` / `contracts` / `funds` arrays, deduped by key. Prepend, not
append — an exact identifier match must outrank every fuzzy subject match. The response shape is
unchanged for those three groups, so `ProcurementSearchTile` needs no edit to show them.

**`boundedTotal` must learn the identifier predicate too** (`db_routes.js:1908`). It short-circuits
to `shown` only when `shown < lim`; at exactly `lim` it re-counts using the FTS/trigram predicate
alone, which an identifier query does not satisfy — so a term matching ≥6 rows would render
"6 of 0". Today unreachable (identifier matches return 0 rows); reachable the moment L1 lands.

**Appeals are a new group.** `kind = 'appeal'` has no home in the current response, so it needs an
`appeals` array on the route plus a group in `ProcurementSearchTile` linking to
`/procurement/appeals`. Small, and `kzk_appeals.unp` is exactly how a user gets from a procedure
number to "was this appealed" — the highest-value join in the set. Kept in v1.

## 5. L2 — the browsers, so "see all" is not a dead end

Mandatory if L1 ships, and worse than the current state if skipped: the dropdown would show a hit,
and the "see all" link (`ProcurementSearchTile.tsx:138`, which carries `?q=` + `?pscope=all` into
`DbDataTable`) would land on an empty table.

New column-def flag in `functions/db_table.js`, compiled in `buildWhere` (~`:1600`):

```js
unp: { type: "text", filter: "in", searchId: true }
```

`searchId` emits an **anchored equality** arm — `unp = ANY(normalize_procurement_id($g))` — not an
ILIKE. It rides the existing btree (0.06 ms), and because `normalize_procurement_id` returns an
empty array for a non-identifier term, the arm costs nothing on ordinary searches. Applies to
`contracts.unp` / `cais_id` / `ocid`, `tenders.unp` / `ocid`, `kzk_appeals.complaint_no` / `unp`.

Gate: extend `functions/db_table.test.js` (which already covers `globalFtsOnly`, `:110`) with the
inverse case — a `searchId` column must **not** emit an ILIKE arm, and an ordinary word must not
emit an identifier arm at all.

## 6. L3 — the header search, which is what "global search" means

`src/layout/search/SearchContext.tsx` already has the pattern: a debounced live fetch
(`person-lookup`, `:31-42`) merged with the client-side Fuse index. Add a second conditional fetch
that fires **only** when the term is identifier-shaped — reusing the same shape test as §4, so a
normal query makes no extra request — and renders a `procurement` group with direct links:
`/tenders/:unp`, `/procurement/contract/:key`, `/procurement/appeals`.

This needs a new type code in `useSearchItems.tsx:122-151` and a `navigate` branch in
`Search.tsx:85-123`, plus its place in the group order in `searchConfig.ts:19-29`. Identifier hits
sort **first** — someone who pasted a number wants that record, not a fuzzy settlement match.

Reuse `search_procurement_ids` via a thin `/api/db/procurement-id` route rather than calling
`procurement-search` (which would run five fuzzy arms to serve one seek).

## 7. The adjacent defect this exposed — the contract page has no УНП

Confirmed on live:

```
GET /api/db/contract?key=9a16e33e6bdb → has unp: False | has cais_id: False | ocid: eop-05947-2023-0042
```

`CONTRACT_COLS` (`db_routes.js:88`) selects `c.ocid` but neither `c.unp` nor `c.cais_id` — yet
`ContractDetailScreen` reads `c.unp` twice: the project-file seed (`:361`) and
`sigmaContractId(c.unp, c.ocid)` (`:475`). Both have been operating on `undefined` in production;
`ProcurementContract.unp` is typed optional (`src/data/dataTypes.ts:1375`), so TypeScript never
flagged it. The SIGMA deep link falls back to the ocid path and the seed ships a hole.

Fix is two words in `CONTRACT_COLS` (`c.unp`, `c.cais_id AS "caisId"`) and it belongs here: a
contract page that cannot state its own procedure number is the same gap seen from the other end.
Then display it — a copyable УНП on the contract page and on the tender page (which already prints
it, `TenderDetailScreen.tsx:863`) is what teaches users the number is searchable at all.

## 8. Tests

- `scripts/db/tests/procurement_id_search.data.test.ts` — the worked example resolves from all four
  of its forms (`05947-2023-0042`, `eop-05947-2023-0042`, `ocds-e82gsb-339310`, `T339310`); an
  ordinary word (`ремонт`) returns **zero** identifier rows; a consortium `member` row is never
  returned; buffer ceiling per lookup (the seeks measured in §3 — this is the gate that fails if
  someone later widens the arm to a wildcard).
- `functions/db_routes.procurement.test.js` — identifier hits are prepended, deduped against the
  fuzzy arms, and `boundedTotal` never reports a total below `shown`.
- `functions/db_table.test.js` — the `searchId` arm shape (§5).
- `src/layout/search/*` — the shape test gates the extra fetch; a normal term makes one request,
  an identifier term makes two.

## 9. Deploy

Pure function-body + function-code change. No loader, no matview, no data.

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npx tsx scripts/db/apply_functions.ts 035_procurement_search.sql
npm run deploy:db
npm run deploy
```

Order per CLAUDE.md: the SQL first (the new routes read `search_procurement_ids`; without it
`/api/db/procurement-id` 500s), then the function, then hosting. `035` is `CREATE OR REPLACE`
throughout and safe to re-apply.

Worth noting in CLAUDE.md's "applied, never loaded" section: `035_procurement_search.sql` joins
the same class as the person functions — no `db:load:*` ships it, so a body change is invisible to
every row count and prod keeps the previous definition indefinitely.

## 10. Out of scope for v1

- **Prefix / partial identifiers** (§3) — needs `text_pattern_ops` indexes on four columns.
- `search_all` (007) — an orphan route with zero callers in `src/`, `scripts/`, `ai/`. Leave it.
- The remaining identifier families with no search story: `contracts.release_id`,
  `contracts.contract_id`, `tenders.notice_id`, `tenders.link_to_oj_eu` (TED/OJ references).
- The `aop-legacy-<dataset>-<documentId>` ocid namespace (244,979 rows) is matched only on the
  full string; its `documentId` tail is not separately addressable.
