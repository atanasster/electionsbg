# Unified Person Identity — implementation plan v1

Status: DRAFT (2026-07-18), **gap-audit + testing + connections revision 2026-07-18** — added §1a
prior-art reconciliation, §2a name-structure matching, §4a JSON→PG migration, §4b AI tools, §4d
serving, §5 source catalog (all current + planned sources, each a filter facet), §5a LLM-assisted
reconciliation, §7 testing gates, §8 Connections component (the primary consumer; prototyped). SEO
(§4c) DEFERRED to Phase 6. Test runner now defers to the repo-wide framework workstream (§7). Owner: TBD.

Goal: give every natural person in the site a single stable `person_id` in Postgres, so that
candidates, MPs, mayors, councillors, executive & municipal officials, TR company officers/owners,
magistrates, NGO board members and campaign-finance donors all resolve to **one profile** and can
carry rich person↔person edges — regardless of how each dataset was ingested. The model is
**source-extensible**: every dataset (current or future — §5) is just another `person_role` source
and, on the Connections component (§8), another filter facet — so adding ДС, sanctions, regulators,
etc. widens coverage without schema change.

Decisions locked with the owner (2026-07-18):
- **Merge policy = aggressive + review queue.** Fold-match merges even when the name is ambiguous,
  but ambiguous merges are held in a review table and gated OFF public pages until adjudicated.
- **First deliverable = this plan doc**, before any migration or resolver code.

---

## 1. Why — the problem today

There is no person entity. Nine people datasets each key humans differently and every cross-link is
a build-time fuzzy name-join. The only genuinely stable person key in the whole system is the
parliament.bg MP `id`.

| # | Dataset | Location | Key today | Ingest |
|---|---------|----------|-----------|--------|
| 1 | MPs (39th–52nd NS) | `data/parliament/index.json`, `by-id/{id}.json`, `profiles/` | numeric `id` (parliament.bg) | `parliament-scrape` |
| 2 | NS candidates (CIK) | `data/{election}/candidates.json`, `candidates/by-slug/` | slug `mp-{id}` \| `c-{partyNum}-{nameSlug}` | `scripts/preferences/` |
| 3 | Local mayors & councillors | `data/{cycle}_mi/municipalities/{code}.json` | bare `name` + `(listPos, localPartyNum)` | `update-local-elections` |
| 4 | Officials — executive | `data/officials/index.json`, `declarations/{slug}.json` | `name-hash` slug | `update-officials` |
| 5 | Officials — municipal | `data/officials/municipal/index.json`, `by_obshtina/` | `name-hash` slug | `update-officials` |
| 6 | TR officers/owners | `tr_officers`, `tr_person_roles` (PG) | `(uic, name)` → `name_fold` | `update-connections` |
| 7 | Magistrates (ИВСС чл.175а) | `magistrate`, `magistrate_company` (PG) | `name` PK + `name_norm` | `update-judiciary` |
| 8 | NGO board members | slice of `tr_officers`; derived `ngo_board_links` (PG) | `name_fold` + `officer_name_counts` guard | `update-connections` / ngo loaders |
| 9 | Campaign-finance donors (ЕРИК) | `data/{election}/parties/{financing,donors}.json` | bare `name`, `normKey` group | `update-financing` |
| — | Connections graph (current hub) | `data/parliament/connections.json`, `data/officials/derived/connections.json` | `mp:{id}` / `officials/{slug}` / `person:{norm}` / `company:{uic}` | `update-connections` |

Three structural constraints:

1. **No EGN, ever, by policy.** `scripts/declarations/tr/types.ts:55-59` — the TR source carries a
   hashed+salted EGN but nothing extracts or stores it. There is no natural person primary key.
   Identity is a name string.
2. **Four keying schemes, three normalizers.** `translit_bg_latin()` (SQL, `000_search_fns.sql` —
   drives TR/magistrate/official folding), `normName()` (`src/data/judiciary/normName.ts`),
   `normKey()` (`scripts/smetna_palata/donor_summary.ts`), plus `normalizeMpName`, `slugify`,
   `nameSlug/transliterate`. They do not agree byte-for-byte.
3. **Namesake collapse is a legal risk, not just data quality.** The `ngo_board_links` defamation
   guard (`080_ngo_signals.sql`) only surfaces a link when `officer_name_counts.company_count = 1`.
   A wrong merge on a public page is an accusation.

What already exists (the natural consumers of a real person id):
- `scripts/officials/decorate_candidate_links.ts` — official ↔ local slate ↔ MP, by normalized name.
- `scripts/declarations/build_connections_graph.ts` / `build_officials_connections.ts` — person ↔
  company ↔ person.
Both do the join we want; neither persists a person id.

### 1a. Relationship to existing workstreams — this plan SITS ON them, does not duplicate

