# 443 unlicensed tr/ngo roles — the licence decayed under a correct attachment

**Status:** **implemented 2026-08-25, all five steps.** §5's recommendation (option A + B) is
built: the licence is recorded on the role at attach time, the gate checks the stored fact,
and a separate freshness gate reports the drift. §7 stands — no data repair was needed.

The one thing that remains OPEN and is nobody's default: **the columns are NULL until the
next `db:resolve:persons`**, because 081 ships no backfill by design. Until then the licence
gate SKIPS (with a distinct, actionable reason) and the freshness gate carries the signal from
the attached footprint instead. On Cloud SQL nothing has been applied at all.
**Gate:** `scripts/db/tests/person_resolve.data.test.ts` → `every tr/ngo role is a licensed bridge (A, B or V)`
**Measured:** 2026-08-25, local Postgres (5433), `main` at `2d91593523`.

⚠️ **Shipping step 1 needs one command, and nothing runs it automatically.** `082_person_api.sql`
is applied-never-loaded — its only automated applier is `resolve_persons.ts`'s `SCHEMA_FILES`,
i.e. a multi-hour `db:resolve:persons[:cloud]` rebuild — so a serving database keeps emitting
an `ngos` payload with no `linkBasis` until someone applies it by hand:

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg \
  npx tsx scripts/db/apply_functions.ts 082_person_api.sql
