# Хора — the global persons browser (`/persons`) — implementation plan v1

Status: **DRAFT (2026-07-27), audited 2026-07-27 (§0a–0c), place section rewritten 2026-07-28,
re-audited 2026-07-28 (§0d).**
The 2026-07-28 revision follows the `person_role.place` consolidation
(`person-role-place-consolidation-v1.md`, migrations 115–117): **§4 is replaced** — the
normalization it specified now exists upstream, so the browser joins the typed triple +
`place_dim` + `judicial_body` instead of deriving anything — the matview number moves
**115 → 120**, F3b adds the two dimension loaders as upstream dependencies, and risk 4 is
rewritten. Owner: TBD. Prior art it builds on: `person-identity-v1.md`
(the person layer), `persons-pg-retirement-v1.md` (Tier 0.1 — the `officials_rankings`
resource this generalizes), `postgres-migration-v1.md` (the `/api/db/table` engine).

## Decisions (locked 2026-07-27)

1. **Route is `/persons`** (top-level, not `/governance/persons`). Shorter, SEO-cleaner,
   and it is a sibling of `/procurement/contracts` in kind — a corpus browser, not a
   governance sub-report. The `/governance` hub tile points at it.
2. **`public_money_eur` SHIPS**, but NOT gated on `namesake_risk` — see §3, which is the
   most important section in this document. The gate is the TR-bridge provenance the
   resolver already established, surfaced as `tr_link_basis`.
3. **ALL persons are included** — candidates, donors, TR-only officers, everyone who
   passes the §6 privacy gate. Party affiliation is a first-class surfaced column, and
   multi-party affiliation (4,723 people) is a feature, not noise.

## 0. Pre-implementation audit (2026-07-27) — corrections that SUPERSEDE the text below

Every claim in this document was checked against the code and the local DB. Nine corrections;
the first three would have shipped broken.

### 0a. BLOCKERS

**F1 — the search column as specified returns zero rows.** §7 said
`search: true, searchCol: "name_fold"`. The engine's default search arm is a raw
`ILIKE '%<term>%'` against the target column ([db_table.js:1063–1066](../../functions/db_table.js)) —
so a Cyrillic query would be matched against a **Latin transliterated** column and match nothing,
ever. The engine has the right mechanism and it must be named explicitly:

```js
name: { type: "text", sort: true, filter: "text",
        search: true, searchCol: "name_fold", searchFold: true },
```

`searchFold: true` wraps the term in `translit_bg_latin($n)` before the ILIKE (db_table.js:1056),
which is why `tenders.buyer_name` uses it. The alternative — search raw `name` with a trigram
index on it, as `officials_rankings` does — also works; pick one, but `searchCol` **without**
`searchFold` is the one combination that is silently broken.

**F2 — the "Тип лице" mix bar cannot be built from the boolean flags, and the named
component is not reusable.** Two errors in one paragraph:

- A mix bar is a **partition** summing to 100%. The flags overlap by design (a person is
  routinely both `is_muni` and `is_company`), and a bool facet returns `{true: N, false: M}`,
  not a category breakdown. The matview needs an additional **single-valued
  `primary_facet text`** column (the `person_source.facet` of the highest-prominence role),
  faceted like `contracts.procurement_method`. The multi-valued `facet_codes` stays, for
  filtering only.
- `ContractsAnalysisStrip` is **not** a generic strip: its props are `sumAmountEur`,
  `singleBidPct`, `directPct`, `groupedMethods: MethodBucketFacet[]`,
  `procBucket: ProcedureBucket`. `ProcedureMixBar` under it hardcodes a 7-key
  `Record<ProcedureBucket, string>` hue map. Neither takes person data. T2 must either extract
  a generic `MixBar` (segments: `{key, label, count, color}[]` + `onSelect`) and refactor
  `ProcedureMixBar` onto it, or ship a separate `PersonsAnalysisStrip`. Extracting is the
  better trade — it is the third mix bar on the site — but it is **refactor work in a
  procurement-critical component**, so it is scoped and estimated here rather than described
  as "reuses the primitive".

**F3 — the refresh is chained at the wrong point.** §5 said "after `db:resolve:persons`".
The actual `db:refresh` chain runs four more loaders the browse table depends on *after* that
step: `db:load:declarations:pg -- --resolve`, `db:load:person-elections:pg`,
`db:load:mp-roster:pg`, and `db:load:official-candidate-links:pg` (**the photo source**).
Refreshing after `db:resolve:persons` yields a table with no photos and stale wealth. Correct
wiring:

- a new `db:load:persons-browse:pg` + `:cloud` pair, appended to `db:refresh` **last**, after
  `db:load:official-candidate-links:pg`;
- an entry in the CLAUDE.md **"the one step `db:refresh` cannot infer"** section, beside the
  existing `person:slug-redirects:cloud` and `db:load:official-candidate-links:pg:cloud` notes
  — nothing runs these on the cloud side;
- **a second staleness vector §5 missed entirely:** `public_money_eur` reads `contracts`, which
  the procurement watch skill reloads independently of the person layer. A contracts reload
  must also refresh this matview, or the money column silently drifts from
  `/procurement/contracts`. Wire it into the procurement reload path too, per
  `reference_migrated_family_watch_reload`.