Three prior plans overlap; reconcile before writing code:

- **`direct-db-ingest-v1.md` (umbrella).** Defines the canonical JSON-retirement pipeline —
  `schema → loader → SQL API → /api/db → migrate hooks → retire JSON` — and the **AI-second-consumer
  rule** (every PG domain also exposes AI tools). The §4a JSON migration below ADOPTS this pattern
  verbatim; it does not invent a new one. Motivation is shared: a single connections rebuild is a
  3,401-file commit — the person layer must not add more churning JSON shards.
- **`connections-pg-migration-v1.md` (Workstream B).** Migrates the MP-declaration business-interest
  graph (`company ── edge ── politician(mp_id|official slug)`) into PG. The person layer is the
  IDENTITY spine that Workstream B's `politician` endpoint resolves through. Sequencing: land
  `person`/`person_role` first (or jointly), then Workstream B references `person_id` instead of a
  bare `mp_id|slug`. `company_politicians` stays as-is (procurement's curated subset).
- **`arbitrary-person-search.md` (Stage 4, PAUSED).** Its "arbitrary-person lookup over a queryable
  DB" is exactly the `/person/{slug}` page in Phase 3 here — this plan RESUMES and generalizes it.
  Inherit its namesake cap (25) and bridge cap (200) as the default guard constants.

---

## 2. The unified model (new migration `081_person_identity.sql`)

A 4-table core that sits ABOVE the nine sources and references them. Source ingests are unchanged.

```sql
person                       -- the canonical natural person (the new stable id)
  person_id        bigserial PRIMARY KEY
  display_name     text NOT NULL        -- best-quality Cyrillic name
  name_fold        text NOT NULL        -- translit_bg_latin(display_name); the ONE normalizer
  given_fold       text NOT NULL        -- structured name parts (see §2a) — the blocking key
  patronymic_fold  text                 -- NULL when the source gave only a 2-part name
  family_fold      text NOT NULL
  name_parts       int  NOT NULL        -- 2 or 3 — how many parts the BEST alias carried
  slug             text UNIQUE          -- stable public slug -> /person/{slug}
  birth_date       date                 -- from MP profiles / declarations when present
  is_public_figure boolean NOT NULL DEFAULT false  -- see §6 privacy gate; default OFF, opt-in
  namesake_risk    int  NOT NULL DEFAULT 0   -- distinct-company count = the defamation guard
  status           text NOT NULL DEFAULT 'active'  -- 'active' | 'review'  (review = gated off public)
  created_at, updated_at timestamptz

person_alias                 -- every surface form that maps to this person
  person_id  bigint REFERENCES person
  alias_raw  text
  alias_fold text                        -- translit_bg_latin(alias_raw)
  source     text                        -- a §5 source-catalog key (mp|candidate|official_*|tr|magistrate|donor|local|ds|...|manual)
  PRIMARY KEY (person_id, alias_fold, source)

person_role                  -- typed, dated links from a person to a source record
  person_id  bigint REFERENCES person
  source     text                        -- a §5 source-catalog key (extensible; not a fixed enum)
  ref        text                        -- source native key: mp id, official slug, uic, obshtina+listpos, ...
  role       text                        -- 'mp'|'mayor'|'councillor'|'cabinet_min'|'tr_manager'|'ngo_board'|'magistrate'|'donor'|...
  party      text
  place      text                        -- oblast/obshtina where relevant
  start_date date, end_date date
  confidence text                        -- 'exact_id'|'high'|'medium'|'review'|'manual'
  source_row jsonb                       -- raw record for provenance
  PRIMARY KEY (person_id, source, ref, role)

person_link_override         -- human adjudication, audited (replaces scattered _aliases.json)
  fold_a text, fold_b text
  kind    text                           -- 'merge' | 'split'
  note    text
  decided_by text, decided_at timestamptz

person_link_evidence         -- external corroboration for a person↔company/person link (see §5a)
  evidence_id bigserial PRIMARY KEY
  person_id   bigint REFERENCES person
  subject     text                       -- what the evidence is about: 'company:{eik}' | 'person:{id}' | 'contract:{unp}' | 'role:{...}'
  claim       text                       -- one-line extracted claim, e.g. "депутат X е собственик на фирма Y"
  url         text NOT NULL              -- the article/source URL
  outlet      text                       -- publication name/domain
  excerpt     text                       -- short verbatim quote supporting the claim (<= 25 words)
  found_by    text                       -- 'llm-research' | 'manual'
  retrieved_at timestamptz
  verdict     text NOT NULL DEFAULT 'unreviewed'  -- 'unreviewed'|'confirms'|'refutes'|'irrelevant'
  decided_by  text, decided_at timestamptz
```

Design rationale:
- **`person_id` is the join key the site never had.** A profile page asks "everything for person N"
  in one indexed seek instead of fanning out across nine datasets.
- **One normalizer wins.** `name_fold = translit_bg_latin(...)` everywhere; `normName`/`normKey`
  retire into it. Removes a whole class of silent mismatches.
- **The namesake guard is promoted to a column** (`namesake_risk`), computed once from
  `officer_name_counts`, inherited by every consumer via a single `<= N` gate.
- **Overrides are data, not code.** Audited merge/split table replaces `scripts/officials/_aliases.json`.
- **`status='review'`** is the aggressive-merge safety valve: ambiguous merges land here, queryable
  internally, never rendered publicly until promoted to `active`.

Indexes (per `reference_pg_query_performance` — index every entity FK + both sides of every join):
`person(name_fold)`, `person(given_fold, family_fold)` (the blocking key), `person(slug)`,
`person_alias(alias_fold)`, `person_role(person_id)`, `person_role(source, ref)`,
`person_link_evidence(person_id)`, and a GIN trigram on `person.name_fold` for search.

### 2a. THE central matching problem — 2-part vs 3-part Bulgarian names

This is the single biggest correctness risk and it already sank the donor cross-reference
(`donors-connections.md`): Bulgarian names are **given + patronymic + family** (Бойко Методиев
Борисов). But sources disagree on whether the patronymic is present:
- TR `company_persons`: **210,010 of ~238k are 3-part**, only 21,155 are 2-part.
- ЕРИК donors: **521 of 521 are 2-part** (given + family only).
- CIK ballots / local slates: mixed, often 2-part.
- parliament.bg MPs: 3-part (`A_ns_MPL_Name1/2/3` split available).

Consequences the naïve `name_fold` equality gets WRONG:
- A 2-part "Георги Бакалов" matches MANY distinct 3-part TR persons — collapsing them is a false
  merge (and on a public page, a false accusation). Exact-fold matching donors→TR resolved only
  **5 of 453, 0 bridges** — proof the flat fold is the wrong key.
- Conversely two 3-part records that differ only in a transliterated patronymic must still merge.

**Rule (drives the resolver in §3):**
1. Parse every alias into `(given, patronymic?, family)` — reuse the MP `Name1/2/3` split where
   present; else tokenize (2 tokens → given+family, patronymic NULL; 3 → all three; 4+ → override).
2. The **blocking key is `(given_fold, family_fold)`** — never the middle name. Candidates to merge
   share this key.
3. Within a block, the **patronymic is a corroborant, not a requirement**: two 3-part records with
   matching patronymic → strong; a 2-part vs 3-part pair → merge ONLY with another corroborant
   (party / municipality / shared company `uic` / birth_date), else `status='review'`.
4. `name_parts=2` persons carry an inherent `namesake_risk` floor — a bare given+family can never be
   `confidence='high'` on the fold alone; it needs Tier-1 corroboration or an override.

This is why donors and local councillors will populate the review queue heavily, and why the
LLM-assisted reconciliation in §5a is worth building rather than adjudicating 100% by hand.

---

## 3. Identity resolution — clustering without EGN

Deterministic tiered resolver: `scripts/person/resolve_persons.ts` → COPY into the tables
(`reference_pg_bulk_load_copy`). Idempotent and re-runnable like `rebuild_ngo_board_links()`; slug
stability guaranteed by seeding person_ids from the MP id and persisting assignments.

**Person universe (scope) — do NOT create a `person` row per TR officer.** ~238k TR officers are
mostly private individuals; materializing all of them is wasteful and a privacy problem (§6). The
`person` table is materialized only for: (a) everyone in datasets 1–5, 7, 9 (public-office holders +
donors); and (b) TR officers that BRIDGE to one of those (share a company, or fold+corroborant match).
The remaining TR officers stay as `tr_officers` rows and are promoted lazily on first bridge. This
keeps the person universe ~O(20–40k), not 250k.

Blocking, then tiering. Candidates to compare share the **`(given_fold, family_fold)`** block (§2a);
never an O(n²) all-pairs pass. Within a block, tiers highest confidence first:

0. **Hard ids.** parliament.bg MP `id` seeds one person each (gold key). Candidate `mp-{id}` slugs
   attach `confidence='exact_id'`.
1. **Name + corroborant.** Same block PLUS a shared discriminator (matching patronymic, same party,
   same municipality, same declared company `uic`, or same `birth_date`). Generalizes
   `decorate_candidate_links.ts` (name+party). `confidence='high'`, `status='active'`.
2. **Unique fold.** Same block, `name_parts=3`, AND `namesake_risk = 1`. `confidence='high'`,
   `status='active'`. (The `ngo_board_links` "high" bar. Note: excludes 2-part names by §2a rule 4.)
3. **Ambiguous (AGGRESSIVE MERGE → REVIEW).** Block collides with `namesake_risk > 1` and no
   corroborant, OR any 2-part↔3-part pairing without a corroborant. Per the locked decision: **still
   merge**, but `confidence='review'`, `status='review'` — held off public pages, surfaced only in
   the internal adjudication view until a `person_link_override` (possibly LLM-assisted, §5a)
   promotes or splits it.
4. **Overrides** applied last (merge and split) from `person_link_override`.

Public-surface rule: a page renders a person or an edge only when the underlying rows are
`status='active'` AND `confidence IN ('exact_id','high','manual')`. `review`/`medium` are internal.
The existing "трейс, не доказателство / name match — identity not verified" disclaimer stays on
every inferred edge.

---

## 4. Rollout — incremental, non-breaking

Every phase EXPLAIN ANALYZEs new joins on the worst-case entity (`feedback_db_query_perf`) and wires
the changelog (`feedback_pg_changelog_required`).

- **Phase 1 — schema + resolver, PG-anchored.** Land the tables, unify the normalizer, resolve the
  datasets already in PG (TR, magistrate, `official_roster`, `company_politicians`). Ship
  `/api/db/person` returning the unified rollup. No frontend change; parity-check against today's
  `person_profile()` (`008_connections.sql`) with a parity script (§6).
- **Phase 2 — JSON → PG migration of the 5 file-based people datasets.** See §4a. Build the internal
  review-queue view for `status='review'`.
- **Phase 3 — one person page + AI tools.** `/person/{slug}` unifies `/candidate/*`, `/officials/*`,
  `/person/*`, magistrate holdings, NGO memberships, donations, business connections. Ship the AI
  second-consumer tools (§4b). **Legacy routes keep working unchanged** — the new page is additive;
  URL consolidation is explicitly deferred (§4c).
- **Phase 4 — rich edges.** Rebuild the connections graph ON `person_id` instead of `person:{norm}`
  nodes: person↔person via shared company, co-board membership, donor→party→candidate,
  magistrate→politician. This subsumes Workstream B's `politician` resolution.
- **Phase 5 — new dataset ingestion** (§5) — ДС/COMDOS, sanctions, regulators, etc., each a new
  `person_role` source through the same resolver.
- **Phase 6 — SEO & URL consolidation (deferred, LAST).** Only after Phase 5, when the true page
  count is known (§4c).

### 4a. JSON → Postgres migration (the user's explicit ask)

Follows the `direct-db-ingest-v1.md` pipeline: **schema → loader → SQL API → migrate hooks → retire
JSON**. Per `feedback_no_json_from_pg`, PG serves live; we do NOT regenerate JSON back out of PG.
Each dataset migrates independently; the person layer only needs the identity+role rows, so the
per-domain detail JSON can retire on its own schedule.

| Dataset | Source JSON | Loader (new) | Target rows | Serving after | JSON disposition |
|---|---|---|---|---|---|
| MPs | `data/parliament/index.json`, `by-id/`, `profiles/` | `load_persons_mp.ts` | `person`(seed)+`person_role(source='mp')`+alias | person page from PG; **avatars/profile JSON KEPT** (MpAvatar is everywhere) | keep as raw input; stop only when MpAvatar migrates |
| NS candidates | `data/{el}/candidates.json`, `candidates/by-slug/` | `load_persons_candidate.ts` | `person_role(source='candidate')`+alias | `/candidate/*` keeps JSON in Ph2; flips to PG in a later pass | keep raw `candidates.json`; retire `by-slug/` shards once page flips |
| Local mayors/councillors | `data/{cycle}_mi/municipalities/{code}.json` | `load_persons_local.ts` | `person_role(source='local')`+alias | local pages keep JSON | keep raw; person layer is index-only here |
| Officials (exec) | `data/officials/index.json`, `declarations/` | `load_persons_official.ts` | `person_role(source='official')`+alias | `/officials/*` → PG-backed; declarations stay JSON initially | retire `index.json` once `/officials` reads PG |
| Officials (municipal) | `data/officials/municipal/index.json`, `by_obshtina/` | (same loader, tier param) | `person_role(source='official')` | as above | retire `municipal/index.json` + `by_obshtina/` after flip |
| Donors (ЕРИК) | `data/{el}/parties/{financing,donors}.json` | `load_persons_donor.ts` | `person_role(source='donor')`+alias | donations tile on person page from PG | keep raw financing JSON (party pages still use it) |

Migration discipline: (1) loader COPYs into the tables (`reference_pg_bulk_load_copy`); (2) resolver
re-runs; (3) a page flips its hook from `/public/*.json` to `/api/db/*` ONLY after a parity diff
passes; (4) the now-dead JSON is removed from git tracking (or gitignored → GCS-only), citing the
3,401-file-commit churn the umbrella plan targets. Never delete a JSON that is still a raw INGEST
input — only the derived/serving shards retire.

### 4b. AI tools (the second-consumer rule)

`direct-db-ingest-v1.md` mandates AI as a second consumer of every PG domain. A `person_id` changes
the resolve layer (`ai/tools/resolve.ts`, `candidate.ts`). Add/rework: `personSearch` (name → ranked
persons, honoring the §2a blocking + namesake risk), `personById` (the unified rollup), and
`personConnections` (edges, active-confidence only). These replace the name-string fan-out the
current person/candidate/magistrate tools do (`project_ai_chat_tools`), and inherit the
grounded-number gate (`project_ai_chat_grounding_gate`).

### 4c. URL consolidation & SEO — DECISION DEFERRED to Phase 6

We will NOT decide URL consolidation or prerender scope until Phase 5 lands, because the answer
depends on how many public person pages actually exist once ДС/sanctions/regulators/MEPs are in —
a number we don't have yet. Until then: the `/person/{slug}` page is purely additive and all legacy
URLs (`/candidate/mp-{id}`, `/candidate/c-{n}-{slug}`, `/officials/{slug}`, `/person/{name}`) keep
working. Nothing 301s, nothing is removed from the sitemap.

When we DO decide (Phase 6), the open questions are: whether legacy routes 301 → `/person/{slug}`
with canonical tags or stay as co-canonical (`feedback_static_seo`, `project_seo_discovery_gap`);
how many of the ~public persons to prerender given the Firebase file ceiling
(`project_firebase_deploy_ceiling`); and the sitemap `<loc>` validity pass
(`project_sitemap_validity_audit`). Input to that decision = the actual public-person count from §6's
privacy gate after all §5 datasets are ingested.

### 4d. Serving pattern for the person page

Assembling a profile across 9 sources per request is a heavy fan-out. Follow the codebase norm:
a precomputed **`person_payloads(kind, key, payload jsonb)`** table (like `fund_payloads`/
`agri_payloads`), rebuilt by the resolver, one PK-seek per page (`kind='profile', key=slug`).
Person↔person edge queries that must be live use a STABLE jsonb function guarded by the namesake cap.
EXPLAIN ANALYZE both on the worst-case entity (a common-name person with many roles).

---

## 5. Source catalog — every people dataset, current and planned

Every dataset is one `person_role` source with a stable `source` key and a **facet** (the grouping
the Connections component §8 filters by). This catalog IS the single registry — a small
`person_source` constant (TS + optional lookup table) of `{key, label_bg, facet, tier, public_policy}`
that drives BOTH the resolver (which sources to ingest) AND the UI (which filter chips to show).
Adding a row here is the entire "add a data source" surface: new `source` → new facet chip lights up
automatically once any entity has an edge to it.

**Facets** (filter chips): `politician` (elected: MP, candidate, mayor, councillor, MEP, president),
`executive` (cabinet, dep-minister, agency head, governor, ambassador), `magistrate`, `ngo`,
`donor`, `company` (TR officer/owner — the neighbour type on a person host), `ds`, `sanctions`,
`regulator`, `media`, `professional`, `other`.

| source key | facet | dataset | state | tier |
|---|---|---|---|---|
| `mp` | politician | MPs (parliament.bg) | LIVE | core |
| `candidate` | politician | NS candidates (CIK) | LIVE | core |
| `local` | politician | local mayors & councillors | LIVE | core |
| `official_exec` | executive | officials — cabinet/dep-min/agency/governor | LIVE | core |
| `official_muni` | politician | officials — municipal (mayor/dep-mayor/chair/councillor/architect) | LIVE | core |
| `tr` | company | TR company officers/owners | LIVE | core |
| `magistrate` | magistrate | magistrates (ИВСС чл.175а) | LIVE | core |
| `ngo` | ngo | NGO board members | LIVE | core |
| `donor` | donor | ЕРИК campaign-finance donors | LIVE | core |
| `ds` | ds | **ДС / COMDOS** (Комисия по досиетата, dossier.bg) | NEW | T1 |
| `sanctions` | sanctions | US Magnitsky/OFAC + EU sanctions (BG designees) | NEW | T1 |
| `regulator` | regulator | ВСС, Конституционен съд, БНБ УС, КЕВР, КФН, СЕМ, КЗК, Сметна палата одитори, Омбудсман | NEW | T1 |
| `mep` | politician | MEPs (Bulgarian members of the EP) | NEW | T2 |
| `president` | politician | Presidents / Vice-presidents | NEW | T2 |
| `historic_mp` | politician | pre-2005 MPs (completes the elected spine) | NEW | T2 |
| `media` | media | media-ownership declarations (чл.7а ЗЗДПДП, Мин. на културата) | NEW | T2 |
| `professional` | professional | нотариуси, ЧСИ, синдици (public-trust registers) | NEW | T2 |
| `diplomat` | executive | ambassadors / heads of mission | NEW | T3 |
| `academic` | other | БАН / university rectors | NEW | T3 |
| `honours` | other | state-honours recipients | NEW | T3 |
| `concession` | company | concession holders | NEW | T3 |

**Why the Tier-1 new sources first** (value-to-effort for a political-accountability product):
- **ДС / COMDOS** is the single highest-signal new dataset — official state verdicts naming State
  Security collaborators who held public office (MPs, mayors, magistrates, bankers, media, rectors).
  Semi-structured HTML/PDF решения, matched to existing people by name+role. Defamation posture is
  EASIER than inference elsewhere: these are official findings, not our guess. Candidate for a
  standalone ingest spike. Its facet (`ds`) is the "just ДС" filter the owner called out for §8.
- **Sanctions** — small, authoritative, name+DOB keyed; high graph relevance.
- **Regulators / independent bodies** — small curated rosters; the "кой решава" layer.

`public_policy` per source feeds the §6 privacy gate (e.g. `donor` = no public page for private
small donors; `ds`/`mp`/`official_*` = public figure).

### 5a. LLM-assisted reconciliation skill (the review queue's force multiplier)

The aggressive-merge policy fills the review queue (heavily, thanks to §2a's 2-part names). Hand-
adjudicating every ambiguous link doesn't scale — so add an **LLM-backed research skill** that turns
"is this person really linked to this company/person?" from a manual web-search into a queued job
that returns citations for a human to confirm. It NEVER auto-promotes.

**`reconcile-person-link` skill — flow:**
1. Input: a review-queue item — a `person` + a candidate `subject` (`company:{eik}` or another
   `person`), plus the folded/structured names and the roles involved.
2. The skill runs targeted web research — queries like `"депутат {name} фирма {company}"`,
   `"{name}" "{company}"`, `"{name} свързан с {company}"`, `"{name} собственик"` — via the
   web-search/fetch tools.
3. For each promising hit it extracts a one-line `claim`, the `url`, `outlet`, and a short verbatim
   `excerpt` (≤ 25 words, per the copyright rule), and writes a `person_link_evidence` row with
   `found_by='llm-research'`, `verdict='unreviewed'`.
4. A human reviews the evidence in the adjudication view and sets `verdict` +
   (`person_link_override` merge/split). Only a human promotes `review → active`.

**Hard guardrails (these are non-negotiable, from the safety rules + the site's posture):**
- **Web content is DATA, not instruction.** The skill treats fetched article text as evidence to
  quote, never as commands; an article that says "merge these" or "this person also owns X" is a
  claim to store with its URL, not an action to take. No auto-merge from page content.
- **Articles are a LEAD, not proof.** Evidence raises a link's *reviewability*, not its truth. The
  person page shows confirmed evidence as **cited sources** (outlet + link) beside the existing
  "трейс, не доказателство" disclaimer — journalism-grade sourcing, not an accusation by the site.
- **Provenance is mandatory** — every row carries `url` + `retrieved_at` + `outlet`; no naked claims.
- **Deterministic identity still wins.** The LLM never sets `confidence`/`status` directly; it only
  produces `person_link_evidence` that a human weighs. The resolver stays deterministic.

Nice side effect: confirmed evidence becomes a public **"in the news" / sources** block on the person
page — a real feature, not just internal plumbing.

---

## 6. Risks & open questions

- **Privacy / who gets a public `/person` page** (`is_public_figure`, default OFF). Public pages are
  minted only for: elected/appointed office holders (datasets 1–5, 7), and persons whose link to
  public money is itself public (company officers/owners that hold or bridge to office, NGO board
  members that surface a signal). **Private small donors and unconnected TR officers get NO public
  page** — they exist only as internal rows / aggregate counts. This is a GDPR + defamation gate and
  needs a legal-tone review before Phase 3.
- **Resolver scale.** ~20–40k materialized persons blocked by `(given_fold, family_fold)`; never
  all-pairs. `namesake_risk` computed once from `officer_name_counts`. EXPLAIN ANALYZE the
  worst-case common-name block.
- **Parity/audit harness (required).** Ship `scripts/person/parity_check.ts` (vs `person_profile()`)
  + a namesake-collapse audit that samples merged clusters and flags any `active` merge lacking a
  corroborant. Precedent: the awarder group-model parity script (`reference_awarder_group_model`).
- **Defamation on aggressive merge.** Mitigated by `status='review'` gating + the public rule in §3.
- **Slug stability across re-clustering.** Seed from MP id; persist assigned ids; never renumber an
  `active` person. Splits mint a new id, never reuse.
- **Normalizer migration.** Retiring `normName`/`normKey` into `translit_bg_latin` may shift a few
  existing matches — parity-diff before/after in Phase 1.
- **Party canonicalization.** `person_role.party` references the site's party `canonicalId`, not
  free text, so the person page party colours match the rest of the site.
- **Birth_date coverage is thin** (MP profiles + some declarations) — a corroborant when present,
  never required.
- **Open: EIK crosswalk for regulators** (same as water/judiciary packs — sources give names, joins
  need EIK/id). Hand-curated TS constant per the `vssReferenceData.ts` pattern.

---

## 7. Testing & verification

Testing runs on the **repo-wide Vitest standard** (see
[docs/testing-standards.md](../testing-standards.md); Playwright keeps the E2E/SEO/perf layer). Put
the resolver tests under `scripts/person/**` as co-located `*.test.ts` and run them with
`npm run test:person` (already wired to `vitest run --passWithNoTests scripts/person`). They land in
the `node` Vitest project, use committed `__fixtures__/`, and — like the rest of the pipeline's
pure-logic tests — never touch Postgres. Two test bodies: (7a) resolver correctness, (7b) migration
safety. Both must be green before any page flips its hook to `/api/db`.

### 7a. Name-matching / person-finding tests (the "expensive" ones — the core)

The resolver is where a bug becomes a false accusation, so it gets a **labeled gold-set + metrics
gate**, not just spot checks.

- **Gold-set fixture** — `scripts/person/__fixtures__/gold_pairs.json`, hand-labeled, ~300–500 pairs,
  committed. It must deliberately cover the hard cases:
  - **True cross-source identities** (label=same): an MP who was later a mayor; a magistrate who owns
    a TR company; a cabinet member who was a candidate; a councillor who is a TR officer.
  - **Hard negatives** (label=different): known distinct namesakes — two real "Георги Иванов" who are
    different people; a 2-part donor name that is NOT the famous 3-part person who shares it.
  - **2-part↔3-part cases** (§2a) — the donor/local scenarios, both the ones that DO resolve (with a
    corroborant) and the ones that must NOT.
  - **Transliteration/patronymic variants** that must merge (Cyrillic vs Latin, patronymic present
    vs absent on the same real person).
- **Metrics + thresholds (the gate), computed against the gold-set:**
  - **False-merge rate on the public surface (`active` + high confidence) must be 0.** This is the
    hard fail — one false public merge is an accusation. No threshold, it's zero.
  - Precision / recall / F1 on all merges, tracked over time; recall may live partly in the review
    queue (that's fine — review isn't public).
  - Review-queue size and its recall (how many true pairs we correctly *held* vs wrongly auto-merged).
  - A test that asserts **no 2-part name reaches `active`+high on the fold alone** (§2a rule 4).
- **Determinism / idempotency test** — run the resolver twice over the same fixtures; assert
  identical `person_id`→cluster assignment and identical slugs (slug-stability guarantee from §3).
- **Namesake-collapse audit** (also runs in prod data, not just fixtures) — sample `active` merged
  clusters, flag any lacking a corroborant; part of `scripts/person/parity_check.ts`.
- **Pure-matcher unit tests** — the name parser (`(given, patronymic?, family)`), the blocking-key
  builder, and `translit_bg_latin` parity vs the retired `normName`/`normKey` run hermetically on
  fixture strings, no DB needed — fast, run on every commit.
- Regression rule: a resolver change that drops F1 below the last committed baseline, or produces any
  public false-merge, FAILS `npm run test:person`.

### 7b. Migration safety — no data loss, no UI break

Every JSON→PG migration (§4a) passes three gates, per dataset, before the page flips:

1. **Coverage / no-data-loss reconciliation.** Assert every source JSON record produced a
   `person_role` row: `count(candidates.json rows) == count(person_role where source='candidate')`,
   zero orphans, zero silent drops. Per-dataset row-count + a content checksum (e.g. set of
   `(name, party, oblast)` tuples in == out). A drop fails the gate.
2. **Serving parity diff.** For each page that will flip, generate the page's data payload the OLD
   way (from JSON) and the NEW way (from `/api/db` / `person_payloads`) for a sample of entities
   (all MPs + a random N of candidates/officials/local), and assert a field-level diff of ONLY the
   intended additions — everything the page already showed must be byte-identical. Precedent: the
   awarder group-model parity script (`reference_awarder_group_model`).
3. **UI smoke via the browser preview** (the explicit ask — candidate page, tiles, tables). Using the
   dev-server preview tools, render BEFORE and AFTER the flip and assert equality on the at-risk
   surfaces:
   - **Candidates list screen** — same number of tiles; a sampled candidate's tile shows the same
     name / party / photo (MpAvatar).
   - **Candidates table** — same row count, same pagination, sort/filter still work; spot-check a
     row's fields.
   - **`/candidate/:slug` page** — resolves for `mp-{id}`, `c-{n}-{slug}`, and a bare-name legacy
     link (the namesake chooser still fires); preference numbers, oblasts, MP linkage unchanged.
   - **Officials** — list + `by_obshtina` shard counts unchanged; a councillor's `candidateLink`
     still renders.
   - **Local election tiles** — mayor/council tiles show the same elected names.
   - **Connections / person edges** — the same edges render, disclaimer intact, no new false edge
     appears at `active` confidence.
   Capture screenshots + console/network error checks as proof (zero new console errors, no failed
   `/api/db` request).

Flip rule (strengthens §4a): a hook moves from `/public/*.json` to `/api/db/*` ONLY when 7b gates
1–3 are all green. Because raw JSON is retained as input, a flip is reversible — point the hook back.

### 7c. What runs when

- Every commit: 7a pure-matcher unit tests + gold-set metrics gate (fast, hermetic).
- Each resolver run (offline): idempotency check + namesake-collapse audit on real data.
- Each dataset migration: 7b gates 1–3 before the corresponding page flip.
- Pre-deploy: the full `parity_check.ts` (person rollup vs `person_profile()`).

---

## 8. Connections component — the primary consumer (prototyped 2026-07-18)

A single reusable `<Connections>` surface that mounts on any entity and renders the identity+edge
layer. Prototyped in three host variants (person, company, contract) plus the interaction model; this
section captures the contract so it can be built (a fuller spec can later split into its own
`connections-component-v1.md`).

**Props / data contract:**
```
<Connections host={{ type, id }} />
  host.type: 'person' | 'company' | 'contract' | 'awarder'
  host.id:   person_id (slug) | eik | unp | eik
```
It calls one endpoint — `/api/db/connections?type=&id=` — returning a **typed graph**:
`{ subject, nodes[], edges[] }` where a node is `{ nodeType: 'person'|'company'|'contract'|'awarder',
key, label, facet, ds, namesakeRisk }` and an edge is `{ to, rel, confidence, path, sourceRefs[],
evidenceCount }`. The graph is entity-typed, NOT person-only: `person_id` identifies person nodes,
`eik` companies, `unp`/`ocid` contracts — so the same component serves all hosts.

**Filters are source-driven and auto-expanding (the owner's ask).** The chip row is generated from
the DISTINCT facets present in the subject's edges, ordered by the §5 catalog: `Всички` + each
populated facet (`Политици`, `Магистрати`, `НПО`, `Дарители`, `ДС`, `Санкции`, `Регулатори`, …).
Because ДС / sanctions / regulators are just `person_role` sources with a facet, **the moment those
datasets land, their chip appears** with no component change. Overflow facets collapse behind a "още"
chip; `ДС` is always shown when present ("just ДС" is one click).

**Confidence encoding** maps the `person_role.confidence` enum to visuals: `exact_id`/`high` →
solid line + "потвърдена" chip; `medium` (the review-promoted / bridged tier) → dashed line +
"трейс" chip. `review`/unpromoted never render (public-surface rule, §3). ДС-flagged nodes carry a
red ring + badge regardless of tier. Every inferred edge keeps the "трейс, не доказателство"
disclaimer.

**Evidence** — an edge's `evidenceCount` comes from confirmed `person_link_evidence` rows (§5a); the
row surfaces "N източника" linking to the cited outlets. This is the journalism-grade differentiator.

**Interaction model (prototyped):**
- **Graph cap + покажи още** — graph shows the top ~6–8 nodes by confidence; the remainder park
  behind a "+N" node (expands the graph) and the list caps at 5 with a "покажи още / свий" toggle.
  No entity, however connected, renders an unreadable hairball.
- **Click-to-expand-one-hop** — nodes with their own edges carry a `+` badge; clicking fans out that
  node's next hop as dashed satellites (capped at ONE hop so it can't run away). Guarded by the
  namesake cap so a common-name node doesn't explode.
- **Mobile collapse** — below a `useMediaQuery` breakpoint the radial graph is hidden and only the
  ranked list renders (a graph is unusable at 375px). The list is also the screen-reader equivalent,
  so this doubles as the a11y fallback.

**Mount points:** `/person/{slug}` (Phase 3), `/company/{eik}` (replaces `CompanyConnectionsSection`),
`/awarder/{eik}`, and contract rows on `/procurement/contracts` (the "why is this flagged" panel).
The existing `CompanyConnectionsSection.tsx` + `company-connections-stats.json` path is the thing this
generalizes and eventually retires.

**a11y:** the graph gets a visually-hidden list mirror (the mobile list serves double duty); nodes are
focusable/tabbable; the disclaimer is in the accessible name of the region.