```

then `npm run deploy` for the bundle. **No `deploy:db` is required** — `/api/db/person-profile`
returns `person_by_slug`'s jsonb verbatim (`functions/db_routes.js`, `body: rows[0]?.r ?? null`,
no key stripping), so the new key flows through unchanged; and `person_by_name` delegates to
`person_by_slug`, so the legacy `/person/{name}` entry path gets the identical payload rather
than a second, basis-less one. On a cold database, apply `148_person_company_basis.sql` first —
082's body reads `person_company_bridge_a` and is validated at CREATE.

It fails **safe** while unapplied (absent basis → `isNameMatch` → every seat marked and
caveated), so the cost of forgetting is that the 57 genuinely register-confirmed seats stay
wrongly caveated — not that anything is over-claimed.

### What landed, step by step

| step | commit | what |
| --- | --- | --- |
| 1 | `db83ea49` | 082 emits `linkBasis` for `ngos`; `PersonNgoSeats` + shared `NameMatchDisclosure`; the AI tool qualifies its fact key |
| 2 | `623d45c0` | `person_role.bridge` / `bridge_footprint` (081), no backfill; constraint semantics gated by insertion |
| 3 | `b7447a5b` | all three writers stamp the licence at attach time; static copyRows gate (the only CI-visible one) |
| 4 | `8106e014` | the licence gate reads the stored fact + the same-vintage identity-class half; skips on an unstamped corpus |
| 5 | `—` | `person_role_bridge_freshness.data.test.ts` — the drift measurement, thresholded on the share over the cap |

**The `FOOTPRINT_CAP` was not touched**, and neither bridge was widened. Nothing was repaired
in the data: every one of the 443 roles was correctly licensed when attached, and re-resolving
would DELETE the 58 Tier-V people behind most of them (their folds now measure 6–11, so they
would not be minted), which is a worse outcome than the drift.

```bash
PGPASSFILE=$PWD/.pgpass npx vitest run scripts/db/tests/person_resolve.data.test.ts
```

**As first observed on 2026-08-25, before step 4:**

```
AssertionError: found an unlicensed tr/ngo role
443 !== 0
```

Consistent — alone and in the full suite. Not the load-flakiness class.

⚠️ **That is a historical transcript, not the gate's current output.** Since step 4 the licence
gate reads the stored fact and SKIPS on a corpus no resolve has stamped, and the drift it used
to mis-report as 443 red roles is published by the freshness gate instead: *82,247 licensed
people; 687 drifted upward; 63 now over FOOTPRINT_CAP=5 (0.077%, threshold 1.0%)*.

---

## 0. The one-paragraph answer

The resolver did nothing wrong. **Every one of the 443 roles was licensed when it was
attached, and the licence expired underneath it two days later.** All 443 fail exactly one
clause — the `FOOTPRINT_CAP` (≤ 5 companies under the name fold) — and that clause is
recomputed at TEST time against `tr_officers` / `tr_person_roles`, which
`npm run tr:daily-refresh` TRUNCATEs and reloads on its own schedule. `person_role` was
written **2026-08-22 18:56 UTC**; the TR corpus was reloaded **2026-08-24 22:20 UTC**. The
63 affected folds gained a company in that reload and crossed from 5 to 6.

It **is** user-visible, on five surfaces including a prerendered indexed `/person` page and a
sitting MP's connection edge on a company page — see §3.

The recommendation is **option 3: record the licence on the role at attach time**, so the
gate checks a stored fact instead of recomputing a moving one. §5 argues why; §6 specifies
the gate; §7 says no data repair is needed and why.

---

## 1. Evidence

### 1.1 The breakdown

Re-derived from the gate's own query, grouped by `person` attributes:

| source | is_public_figure | identity_confidence | name_parts | roles | people |
| --- | --- | --- | --- | ---: | ---: |
| tr | false | verified | 3 | 274 | 40 |
| tr | false | shared_name | 3 | 135 | 18 |
| tr | true | resolved | 3 | 29 | 5 |
| ngo | true | resolved | 3 | 5 | 2 |

**443 roles, 63 distinct people, 291 distinct companies.** The two public-figure rows overlap
(persons 20450 and 50838 hold both `tr` and `ngo` roles), so the public group is **5 people /
34 roles / 23 companies**, and the private group is **58 people / 409 roles**.

Denominators: the whole tr/ngo layer is **199,558 roles / 83,301 people / 87,148 companies**.
The failure is 0.22% of roles and 0.076% of people.

### 1.2 One clause fails, and it is the same clause in both groups

Decomposing Bridge V clause by clause over the 409 private roles:

| clause | roles failing |
| --- | ---: |
| `name_fold ~ '^[a-z]+ [a-z]+ [a-z]+$'` | 0 |
| `identity_confidence IN ('verified','shared_name')` | 0 |
| money-linked (`contracts ∪ agri_subsidies ∪ fund_beneficiaries`) | 0 |
| exact-entity row in `tr_person_roles` | 0 |
| **`count(DISTINCT tr_officers.uic) BETWEEN 1 AND 5`** | **409** |

Footprint distribution for those 58 people — every one is *just over* the cap:

| current fold size | people | roles |
| ---: | ---: | ---: |
| 6 | 50 | 362 |
| 7 | 4 | 24 |
| 8 | 1 | 8 |
| 10 | 2 | 9 |
| 11 | 1 | 6 |

The 5 public figures fail Bridge B, and they fail the *same* clause. Every other guard holds:

| person_id | slug | other persons on fold | `tr_name_fold_people.people_n` | `tr_person_roles` uics now | stored EIKs |
| --- | --- | ---: | ---: | ---: | ---: |
| 15297 | `galin-nenov-1ig72k` | 0 | 1 | **6** | 5 |
| 20450 | `iliya-petrov-raev-4c6162` | 0 | 1 | **6** | 5 |
| 44607 | `plamen-ivanov-96uzca` | 0 | 1 | **6** | 5 |
| 50838 | `stanislav-stoilov-iordanov-a4b00f` | 0 | 1 | **6** | 4 |
| 61750 | `vladimir-stoyanov-1sbcw1` | 0 | 1 | **6** | 5 |

People-uniqueness holds (0 other persons on the fold). Registry-uniqueness holds
(`people_n = 1` — the Commerce Registry itself says one person). Only the cap fails.

### 1.3 Concrete examples

**Private, `verified` — НИКОЛАЙ ДИМИТРОВ РАДЕВ** (`nikolay-dimitrov-radev-884b6b`,
`fold_people_n = 1`). Five companies attached; a sixth appeared:

| EIK | company | roles | `changed_at` | attached |
| --- | --- | --- | --- | --- |
| 207189452 | Миленагро | manager, sole_owner | 2024-02-09 | ✅ |
| 207129697 | ГЛОБАЛ ПЛАТИНУМ ГРУП | manager, partner | 2023-01-05 | ✅ |
| 206946365 | ГРИЙН ФАРМ ГРУП | manager, partner | 2022-12-02 | ✅ |
| 207004590 | ГРИЙН ФАРМ ДРИЙМ | manager, sole_owner | 2022-07-06 | ✅ |
| 202277140 | ЙОН ВЕНДИНГ | manager, sole_owner | 2012-10-19 | ✅ |
| **148107194** | **РЕЙН 2006** | **partner** | **2026-08-21** | ❌ |

He was entered as a partner in РЕЙН 2006 on **2026-08-21**; the filing reached our corpus in
the 2026-08-24 TR reload. The fold went 5 → 6 and all five *correct* attachments became
"unlicensed". Note РЕЙН 2006 is an old 9-digit EIK — the *company* is not new, the *filing*
is. That is why an `ingest_first_seen`-based split of the population is wrong (§1.5).

**Public figure — Владимир Веселинов Стоянов** (`vladimir-stoyanov-1sbcw1`, a `candidate`).
Attached: Ауто Профи Трейд, Е КАР ИМПОРТ, Про Клийн Пловдив, Чисти килими, ФРЕШ КЛИЙН
БЪЛГАРИЯ. The sixth is **ПРО КЛИЙН СОФИЯ (208922142)**, registered **2026-08-21** — a company
whose name is the Sofia sibling of the Пловдив one already on his page. The 6th arrival is
almost certainly *the same person expanding*, and it is what un-licensed the other five.

**Private, `shared_name` — Димитър Стоянов Иванов** (`dimitar-stoyanov-ivanov-b2558f`,
`fold_people_n = 6`). This is the sub-case where the gate's complaint has real substance: the
Commerce Registry records **six** people under this fold, so the ≤5 cap was the *only*
discriminator standing between one profile and six strangers' companies — and it is now
failing. The 6th company (Посейдон - село Лесново, `ngo_board`, `changed_at` 2024-05-08)
arrived through widening officer coverage, not a new registration.

### 1.4 The measurement that settles resolver-vs-decay

**Across the entire non-Bridge-A tr/ngo layer, no person holds more than 5 distinct EIKs:**

| stored distinct EIKs (excluding Bridge-A refs) | people |
| ---: | ---: |
| 1 | 52,845 |
| 2 | 16,653 |
| 3 | 7,127 |
| 4 | 3,610 |
| **5** | **2,012** |
| 6+ | **0** |

The distribution stops dead at `FOOTPRINT_CAP`. `FOOTPRINT_CAP` is imported by both the
resolver and the gate from `scripts/person/bridgeB.ts` — one definition, not two — and the
resolver's mint gate is a hard `HAVING … count(DISTINCT o.uic) <= 5`. A fold measuring 6+ at
resolve time would have produced **no person and no roles at all**, not five roles.

So option (4) — "the 443 are genuinely wrong and should never have been attached" — is
**refuted at the population level, for both groups**. Every affected person holds 2–5 stored
EIKs against a current fold of 6–11.

Timeline:

| event | timestamp (UTC) | evidence |
| --- | --- | --- |
| `person` / `person_role` rebuilt | **2026-08-22 18:56:24** | `min(created_at) = max(created_at)` over all 133,727 rows |
| `tr_companies` / `tr_officers` / `tr_person_roles` reloaded | **2026-08-24 22:20–22:22** | `pg_stat_user_tables`; `ingest_first_seen` batch 3340 |
| `tr:daily-refresh` completed | **2026-08-24 22:25:05** | `state/ingest/tr-daily-refresh.json` — *"1,022,592 companies (1,885 new) + 881,744 officers"* |
| `contracts` reloaded | 2026-08-24 22:36–22:38 | `pg_stat_user_tables` |
| `magistrate_company` | 2026-08-25 01:50 | `pg_stat_user_tables` |

Nothing re-ran `db:resolve:persons` after 2026-08-22.

### 1.5 ⚠️ Two probes that look decisive and are not

- **`ingest_first_seen` cannot split the population.** Of the 99 (person, extra-company)
  pairs, only **23** have a `tr_company` first-seen after the resolve. That does *not* mean
  the other 76 were already over the cap — `ingest_first_seen` records newly-seen
  **companies**, so it is blind to a fold gaining an *officer row* at a company that already
  existed, which is the ordinary way a footprint grows in a full TR reload (РЕЙН 2006 above
  is exactly that). The §1.4 stored-footprint argument overrides it.
- **`person.fold_people_n` shows zero drift, and that is not reassurance.** All 133,727
  stored counts still equal `tr_name_fold_people.people_n`. That is because
  `tr_name_fold_people` is loaded from the **committed** `data/person/tr_name_fold_people.tsv`
  (last regenerated **2026-08-12**, by `npm run tr:count-people` on a machine with the 15 GB
  feed), and `tr:daily-refresh` does not touch it. It is frozen, not stable.

---

## 2. Root cause

**The licence decayed underneath a correct attachment.** Not a resolver defect.

The structural cause is that **Bridge B's three guards run on three different clocks**, and
`person_role` runs on a fourth:

| guard | reads | rebuilt by | last moved |
| --- | --- | --- | --- |
| people-uniqueness | `person` | `db:resolve:persons` | 2026-08-22 |
| registry-uniqueness | `tr_name_fold_people` | `db:load:tr-name-fold-people:pg` (committed TSV) | 2026-08-12 |
| **`FOOTPRINT_CAP`** | **`tr_officers` / `tr_person_roles`** | **`db:load:tr:pg`** | **2026-08-24** |
| the roles themselves | `person_role` | `db:resolve:persons` | 2026-08-22 |

Bridge V is the same shape: money-linkage reads `contracts` / `agri_subsidies` /
`fund_beneficiaries` (contracts reloaded 2026-08-24), and the cap reads `tr_officers`.
Bridge A reads `magistrate_company` (2026-08-25) and `company_politicians` (rebuilt by
`db:load:tr:pg`).

`tr:daily-refresh` is
`daily_refresh.ts && db:load:tr:pg && db:load:cr-founding:pg && db:load:cr-nkid:pg &&
db:load:graph:pg && db:load:tr-company-place:pg`. It deliberately does **not** re-resolve —
`db:resolve:persons` is ~37 minutes plus a mandatory repair chain. So **every TR refresh
guarantees some decay**, and the count grows monotonically until the next resolve.

**Recurrence sizing.** Of the 82,247 people in the non-Bridge-A tr/ngo layer:

- **63** are already over the cap (this failure);
- **2,129** sit exactly *at* the cap — one new filing under the fold decays each of them;
- 3,721 sit at 4.

One TR reload spanning ~2 days moved 63 of the 2,129 boundary people (~3%). This gate will
go red again within days of every TR refresh. It has been red since 2026-08-24 22:20 and
nobody noticed until 2026-08-25, because **CI cannot see it**: `.github/workflows/test.yml`
runs `npm run test:unit` with no Postgres, and the gate auto-skips. It only ever fires on a
developer machine with a loaded local database.

⚠️ **A related latent divergence, currently not biting.** The Tier-V *mint* caps on
`tr_officers` while the Tier-V *attach* joins `tr_person_roles` (the full-history table).
Measured over all 68,662 Tier-V folds: `tpr_n > off_n` for **0**, and 0 folds where
`tpr_n > 5 AND off_n <= 5`. So the two tables agree exactly today. Do not rely on it — the
gate mirrors the mint's table and the attach uses the other one, and if they ever diverge the
resolver will over-attach and the gate will not see it.

---

## 3. Is it user-visible? Yes — five surfaces, one of them prerendered and indexed

Answered up front because it sets the severity, and the severity is **not cosmetic**.

| surface | reach | measured |
| --- | --- | --- |
| `person_by_slug()` (082) → `/person/:slug` | **all 63** | e.g. `vladimir-stoyanov-1sbcw1` returns 5 named companies, each `linkBasis: "name_match"` |
| `person_browse_table` (120) → `/persons` | **all 63**, `companies_n` 1–5, `tr_link_basis = 'name_match'` | direct join |
| `person_search` (126) | **all 63** (`key = 'slug:…'`, tiers P and V) | direct join |
| `graph_person_node` / `graph_edge` (128/129) → `/connections` | **all 63 nodes, 447 edges** | direct join |
| `company_political_links()` (158) → `/company/:eik` | yes — see below | function call |
| `place_mp_companies()` (151) → governance place pages | **20 companies across all 5 public figures** | function call on VAR06 |
| `mp_tr_roles()` (150) → `/api/db/mp-management` | **no** — none of the 63 holds an `mp` role | direct join |
| prerendered `/person` HTML + sitemap | **1 of the 63** (`iliya-petrov-raev-4c6162`, `prerender: true, indexable: true`) | `data/person/prerender_slugs.json` |

CLAUDE.md names 150 and 151 as the two that "refuse a shared name rather than grading it".
**150 is clear. 151 is not** — it renders 20 of the 291 companies.

### 3.1 The worst instance

`company_political_links('203581032')` — the political-links tile on
`/company/203581032` (АКАДЕМИЧЕН ПАРК 2020 ХОЛИДЕЙ) — returns:

```json
"direct":  [{ "name": "Илия Петров Раев", "office": "Изпълнителна власт",
              "officeRole": "civil_society", "linkBasis": "name_match" }],