- **F3b (added 2026-07-28 with the place rewrite) — two more upstream dependencies, and their
  failure mode is silent.** The place columns join `place_dim` (117) and `judicial_body` (116),
  loaded by `db:load:place-dim:pg` and `db:load:judicial-bodies:pg` — both of which CLAUDE.md
  requires to run **before** `db:resolve:persons` on the cloud side, and neither of which
  `db:refresh` runs on the cloud side at all. Their documented failure is exactly this
  matview's: an empty dimension does not error, it publishes NULL labels — "green locally,
  blank on prod", baked into prerendered HTML. So `db:load:persons-browse:pg:cloud` must be
  ordered after both, and the `.data.test.ts` must assert a non-NULL `place_label` for every
  row with a `place_code` (§12) rather than trusting the ordering.

### 0b. CORRECTNESS

**F4 — `prominence` and `is_exec` must not be invented here.** Two existing rules govern this
and both are load-bearing:

- [100_officials_rankings.sql:80–120](../../scripts/db/schema/pg/100_officials_rankings.sql)
  already defines a representative-post priority (`official_exec` → `public_sector` →
  `president` → `mep` → `diplomat` → `official_muni`, then newest, then ref) and records what
  picking arbitrarily cost: 212 of 504 dual-post people bucketed as municipal, under-reporting
  the executive leaderboard. `prominence` must be a **superset** of that ordering — identical
  wherever they overlap — or `/persons` and `/officials/assets` will disagree about the same
  person's primary post.
- `is_exec` must mirror `OFFICIAL_DECLARATION_SOURCES` in
  [src/lib/officialSources.ts](../../src/lib/officialSources.ts), **not** a `source LIKE
  'official%'` test. `president`, `mep` and `diplomat` are Court-of-Audit officials whose source
  names don't start with "official"; the prefix test dropped 227 people (Станишев, Бареков,
  every ambassador) from the leaderboard, and cost 179 people their whole "Заемани длъжности"
  section the time before. `officials_rankings.data.test.ts` fails on drift — the new
  `.data.test.ts` needs the same lockstep assertion.

**F6 — space-joined code columns need space-padded matching.** `role_codes ILIKE '%ngo%'`
also matches `ngo_board` and `ngo_representative`; `%mp%` is safe today only by luck. Store the
columns space-**padded** (`' mp mayor '`) and match `' <code> '`, or the role filter quietly
over-selects. Same for `facet_codes` / `party_codes`.