"bridged": [{ "name": "Илин Павлинов Димитров", "slug": "mp-5067",
              "office": "Народни представители",
              "viaCompany": "СДРУЖЕНИЕ \"ВАРНЕНСКА ТУРИСТИЧЕСКА КАМАРА\"",
              "bridgeName": "Илия Петров Раев", "bridgeCompanies": 6 }]
```

A **sitting MP's** connection edge on a company page runs *through* one of the unlicensed
roles. And the payload prints `"bridgeCompanies": 6` — the very number that says the licence
no longer holds — while still drawing the edge.

Same person's `/person/iliya-petrov-raev-4c6162` is **prerendered and indexable**, and names
four organisations from unlicensed roles, including **Сдружение "Български Червен кръст"**.

### 3.2 The mitigation that is present, and the one that was missing

Every one of the 291 companies renders with `linkBasis: 'name_match'`, which the UI shows as
a small amber „по име" chip (`LinkBasisMark`), **and** the „Фирми" block's footer caveat
(`person_namesake_disclosure`) renders for public figures too — `PersonCompanies` gates it on
`companies.some(isNameMatchCompany)`, not on `is_public_figure`. So the companies half was
already covered, and an earlier draft of this section was wrong to say otherwise.

The identity CARD in `PersonProfileScreen` is separate and its `isPublicFigure === false`
gate is correct: a Bridge-B public figure's *identity* is cross-source resolved, so
„Самоличността е по съвпадение на име" would be a false statement about them. What rests on a
name is the *company attachment*, and that is what the chip and the footer already say.

⚠️ **The real gap was the NGO block, and it was wider than the 443.** 082 emitted no
`linkBasis` on the `ngos` payload at all, and `PersonProfileScreen` rendered those rows with
no mark and no caveat — directly beneath a companies list that marked every row of its own.
Measured 2026-08-25: **5,670 of 5,727 board seats, across 4,887 of 4,927 people**, rest on a
folded name; only 57 seats are register-confirmed. So the prerendered Раев page named
ВАРНЕНСКА ТУРИСТИЧЕСКА КАМАРА and two others with nothing qualifying them.

**Closed 2026-08-25** (step 1 of this plan): 082 emits `linkBasis` for `ngos` from the same
`person_company_bridge_a` view the `companies` arm uses; the block became `PersonNgoSeats`
and carries the same `LinkBasisMark` and the shared `NameMatchDisclosure`. On Раев's page
that correctly splits his four seats — Червен кръст comes back `declared` (his own
`official_exec` filing confirms it) and the other three are marked „по име".

### 3.3 What is NOT wrong

The rendered content is the **stored 5 companies** — the set the resolver licensed. The 6th
company is *not* attached and does not render. So no page currently shows a company the
resolver never approved. In the sampled cases the attributions look *correct*
(Про Клийн Пловдив + ПРО КЛИЙН СОФИЯ; Раев's Червен кръст seat is corroborated by his own
`official_exec` filing). The defect is that **we can no longer prove they are correct** by the
rule we published them under — and for the 18 `shared_name` people (169 roles,
`fold_people_n` 2–6) the proof was the only thing separating one profile from several
strangers.

---

## 4. Which of the four framings this is

The prompt asked which of four this is. It is **(3), with (1) as a strictly weaker fallback**:

1. *Evaluate the gate against the corpus vintage the resolve saw* — the corpus vintage is not
   recoverable. `tr_officers` is TRUNCATE-and-reload with no history and no `first_seen`, and
   `ingest_first_seen` is blind to officer-row arrivals (§1.5). There is nothing to evaluate
   against. This can only ever be approximated by (3).
2. *Re-derive the roles whenever their licensing inputs move* — correct in principle and
   operationally unacceptable: it makes a ~37-minute resolve plus the whole documented repair
   chain (declarations phase 1 + phase 2, council re-attach, persons-browse, person-search,
   graph, agri-hub-stats, tr-company-place) a downstream dependency of *every* TR refresh,
   contracts reload, agri reload and funds reload. And because `person_id` is a positional
   ordinal that a resolve reassigns (26.3% of ids re-point at a different human per CLAUDE.md),
   each of those becomes a corpus-wide identity churn event.
3. **Record the licence on the role at attach time.** ✅
4. *The 443 are genuinely wrong* — refuted, §1.4.

---

## 5. Options

### Option A — record the licence on `person_role` (recommended)

Add two columns written by the resolver at attach time:

```sql
ALTER TABLE person_role
  ADD COLUMN IF NOT EXISTS bridge text,          -- 'A' | 'B' | 'V'
  ADD COLUMN IF NOT EXISTS bridge_footprint int; -- fold size the cap was evaluated against
ALTER TABLE person_role ADD CONSTRAINT person_role_bridge_check
  CHECK (bridge IS NULL OR bridge IN ('A','B','V'));
```

The gate then asserts a **stored** fact — every tr/ngo role carries a `bridge`, and
`bridge_footprint <= FOOTPRINT_CAP` — which is time-invariant. Drift becomes a **separate,
non-blocking** measurement (§6.2).

- ✅ The invariant becomes stable. It stops being a function of when you last ran a loader.
- ✅ It makes the licence *auditable*: today "why does this page show this company" is
  answerable only by re-running the bridges. `bridge` also refines `linkBasis`, which
  currently collapses Bridge B and Tier V into one `name_match` value.
- ✅ `bridge_footprint` gives the freshness measurement a *stored baseline*, so
  `current_footprint − bridge_footprint` is a real drift number rather than a recomputation.
- ⚠️ **The columns must be in `resolve_persons.ts`'s `copyRows` list**, or a resolve silently
  returns them to NULL corpus-wide with nothing erroring — the exact `date_basis` failure
  class 081 documents. The gate must therefore assert `bridge IS NOT NULL` for the whole
  tr/ngo set, not just for a sample.
- ⚠️ Bridge A is not attached by a single statement — it arrives through the ordinary role
  COPY, so stamping `bridge='A'` needs care. The cheap correct spelling is to stamp `B` and
  `V` on their two INSERTs, then a final `UPDATE … SET bridge='A' WHERE bridge IS NULL AND
  ref IN (bridge-A set)` inside the same transaction, and let the gate fail on any residual
  NULL.
- ⚠️ It does **not** answer "is this attribution still safe today". It answers "was it
  licensed when made". That is the right question for a *gate* (§6.1) and the wrong one for
  an *operator*, which is why A must ship with B.

### Option B — a separate, non-blocking staleness measurement

A second gate (or a loader-side report) that measures how far the current corpus has moved
from the licences on file, and fails only past a threshold that means "the person layer is
too old to serve" rather than "one fold gained a company".

- ✅ Keeps the real signal — "the person layer is 3 days behind the TR corpus" — visible.
- ✅ Cheap. No resolve, no schema beyond Option A.
- ⚠️ A threshold is a judgement call and must be argued from what it makes true, not from
  what it makes green. §6.2 proposes deriving it from the *stored* footprint rather than
  picking a number.

### Option C — re-resolve on every licensing-input reload

Rejected: §4(2).

### Option D — freeze the licence inputs (snapshot `tr_officers` fold counts at resolve time)

Write a `person_fold_footprint(name_fold, n_uic, measured_at)` table at resolve time and have
the gate read it instead of `tr_officers`.

- ✅ No `person_role` schema change.
- ⚠️ It is Option A with worse ergonomics: a per-fold snapshot is a *third* table on a
  *fourth* clock, and it is one more thing a resolve can silently fail to write. The licence
  belongs on the role it licenses.
- ⚠️ It cannot express Bridge A at all.

### Option E — widen the bridge / raise `FOOTPRINT_CAP`

**Explicitly rejected, and not because it is against the constraints.** It is the wrong
diagnosis: the cap is not too tight, it is being *re-evaluated at the wrong time*. Raising it
to 6 turns the 63 red roles green and moves the boundary out by exactly one — the 2,129 people
now sitting at 5 become interior and the 3,721 at 4 become the next tranche — so the gate goes
red again at the next TR refresh, with a weaker guard. It also changes *what we publish*: a
resolve at cap 6 mints a materially larger Tier-V population, which is a decision about whose
companies appear on a page and would have to be argued on that basis, not on this one.
CLAUDE.md records `COMMON_NAME_TR_ROWS = 11` being deleted rather than ported for the same
reason — a threshold must be argued from what it makes true.

### Recommendation

**A + B.** Ship the stored licence, then the drift measurement. Do not touch `FOOTPRINT_CAP`.

Sequencing note: A is inert until a resolve runs, and a resolve is the ~37-minute job plus the
repair chain. So the useful order is: land the schema + resolver change, land the gate change
**with a skip-and-report arm for a corpus whose `bridge` column is entirely NULL** (the
`held_scope` / `table_num` pattern — "the corpus has no provenance yet" must never read as
"the rule is enforced"), then re-resolve at the next scheduled opportunity.

---

## 6. The gate

### 6.1 The existing gate is asking a question it cannot answer

`every tr/ngo role is a licensed bridge (A, B or V)` recomputes a **time-dependent** predicate
over four independently-reloaded tables and compares it to a snapshot written by a fifth
process. It is not asserting an invariant; it is asserting that two corpora are the same
vintage. That assertion is false by construction on any machine that has run
`tr:daily-refresh` since its last resolve — which, on a machine following the documented
daily pipeline, is every machine, every day.

Two consequences:

- **It is red-by-default and therefore unread.** This is precisely the failure the test's own
  header warns about — *"A red gate nobody can fix is a gate nobody reads, which is the real
  danger here: this is the defamation-sensitive invariant on the whole TR layer."* It was
  written about the 2026-08-02 Bridge-V omission; it now describes the gate's steady state.
- **It is invisible to CI** (`test:unit` with no Postgres → skip), so the only feedback loop
  is a developer noticing 443 in a local run.

### 6.2 What to replace it with

**Gate 1 — the licence invariant (blocking, time-invariant).** Over `person_role` at
`source IN ('tr','ngo')`:

- every row has `bridge IS NOT NULL`;
- every `bridge IN ('B','V')` row has `bridge_footprint BETWEEN 1 AND FOOTPRINT_CAP`;
- every `bridge = 'A'` row's `ref` is in the curated set **at test time** (Bridge A is a
  curated link, so re-checking it is legitimate — but see the caveat below);
- **mutation check**: re-run the count with the `bridge` predicate removed and require
  strictly more rows, so an implementation that stamped everything `'B'` cannot pass;
- **skip with a DISTINCT reason** when `bridge` is entirely NULL, naming the resolve command.

⚠️ The Bridge-A arm re-introduces a moving input (`company_politicians` is rebuilt by
`db:load:tr:pg`, `magistrate_company` by `db:load:magistrates:pg`). Either stamp
`bridge='A'` and trust it like the others, or accept that this one arm can decay. Stamping is
consistent; I would stamp.

**Gate 2 — licence freshness (reporting, thresholded).** Not a boolean over one role, but a
statement about the corpus:

```
roles whose stored bridge_footprint < the CURRENT fold size   → N
people affected                                                → M
max drift (current − stored)                                   → K
```

Fail only when this exceeds a bound argued from the data. `N` scales with corpus size and with
how long since the last resolve, so a threshold on it is a threshold on operational tempo.
`K` scales with *how wrong a single attribution could be*, which is closer to the thing worth
gating.

**⚠️ SHIPPED WITH A THIRD STATISTIC, AND THE REASON IS WORTH RECORDING.** Neither `N` nor `K`
is what the failure sentence is about. `K` is a MAX — a single-row order statistic that one
outlier pins, so it says nothing about how much of the layer is affected (today `K = 7`, set
by one person). What the gate actually needs to assert is "the person layer is now too far
behind its licensing inputs to trust", and the quantity that means is **the SHARE of the layer
whose licence premise no longer holds** — i.e. people now over `FOOTPRINT_CAP`. That is a
population statistic, it is the precise event that invalidates a licence, and it is
insensitive to the benign drift that dominates (642 of 687 drifted people gained exactly one
company). Threshold 1%, against 0.077% measured — argued in full in the gate's own header,
including what the number makes TRUE: roughly a fortnight of daily TR refreshes before a
re-resolve is demanded.

**Gate 3 — the caveat gap (§3.2), separately.** Assert that a person whose tr/ngo roles are
all `bridge IN ('B','V')` renders an identity caveat. Today a Bridge-B public figure renders
none. That is a UI change, not a data one, and it is the cheapest real risk reduction here:
it puts the same sentence on the prerendered Раев page that a private Tier-V page already
carries.

---

## 7. Data repair

**None is needed, and none should be done.**

- The 443 roles were correctly licensed when attached (§1.4). Deleting them would remove
  attributions that are, in the sampled cases, demonstrably right — and would orphan
  `/person/:slug` URLs for 58 Tier-V people with no redirect target, the magistrate-roster 404
  class CLAUDE.md documents.
- Re-resolving would fix the *symptom* (the roles would be re-derived against the current
  corpus, and the 63 folds — now at 6–11 — would simply not be minted, so their pages would
  disappear). That is a **worse** outcome than the current state, achieved at the cost of a
  37-minute resolve, a corpus-wide `person_id` reassignment, and the full repair chain.
- Nothing on Cloud SQL needs action from this. Prod's person layer has its own resolve
  history; whether it shows the same drift is unmeasured (§8) and would need a read-only
  check, not a resolve.

The one thing worth doing **before** the schema work, because it is free and reduces real
exposure today, is **Gate 3's UI change** (§3.2): render the name-match caveat on Bridge-B
public-figure profiles. That reaches the prerendered indexed page and costs a `deploy`.

---

## 8. What I did not establish

- **Whether the gate was green before *earlier* resolves.** The evidence here shows only that
  it was self-consistent at the 2026-08-22 resolve. Given the mechanism, it will have been
  red after every TR refresh since Tier V shipped.
- **Whether Cloud SQL shows the same drift.** Prod has its own resolve and TR-load history.
  Read-only, and worth measuring before the schema change so the fix is sized against both.
- **Whether the `shared_name` sub-case (18 people, 169 roles) deserves a different answer.**
  These are the only ones where the failing clause was carrying real weight, since
  `fold_people_n` is 2–6 and Tier V never reads it. §2.6 of `tr-attribution-basis-v1` chose to
  keep and label them; that decision was made when the cap held. It may want revisiting on its
  own merits, independently of this failure.
- **Whether `company_political_links`' `bridged` arm should traverse a `name_match` edge at
  all.** §3.1 shows a sitting MP reached through one. That is a design question about 158, not
  a consequence of the decay, and it is out of scope here.

---

## Appendix — queries used

All read-only, local Postgres 5433. The unlicensed-row set is the gate's own query with
`BRIDGE_B_CTE` and `TIER_V_SERVED_IDENTITIES_SQL` inlined; per-clause decomposition, footprint
distributions and the surface-reach checks are derived from it. `place_mp_companies` must be
called with a page size large enough to cover the place (VAR06 holds 624 companies) — a
default-size call returns the money-ranked head and misses these rows.