**F7 — photos come from two differently-keyed sources.** Verified: `mp_profile.photo_url` joins
via `person_role(source='mp').ref = mp_profile.mp_id::text` → **2,120 persons** (`mp_roster`
carries only `name`/`mp_id`, no photo — §11's original reference was wrong).
`official_candidate_link.photo_url` is keyed by `official_slug` (192 of 5,409 rows non-null) and
joins via `person_role(source IN official_*).ref`. Coalesce in that order. (§5 names the two
tables correctly; what was missing is that they need two different join keys, and that
`mp_roster` — the similarly-named table — carries no photo at all.)

### 0c. SCOPE GAPS

**F5 — prerender + sitemap are not optional, and §14's risk 5 is wrong.** Every sibling browser
is a prerendered static page with a sitemap entry: `procurement/contracts`
([prerender/routes.ts:3756](../../scripts/prerender/routes.ts),
[sitemap/route_defs.ts:342](../../scripts/sitemap/route_defs.ts)) and `officials/assets`
(:3663 / :321). Shipping `/persons` without them makes it the only browser Google cannot see.
The cost is **one** static shell, not 57k pages — the deploy-ceiling tension applies to
per-person pages, which this route does not add. T4 deliverables:

- a `staticPage({...})` entry with BG **and** EN `title` / `description` / `breadcrumbName` /
  `bodyHtml` (the existing entries are ~8 lines of real prose each, not placeholders);
- an `ogImage` asset (`/og/persons.png`) matching the sibling pattern;
- `"persons"` in the `route_defs.ts` path list **and** its `{ path, file }` entry, whose `file`
  is the freshness anchor — use the screen file, as `procurement/contracts` does.

**F9 — two process steps missing.** (a) i18n: every string needs a key in **both**
`src/locales/bg/translation.json` and `en/`; the plan enumerates none. (b) Deploy order: this
change spans a migration, the `db` function (the registry lives in `functions/`) and hosting, so
per CLAUDE.md it ships **migration → `npm run deploy:db` → `npm run deploy`**. Hosting first
would put the route live against a function that cannot serve it.

### 0d. SECOND AUDIT (2026-07-28, after the place rewrite)

**F10 — the place columns are scalar on a per-person row, with no pick rule and no filter
target. This is the party bug the plan already fixed, repeated one block lower.** §5 declares
`place_kind` / `place_code` / `place_label` / `oblast_code` as single values, but a person has
many roles in many places. Measured: **4,616 persons hold roles in 2+ distinct places, and
1,851 span 2+ oblasts** (a candidate in Варна who is also a councillor in Бургас). Two
consequences, both silent:

- *Display* — with no documented rule the pick is whatever the plan's `DISTINCT ON` happens to
  order by, and it changes between REFRESHes. §6 already solved this for party (highest
  `prominence`, then latest `start_date`, then code ascending); **place must reuse that exact
  rule**, so a person's primary role, primary party and primary place all describe the same
  seat rather than three unrelated ones.
- *Filtering* — `?oblast=VAR` matching only the primary column **omits 1,851 people who
  genuinely serve there**, which reads as "no such people" rather than as a narrowed view. §6
  already reasoned this out for party and chose `party_codes`; place needs the same
  **`oblast_codes`** (space-padded, `filter:"text"`), with the scalar kept for display.

**F11 — `onData` changed under this plan (commit `53736184e0`), in a way worth using.** It now
takes a second argument — the exact request that produced the response — so a caller can
re-issue the same query at a larger `pageSize`. That is the **CSV-export seam**, and a persons
browser is a natural place for it (the connections screen already ships `exportPairsCsv`).
The same commit made `onData` ref-invoked, so it **no longer needs memoizing**; the §8 KPI
wiring is unaffected but should not imply otherwise.

**F12 — §7 never declares the place columns' filter shapes.** Add: `place_kind` / `place_code` /
`obshtina_code` / `judicial_kind` / `judicial_tier` as `filter:"in"` (the last two also
facetable — they are what make "all районен prosecutors" one click), `oblast_codes` as
`filter:"text"`, and `institution` as `filter:"text", search: true`.

### 0e. CONFIRMED — no change needed (both rounds)

`/persons` is free (only `person/:name` at routes.tsx:3764) · ~~`115_` is the next free
migration~~ → **`120_`** (115–119 landed since: person_role_place, judicial_body, place_dim,
procurement_scopes, procurement_settlement_scoped) ·
`TILE_ACCENTS.indigo` exists (`#7f85a3`) · the Bridge-A derivation in §5 works on all three arms
(mp 57, official 450, magistrate 245 rows) · adding a REGISTRY entry needs **no** route change
(both `functions/index.js:24` and `db_routes.js:9` consume it generically) · facets already
handle non-text types (`bool`/`int`/`number` NULL-guard branch) · `MAX_OFFSET` 100k is far above
this corpus · the gated row count is exactly **56,801** (all 58,084 persons are `status='active'`
today, so the gate is `is_public_figure` alone — keep both predicates anyway, per 100's argument) ·
the 1,070 money-carrying persons reconcile across both verification queries (540+364+159+7 =
710+360).

Round 2 (2026-07-28) re-verified after the place consolidation and the artifact regen
(`0070b5d3f8`): the judicial two-hop resolves **270/270** of the judicial codes person_role
actually uses — to a body AND to an oblast — so §4's "the full placed set" is exact, not
optimistic · `officials_rankings_table.institution` is non-NULL for **19,022/19,034** rows, so
it is a real source for the executive institution, not a mostly-empty one · `120_` is still the
next free migration · the F5 line citations still resolve
(`prerender/routes.ts:3756`/`:3663`, `sitemap/route_defs.ts:342`/`:321`) · and the two headline
figures are unchanged after the regen — **56,801** gated persons, **1,070** money-carrying.

## 1. Goal & thesis

The site has 58,084 resolved persons and no way to browse them. Every person surface today
is either a **profile** (`/person/:slug`) reached by search, or a **single-facet leaderboard**
(`/officials/assets` = executives by net worth, `/mp-assets`, `/mp-cars`). There is no
"show me every councillor in Бургас who also runs a company", no "who switched parties",
no "which magistrates declared a stake".

The thesis: the person layer's whole point was that one human resolves across nine datasets.
A browser is how a reader *sees* that. It is also the cheapest large feature left — the
serving engine, the identity table, the wealth series and the money bridges all exist.

## 2. Measured state (local PG, 2026-07-27)

Every figure below was measured, not estimated. They set the shape of the UI.

| fact | value |
|---|---|
| persons | **58,084** (56,801 pass `is_public_figure`) |
| roles | **143,253** across 16 sources |
| with declared wealth (`person_wealth_year`) | 17,037 (29%) |
| with TR company roles | 10,703 (18%) |
| with any ЗОП contractor money | **1,070 (1.8%)** |
| with a party | 36,387 (63%) — of which **4,723 carry 2+ parties** |
| with a typed place | **44,961 (77%)** — 29,622 `mir`, 15,223 `obshtina`, 2,676 `judicial`; 43 unresolved rows (§4) |
| with a photo | **2,120** via `mp_profile` (2,122 MPs, 2 unresolved) + ≤192 via `official_candidate_link` (≈4%) |

Role vocabulary is long-tailed: `candidate` 29,622 people, `councillor` 13,777,
`manager` 6,955, `ngo_board` 4,672, `magistrate` 3,113, `mp` 2,120, `mayor` 921, then ~40
smaller roles. **The corpus is small (57k rows × ~300B).** Performance is therefore about
avoiding known landmines, not about scale.

**Consequence for the UI:** 4% photo coverage kills the avatar-card-grid idea. This is a
**table** with a small avatar (initials fallback) in the name cell — the shape
`OfficialsAssetsScreen` already proved.

## 3. The `public_money_eur` gate — VERIFIED, and the obvious gate is WRONG

The v0 brainstorm proposed suppressing the money column when `namesake_risk > 1`. **That is
wrong and would have shipped a bug.** Verification:

`namesake_risk` is `officer_name_counts.company_count` — the number of distinct *companies*
a name fold appears on. The resolver's own comment
([resolve_persons.ts](../../scripts/person/resolve_persons.ts), Bridge B) deprecates it for
exactly this purpose:

> a direct people-uniqueness guard that supersedes the old `namesake_risk<=1` proxy
> (`officer_name_counts.company_count`), which **conflated one person's multiple companies
> with distinct namesakes** and so capped a real footprint at a single company

So `namesake_risk = 4` usually means *this person owns four companies*, not *four people
share this name*. Measured cost of the wrong gate — persons carrying ЗОП contractor money,
bucketed by `namesake_risk`:

| namesake_risk | persons with money | Σ €M (double-counted, see below) |
|---|---|---|
| 0–1 | 540 | 18,966 |
| 2–3 | **364** | **19,466** |
| 4–5 | **159** | **9,586** |
| 6+ | 7 | 22 |

A `namesake_risk <= 1` gate would blank **523 of 1,070 people and €29bn** — precisely the
multi-company footprints that are the most newsworthy rows in the table.

**The correct gate already ran at resolve time.** Every `person_role(source='tr')` row exists
only because it passed one of two bridges:

- **Bridge A — curated/declared.** `company_politicians` (MP + official declared links) and
  `magistrate_company` (ИВСС чл.175а). Small and high-trust: 508 + magistrate rows.
- **Bridge B — name discovery.** Requires ALL of: the name fold maps to exactly one known
  person (`NOT EXISTS` a second person on the fold), a 3-part name, and a footprint of
  ≤ 5 companies (`FOOTPRINT_CAP`).

Measured split of the 1,070 money-carrying persons: **360 Bridge-A-backed, 710 Bridge-B-only**
(€15.6bn / €32.4bn). `person_role.source_row` is NULL for all 24,251 TR rows, so provenance
is not stored — but it is **re-derivable at matview build time** by joining the two curated
tables (query in §5).

### The rule this plan adopts

1. Ship `public_money_eur` for every person who has it.
2. Carry `tr_link_basis text` — ~~`'declared'` when ANY contributing EIK is Bridge-A-backed,
   else `'name_match'`~~. **Superseded during T0 review, and the correction matters:** "any"
   makes ONE curated company clear the caveat off a footprint whose other companies were
   matched by name (8 people are in that state). It has THREE values —  `'declared'` (every
   contributing company curated), `'mixed'` (some), `'name_match'` (none) — and the UI
   caveats anything that is not `'declared'`.
3. `'name_match'` **and `'mixed'`** rows render the figure with the existing caveat affordance — the
   `person_namesake_disclosure` string is already in `src/locales/bg/translation.json:3143`
   and already used on the person page. Same words, same meaning, no new editorial claim.
4. **The column is never footer-aggregated.** Two co-officers of the same company each carry
   that company's full sum, so `Σ public_money_eur` across rows is meaningless. The
   `renderAggregates` footer must show count only — unlike the contracts browser, which sums
   `amount_eur` because there a row *is* the money. Write this in the registry comment, not
   just here; a later contributor adding `agg: "sum"` to the column would produce a large,
   plausible, wrong number.

## 4. Place — REWRITTEN 2026-07-28, the consolidation did this work already

**This section previously specified a normalization the site has since built.** The v1 text
described `person_role.place` as one untyped column holding five incompatible namespaces and
asked this matview to derive `oblast` / `obshtina` / `institution` from it. That column **no
longer exists**: `115_person_role_place.sql` (plan `person-role-place-consolidation-v1.md`)
split it into a typed triple, and migrations 116/117 added the two dictionaries it keys into.
The browser now **joins**, it does not normalize — strictly better, and the old §4 would have
built a second, competing normalizer.

### What the schema looks like now

```
person_role.place_kind  text  CHECK (NULL OR 'mir' | 'obshtina' | 'judicial')
person_role.place_code  text  -- paired with kind: CHECK ((kind IS NULL) = (code IS NULL))
person_role.place_raw   text  -- unresolved residue ONLY: CHECK (raw IS NULL OR code IS NULL)
    INDEX (place_kind, place_code) WHERE place_code IS NOT NULL

place_dim      (kind, code) → name_bg, name_en, oblast_code, obshtina_code, mir_code,
                              + the SFO_CITY-only shard/governance/price alias columns   -- 117
judicial_body  body_code    → name, kind (court|prosecution|investigation|council),
                              tier, place_code, lat, lng                                 -- 116
```

Measured coverage (2026-07-28), which supersedes the old table:

| place_kind | sources | roles | persons | codes |
|---|---|---|---|---|
| `mir` | candidate, mp | 53,133 | 29,622 | 31 |
| `obshtina` | local, official_muni | 23,327 | 15,223 | 289 |
| `judicial` | magistrate | 2,676 | 2,676 | 270 |
| NULL | tr, ngo, official_exec, public_sector, donor, … | 64,117 | — | — |

**44,961 persons carry a typed place** — more than the 44,345 the untyped column reached,
because magistrates' courts now resolve. Unresolved residue is **43 rows / 39 distinct
strings**, down from ~975 unnormalized court spellings. `ds` / `regulator` / `sanctions` no
longer carry a place at all: their values were never places, and the consolidation dropped
them (they remain in `source_row`).

### What the matview carries

- **`place_kind`, `place_code`** — verbatim, both filterable (`in`), riding the existing
  partial index.
- **`place_label` / `place_label_en`** — **copy the expression from
  [082_person_api.sql:59–69](../../scripts/db/schema/pg/082_person_api.sql) verbatim**:
  `COALESCE(pd.name_bg, jb.name, r.place_raw)` for BG, and `pd.name_en` **alone** for EN
  (judicial_body carries no English name — that asymmetry is deliberate there, so mirror it
  rather than inventing a fallback). A different label expression here means `/persons` and
  `/person` print different place names for the same role.
- **`oblast_code`** — `place_dim.oblast_code`, which is populated for **31/31** mir codes and
  **289/295** obshtina codes. The Sofia `S23/S24/S25` and `PDV-00` quirks
  (`project_oblast_code_shard_mismatch`) are already resolved inside the dimension; do not
  re-handle them.
- **A two-hop for judicial roles, or 2,676 magistrates vanish from the oblast filter.**
  A judicial `place_code` is a `body_code`, not a place — it has no `place_dim` row, so the
  single-hop join leaves oblast NULL for every magistrate (measured: single-hop reaches 42,315
  of the 44,961 placed persons, and the 2,646-person gap is exactly this). All **283**
  judicial bodies carry their own `place_code` resolving to an obshtina with an oblast, so:
  `person_role.place_code → judicial_body.body_code → judicial_body.place_code →
  place_dim(kind='obshtina').oblast_code`. With the hop, oblast coverage is the full placed set.
- **`obshtina_code`** — `place_dim.obshtina_code`, the `/governance/:id` cross-link
  ("everyone in my município"). `SFO_CITY`'s alias columns are what map Sofia onto the
  governance route.
- **`institution` no longer comes from place.** For magistrates it is `judicial_body.name`
  (plus `kind`/`tier`, which make "all районен prosecutors" a real filter, and `lat`/`lng`,
  which make a court map possible later). For executives it is
  `officials_rankings_table.institution`, which already derives it from the newest
  officials-tier declaration.

## 5. Data layer — `person_browse_table` (migration `120_person_browse.sql`)

One row per PERSON. **Not one row per role.** `person_role` has 143k rows for 57k people;
browsing it directly lists Пеевски seven times and inflates the `count` aggregate and every
facet identically, with no error anywhere — the exact failure
[100_officials_rankings.sql](../../scripts/db/schema/pg/100_officials_rankings.sql) documents
at length and the `defaultScope` note on `mp_assets_rankings` guards against. The migration
header must repeat this; it is the single most likely regression.

```
person_browse_table (matview, ~56.8k rows)
-- identity
  slug            text      -- PK-ish, unique index; -> /person/{slug}
  name            text
  name_fold       text      -- translit_bg_latin, the search column
  photo_url       text      -- denormalized from mp_profile / official_candidate_link
  namesake_risk   int       -- carried for the caveat, NOT used as a money gate (§3)
-- classification
  primary_role      text    -- highest-prominence role code
  primary_facet     text    -- SINGLE-VALUED person_source.facet of that role — the mix-bar
                            --   partition (F2). facet_codes below overlaps and cannot serve it.
  role_codes        text    -- space-PADDED distinct role codes, ' mp mayor ' (F6)
  facet_codes       text    -- space-PADDED distinct person_source.facet
  is_mp, is_exec, is_muni, is_magistrate, is_ngo, is_company, is_candidate, is_donor  bool
  sources_n, roles_n  smallint
-- party (§6)
  party_primary        text   -- canonicalId of the representative affiliation
  party_primary_name   text
  parties_n            smallint
  party_codes          text   -- space-PADDED distinct canonicalIds (filter:"text", F6)
-- place (§4 — joined from the typed triple, NOT normalized here).
-- SCALARS BELOW ARE THE REPRESENTATIVE SEAT, picked by the SAME rule as party_primary
-- (highest prominence → latest start_date → code asc). 4,616 people hold roles in 2+
-- places, so an undocumented pick drifts between REFRESHes. See F10.
  place_kind      text      -- 'mir' | 'obshtina' | 'judicial'
  place_code      text
  place_label     text      -- COALESCE(pd.name_bg, jb.name, r.place_raw) — copied from 082
  place_label_en  text      -- pd.name_en alone (judicial_body has no EN name)
  oblast_code     text      -- representative, via place_dim, WITH the judicial two-hop
  oblast_codes    text      -- space-PADDED set of EVERY oblast this person holds a role in;
                            --   the FILTER target. Filtering on the scalar drops 1,851
                            --   people from an oblast they genuinely serve (F10).
  obshtina_code   text
  institution     text      -- judicial_body.name | officials_rankings_table.institution
  judicial_kind   text      -- court | prosecution | investigation | council
  judicial_tier   text      -- районен | окръжен | апелативен | административен | …
-- accountability
  latest_declaration_year int
  has_declaration         bool
  net_worth_eur           numeric
  delta_pct               numeric
  excluded_asset_rows     int
-- money (§3)
  companies_n       smallint
  public_money_eur  numeric
  tr_link_basis     text     -- 'declared' | 'name_match' | NULL
-- ordering
  prominence        smallint -- superset of 100_officials_rankings.sql's representative-post
                             --   priority; identical where they overlap (F4)
```

**Gate applied in the matview**, not left to callers: `status = 'active' AND is_public_figure`,
and roles restricted to `confidence IN ('exact_id','high','manual')` — the same predicate
every serving function in `082_person_api.sql` uses. `100_officials_rankings.sql` explains
why a serving surface applies the gate itself rather than trusting that today's data makes
it a no-op.

### Bridge provenance derivation (verified query, folds into the matview)

```sql
-- Bridge A: the (person, eik) pair is reachable from a curated table.
SELECT DISTINCT pr.person_id, cp.eik AS uic
  FROM company_politicians cp
  JOIN person_role pr
    ON (cp.kind = 'mp'  AND pr.source = 'mp'
        AND pr.ref = replace(cp.ref, '/candidate/mp-', ''))
    OR (cp.kind = 'official'
        AND pr.source IN ('official_exec','official_muni','public_sector')
        AND pr.ref = replace(cp.ref, '/officials/', ''))
UNION
SELECT DISTINCT pr.person_id, mc.eik
  FROM magistrate_company mc
  JOIN person_role pr ON pr.source = 'magistrate' AND pr.ref = mc.magistrate_name
 WHERE mc.eik IS NOT NULL AND NOT mc.eik_ambiguous;
```

Money itself reuses the established basis — `contracts.amount_eur` where `tag='contract'`
and `consortium_role IS DISTINCT FROM 'member'`, i.e. the post-annex SIGMA-matching basis
(`reference_procurement_eur_sum_basis`, migration 078), the same one `person_by_slug` uses
for `procuredEur`. **Do not invent a second basis** — a browser figure that disagrees with
the profile figure for the same person is the worst possible bug here.

### Indexes

```
UNIQUE (slug)                                  -- REFRESH CONCURRENTLY
(prominence DESC, slug)                        -- the default sort
(net_worth_eur DESC NULLS LAST, slug)          -- the wealth sort
(public_money_eur DESC NULLS LAST, slug)       -- the money sort
GIN (name_fold gin_trgm_ops)                   -- search
GIN (institution gin_trgm_ops)
(oblast), (obshtina), (party_primary), (latest_declaration_year)
partial btree per boolean flag WHERE <flag>    -- facet-scoped sorts
```

### Refresh wiring

**Superseded by F3 — read §0a.** `REFRESH MATERIALIZED VIEW CONCURRENTLY`, chained **last** in
`db:refresh`, after `db:load:official-candidate-links:pg` (not after `db:resolve:persons`, which
precedes four loaders this table reads). Needs its own `db:load:persons-browse:pg` + `:cloud`
scripts, a CLAUDE.md entry in the "one step `db:refresh` cannot infer" list, **and** a hook on
the procurement contracts-reload path (the money column's second staleness vector). Per
`reference_migrated_family_watch_reload`: wire the `:cloud` script into the regenerating watch
skill in the same commit, or the live table silently goes stale — the tenders-stale bug class.

## 6. Party — the requested first-class column

36,387 persons carry a party; **4,723 carry more than one** (max 8). Party ids are site
canonicalIds (`gerb`, `bsp`, `p_16`, …), so `useCanonicalParties` resolves name + colour
(one 84 KB fetch, already cached sitewide by React Query with `staleTime: Infinity`).

- **`party_primary`** — deterministic rule, written in the migration header: the party of the
  role with the highest `prominence`; tie-break by latest `start_date`, then by canonicalId
  ascending. Determinism matters because a non-deterministic pick changes the rendered chip
  between refreshes for no visible reason (`reference_pg_payload_determinism`).
- **`party_codes`** — the filter target. `?party=gerb` means *"ever affiliated with ГЕРБ"*,
  which is what a reader means; matching only `party_primary` would hide switchers, the most
  interesting rows.
- **Rendering** — a party-coloured pill for `party_primary`, plus a `+N` affordance when
  `parties_n > 1`. Sorting by `parties_n DESC` is the party-switcher view, one click.

## 7. Registry entry (`functions/db_table.js`)

New `persons` resource. Notes that must be comments in the file, not just here:

- `base: "person_browse_table"`, `scopeCols: []`, `maxPageSize: 50`, `pageSize: 25`.
- `aggregates: [{ fn: "count" }]` **only** — no `sum` on `public_money_eur` (§3.4).
- `defaultSort: [["prominence","desc"],["name","asc"]]` — **not** net worth. Sorting the
  front page of every named person in Bulgaria by declared wealth is an editorial statement;
  wealth stays an opt-in sort, exactly as on `/officials/assets`.
- `search: true` on `name` — **`searchCol: "name_fold"` AND `searchFold: true` together** (F1;
  `searchCol` alone matches a Cyrillic term against a Latin fold and returns nothing) — plus
  `institution`.
- `primary_facet` is filterable + facetable (it feeds the mix bar); `primary_role` likewise.
- **Place columns (F12):** `place_kind`, `place_code`, `obshtina_code`, `judicial_kind`,
  `judicial_tier` → `filter:"in"`, the last two also facetable (they are what make "all
  районен prosecutors" one click); `oblast_codes` → `filter:"text"` (the multi-value target,
  F10); `institution` → `filter:"text", search: true`. `oblast_code` is display-only —
  registering it as a filter is the F10 bug in one line.
- Multi-select facets ride the **boolean-flag + space-joined-codes** pair, because the engine's
  filter shapes are `eq / in / text / prefix / range` with no array containment. This is the
  shipped idiom — `ngos.signal_codes` does exactly this (`db_table.js:444`).
- No `viewOnly` columns and no `aggBase` split: the base is a plain matview with no LEFT JOINs,
  so the covering-index concern that forced `aggBase` on `contracts` does not arise.

## 8. Screen — `src/screens/persons/PersonsBrowserScreen.tsx`

Mirrors the rhythm of [ContractsBrowserDbScreen](../../src/screens/dev/ContractsBrowserDbScreen.tsx)
so the two browsers feel like one system.

1. **`<Title>` + breadcrumb** (Управление → Хора).
2. **KPI strip** — Лица · С декларация % · С фирми в ТР % · Общини. The count rides the
   table's own aggregate via `onData` (free, reacts to the search box); the percentages ride
   `/api/db/facets` and do not react to search — the same split the contracts screen documents.
   `onData` needs no memoizing (it is ref-invoked since `53736184e0`), and its second argument
   — the exact request that produced the response — is the **CSV-export seam**: a "Свали CSV"
   button re-issues the user's current query at a larger `pageSize` without dropping their
   filters or search term. Worth taking in T2; `exportPairsCsv` on the connections screen is
   the precedent for the download half.
3. **"Тип лице" mix bar** where contracts has "Вид процедура": политици / изпълнителна власт /
   общинска / магистрати / ЮЛНЦ / бизнес / дарители. Clickable → sets `?facet`. Per **F2** this
   partitions on the single-valued `primary_facet`, and it is **not** a drop-in reuse:
   `ContractsAnalysisStrip` / `ProcedureMixBar` are typed to `ProcedureBucket`. Extract a generic
   `MixBar` (`{key,label,count,color}[]` + `onSelect`) and refactor `ProcedureMixBar` onto it —
   scoped in T2 as a refactor of a procurement-critical component, with its existing tests green.
4. **Filter row** — name search · facet · role · party · oblast · "само с декларация" toggle ·
   "само заемали длъжност" toggle · clear. All shared Radix `Select`
   (`src/components/ui/select.tsx`) — never native, never a scroll-locking modal dropdown.
5. **Table columns**, with the existing progressive-disclosure classes:

   | column | visibility | notes |
   |---|---|---|
   | Име (`MpAvatarView` + name) | always | caveat tooltip when `tr_link_basis='name_match'` |
   | Роля (chips, +N) | always | `primary_role` + overflow |
   | Партия | always | coloured pill, `+N` when `parties_n > 1`, sortable by `parties_n` |
   | Място | `hidden md:` | `place_label` (`place_label_en` in EN) — one column, not "Област / Община": the label already reads as МИР, obshtina or court per `place_kind` |
   | Декларация (year) | `hidden sm:` | three distinguishable blank states, per §9 |
   | Нетно състояние | `hidden md:` | sortable, `*` when `excluded_asset_rows > 0` |
   | Фирми | `hidden lg:` | `companies_n` |
   | Публични пари | `hidden lg:` | sortable; caveat affordance on `name_match` |

6. **`MpAvatarView`, not `MpAvatar`.** The hook-driven variant pulls `parliament/index.json`;
   `photo_url` is denormalized into the matview precisely so the browser never does
   (`project_mp_avatar_index` — a 972 KB index downloaded for one face, already fixed once).

### URL contract

`?q ?facet ?role ?party ?oblast ?obshtina ?court ?decl ?held ?sort` — `?court` is the judicial
body filter the consolidation made possible (`place_kind='judicial'` + `place_code`), and it is
the one filter whose values a reader will never type, so it needs a facet-driven picker rather
than a free-text box. Owned by a new
`useUrlPersonFilters` modeled on
[useUrlProcurementFilters](../../src/data/procurement/useUrlProcurementFilters.ts). **Every
value validated on read**; unknown values dropped rather than passed into a `DbColumnFilter`.
Add the block to the CLAUDE.md "URL contract" section in the same commit.

## 9. Editorial rules (non-negotiable)

- **Three distinguishable "no figure" states**, rendered differently — never collapsed to one
  dash. `slug` present but `has_declaration = false` = nothing on record; `has_declaration =
  true` with NULL `net_worth_eur` = filed, declared no valued assets; a non-cohort person =
  not applicable. `100_officials_rankings.sql` and `mp_assets_rankings` both spell this out.
- **The accumulation gap does NOT appear in the browser.** `091_accountability_gate.sql`
  restricts it to a defined senior cohort (MPs, ministers/deputies, mayors, magistrates)
  because publishing a declared-vs-audited discrepancy on a named councillor is not
  defensible. A browser column would defeat that gate by construction. Link to it from the
  profile only.
- **`excluded_asset_rows > 0` ⇒ show the asterisk and suppress the delta.** Differencing a
  partial total against a whole one manufactures a collapse.
- **Every row is a named living person.** Any new column proposed later gets the same
  question this document asked of `public_money_eur`: *what exactly does the gate mean, and
  what does it cost when it is wrong?*

## 10. Performance

The corpus is small; this is a landmine checklist, not an optimization plan.

- **EXPLAIN ANALYZE the worst case before merge** — empty search + facet filter + sort by
  `net_worth_eur DESC NULLS LAST` + `OFFSET 1000`. Standing rule: measure on the worst-case
  entity, never assume (`feedback_db_query_perf`).
- **Watch the search + ORDER BY + LIMIT fence** (`reference_dbtable_search_orderby_fence`) —
  the planner abandons the index and seq-scans; the fix is the `OFFSET 0` fence. At 57k rows
  this is ~10 ms either way, but confirm rather than assume, and note the finding in the
  registry comment so the next resource author knows it was checked.
- **`ANALYZE person_browse_table` after every REFRESH.** `resolve_persons.ts` already does
  this for `person`/`person_role` after its TRUNCATE+COPY, having measured
  `person_connections` at 2.5 s vs 0.25 s on stale stats.
- No client-side scoring per row (the contracts browser scores risk client-side; there is no
  equivalent here — everything is precomputed).

## 11. The `/governance` hub tile

- New `GovHubTile` in the **accountability** cluster of
  [governanceRegistry.ts](../../src/screens/governance/governanceRegistry.ts), beside
  parliament / governments / declarations: `id: "persons"`, `to: "/persons"`,
  `accent: TILE_ACCENTS.indigo`.
- New scene in [governanceScenes.tsx](../../src/screens/governance/governanceScenes.tsx).
  Tiles take `scene: FC` (an SVG component rendered in a `SceneFrame`) plus an optional
  `stat` overlay — so the "custom image" is a scene, drawn with `currentColor` ink +
  `var(--sector)` accent. Proposed vignette: **a roster grid of abstract portrait cards with
  one highlighted**, dense marks kept top/right so the `stat` overlay ("57 хил. лица") sits
  clean in the lower-left, per the stat-overlay rule in `src/ux/infographic/README.md`.
- The hub screen's dev-time guard already `console.error`s a tile id with no scene key — keep
  the id and the scene key in the same commit.
- Also add a shortcut tile to `declarationsRegistry.ts` (the `/governance/declarations`
  sub-hub), since "browse people" is the natural parent of the four MP/officials leaderboards
  that live there.

## 12. Tests

Per `docs/testing-standards.md` — co-located `*.test.ts(x)`, PG gates as `*.data.test.ts`
(auto-skip when Postgres is down).

- `scripts/db/tests/person_browse.data.test.ts`:
  - **row count == distinct public persons** (the fan-out invariant — the single most
    important gate in this feature);
  - `public_money_eur` reconciles per-person against `person_by_slug(...)->'companies'`
    `procuredEur` for a sample incl. a multi-company person, i.e. the browser and the profile
    never disagree;
  - `tr_link_basis='declared'` ⟹ the pair really is in a curated table;
  - no row with `status='review'` or `is_public_figure = false`;
  - every row with a `place_code` has a non-NULL `place_label` (the empty-dimension guard,
    F3b) and an `oblast_code` — the latter fails without the judicial two-hop, which is the
    point of asserting it;
  - `oblast_code ∈ oblast_codes`, and a person with roles in two oblasts appears under **both**
    when filtered (F10 — assert on a known multi-oblast person, of which there are 1,851);
  - the representative place, party and role come from the **same** role — three independent
    `DISTINCT ON`s would each pick a different seat and the row would describe nobody;
  - `party_primary` ∈ `party_codes`, and the pick is stable across two REFRESHes;
  - **`is_exec` lockstep with `OFFICIAL_DECLARATION_SOURCES`** (F4) — the assertion
    `officials_rankings.data.test.ts` already carries, because a `source LIKE 'official%'`
    shortcut drops president/mep/diplomat (227 people);
  - **`prominence` agrees with `officials_rankings_table.category`** on every person present in
    both — the guard against two "primary post" rules;
  - `primary_facet` is non-NULL for every row and its counts sum to the table count (the mix-bar
    partition invariant, F2);
  - a Cyrillic search term returns rows (F1's regression, as a query-level test — the bug is
    invisible to a schema-only assertion).
- `functions/db_table.test.js`: the `persons` resource declares no `sum` aggregate; filter
  ids resolve; `maxPageSize` respected.
- `useUrlPersonFilters.test.ts`: unknown `?facet` / `?party` values are dropped, not forwarded.
- Playwright: `/persons` renders rows, a facet click updates the URL and the row count, and a
  deep link with every param restores state.

## 13. Tiers

| tier | scope | ships |
|---|---|---|
| **T0** | `120_person_browse.sql` + the refresh wiring (F3/F3b) + watch-skill entry + `.data.test.ts` | nothing user-visible |
| **T1** | registry resource (F1 search flags) + `PersonsBrowserScreen` + route + `useUrlPersonFilters` + bg/en i18n keys | the browser, name/facet/role/party filters, prominence sort |
| **T2** | generic `MixBar` extraction + `ProcedureMixBar` refactor (F2) + KPI strip + "Тип лице" bar + the place/court filters (§4 — joins only, no normalization work) | discovery surface |
| **T3** | money + wealth columns with §3/§9 caveats | the accountability columns |
| **T4** | hub tile + scene + declarations sub-hub tile + CLAUDE.md URL-contract block + **prerender `staticPage` (bg+en) + `/og/persons.png` + sitemap `route_defs` entry (F5)** | the entry points, and the page Google can see |

T3 is deliberately last: it is the only tier carrying editorial risk, and T0–T2 are useful
without it.

## 14. Risks

1. **Fan-out regression.** A later contributor "simplifies" the matview by joining
   `person_role` and the table silently double-counts. Mitigated by the T0 invariant test,
   which must run in CI, not just locally.
2. **A second money basis.** Someone computes `public_money_eur` without the
   `consortium_role <> 'member'` exclusion or on the pre-annex basis, and the browser
   disagrees with the profile. Mitigated by the reconciliation test.
3. **Stale live table.** The cloud refresh is not wired into the watch skill → the tenders-stale
   bug class. Mitigated by doing it in the same commit as the migration.
4. **An empty place dimension blanks the place column silently** (rewritten 2026-07-28 — the
   old "place normalization rots" risk died with the consolidation; this replaces it). A cloud
   database that never ran `db:load:place-dim:pg:cloud` / `db:load:judicial-bodies:pg:cloud`
   gets NULL labels, not an error — CLAUDE.md documents this exact failure for `/person` roles
   ("green locally, blank on prod"), and it is worse here because the browser's place *filter*
   also goes empty, which reads as "no such people". Mitigated by the F3b ordering plus the
   non-NULL `place_label` assertion in §12.
5. ~~**SEO.** v1 does not prerender it.~~ **Superseded by F5.** Both sibling browsers are
   prerendered and sitemapped; skipping it would make `/persons` the only browser Google cannot
   see, for the cost of one static shell. The deploy-ceiling tension
   (`persons-pg-retirement-v1.md` §0.5) is about per-person pages, which this route does not add.
   Moved into T4 as a deliverable.
6. **The MixBar refactor lands in procurement.** T2 touches `ProcedureMixBar`, which every
   contracts screen renders. Ship it as its own commit with the existing procurement tests green
   before the persons screen consumes it, so a regression there is bisectable.
