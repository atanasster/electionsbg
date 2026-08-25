# Five red gates on `main` — root causes and repair

**Analysed:** 2026-08-25 at `cd1a438461` — local Postgres on 5433, Cloud SQL proxy on 5434, so
production was measured directly rather than inferred. Every baseline figure below is as of that
tree.
**Implemented:** 2026-08-25 — A `8d2654bc67`, B `fc9840c7f7`, C `779b06e4a3`, D `cab89faa40`,
E data-only (no commit; the plan correction is this file). The reproduction command below now
reports **5 files / 80 tests passed**.

⚠️ **This document carries TWO vintages and they must not be conflated.** Claims under "Analysed"
describe the tree at `cd1a438461`; several are deliberately no longer reproducible (see §4, §5 and
§12). Do NOT re-do A–D: they have shipped, and re-doing B in particular would re-add an exemption
whose absence a now-green `toBe(5)` depends on.

```bash
npx vitest run scripts/db/cloud_loader_coverage.test.ts scripts/prerender/ogAndSitemapCoverage.test.ts \
  src/data/area/governanceNonPlace.test.ts scripts/db/tests/graph.data.test.ts \
  scripts/db/tests/person_browse.data.test.ts
```
→ **5 files failed, 10 tests, 66 passed.**

## 0. The headline, before the detail

The ten failures are **not** ten problems. They are:

| | | verdict | outcome |
|---|---|---|---|
| 1 | `/governance/mayor-pay` read as a place anchor | **live UI defect — fix the code** | ✅ `8d2654bc67` |
| 2a | `db:load:magistrate-filing-assets:pg:cloud` unwired | **wire it — exempting would hide a real publish gap** | ✅ `fc9840c7f7` |
| 2b | `proc:verify-seats:cloud` not in the orchestrator | **exempt — it is a read-only verifier, not a publish** | ✅ `fc9840c7f7` |
| 3a/b | `/governance/mayor-pay` undeclared for prerender+sitemap | **declare it — do not exempt** | ✅ `cab89faa40` |
| 3c/d | `companies` + 2 funds procedures have no `<loc>` | **regenerate the artifact** | ✅ `779b06e4a3` |
| 3e | `BudgetHubScreen` renders an unlisted `HubHead` | **⚠ NOT A FAILURE ON `main` — another session's uncommitted work** | ✅ closed by that session |
| 4 | 52 graph nodes drifted | **stale data — no code change** | ✅ data repair, §6 |
| 5 | 1 non-MP prominence disagreement | **stale data, same root cause as 4 — no code change** | ✅ data repair, §6 |

⚠️ **All eight are DONE — do not re-do them.** Re-adding 2b's exemption in particular would break
a gate that is green because of it (`ORCHESTRATOR_EXEMPTIONS` is pinned at `toBe(5)`).

**Two of the ten are one thing, and it is bigger than the gates show.** Items 4 and 5 are both
downstream of an unfinished `db:resolve:persons` repair chain in the LOCAL database — see §6.
**Production is healthy; this is a local condition.**

**One of the ten is not ours.** §3e.

---

## 1. `/governance/mayor-pay` is read as a place anchor — LIVE UI DEFECT

**Gate:** `src/data/area/governanceNonPlace.test.ts` → "covers every static /governance/* page in
the route table". Offender: `mayor-pay`.

### Root cause, measured

`/governance/mayor-pay` was added by `1f196d41fb` (2026-08-25, `src/routes.tsx:1832`) and never
joined `GOVERNANCE_NON_PLACE_SEGMENTS` (`src/data/area/areaAnchor.ts:59`), which is the negative
lookahead inside `AREA_PATH_RE`.

Run against the live regex:

```
/governance/mayor-pay          -> "mayor-pay"        ← extracted as a PLACE ID
/en/governance/mayor-pay       -> "mayor-pay"        ← same on the EN mirror
/governance/municipal-finance  -> null (not a place) ← the correct behaviour
/governance/68134              -> "68134"
```

### The live consequence — this is not a stale list

`AreaAnchorProvider.tsx:44` feeds that capture straight into the anchor, and **path wins over
query** (`const id = pathId ?? queryId`). So on this page:

- A reader who has a real anchor set (`?area=68134`) has it **masked** by `"mayor-pay"` for as
  long as they are on the page. Nine components call `useAreaAnchor()` — including `PricesScreen`,
  three `/consumption` screens and `MyAreaEntryScreen`.
- `AreaPill` renders (the anchor is non-null). `useAreaResolver("mayor-pay")` returns null, so
  `display` falls through to the raw id: the header shows a MapPin, the prefix „ОБЩИНА/РАЙОН" and
  the literal text **`mayor-pay`**.
- The pill's × handler calls `onPlaceNode(location.pathname)` → **true** → `navigate("/my-area")`.
  Clearing a bogus anchor **bounces the reader off the page they were reading.**

**One thing it does NOT do,** checked across every `setAnchor(` call site: nothing writes a
path-derived id back into the URL, so `?area=mayor-pay` never travels to another page. The damage
is confined to this page — but `area` IS in the `usePreserveParams` allowlist, so that safety is
incidental rather than designed.

### Call: **fix the code.** Add `"mayor-pay"` to `GOVERNANCE_NON_PLACE_SEGMENTS`.

⚠️ **This is not "adding it to an allowlist".** The list is not a suppression table — it is the
regex's own exclusion set, and editing it *changes runtime behaviour*. The allowlist path that
would hide the defect is editing the **test** (skipping `mayor-pay` in `declaredStaticSegments()`);
that would leave the pill broken. The gate is derived from `routes.tsx` precisely so this list
cannot be forgotten again.

The sibling arm "keeps every known page declared FLAT" requires the literal
`path="governance/mayor-pay"` in `routes.tsx` — present at line 1832. ✔

**Scope, as ANTICIPATED:** one line in `src/data/area/areaAnchor.ts` plus a comment. Independent
of everything else here.

**Scope, as SHIPPED (`8d2654bc67`, 53 insertions across 2 files):** review of that one-liner found
a SECOND instance of the same defect. The lookahead's boundary was `(?:/|$)` while the capture
group excluded `[^/?#]`, so `/governance/mayor-pay?area=68134` — the exact URL shape this list
protects, a reader arriving WITH an anchor — slipped past every entry in the list. Widened to
`(?:[/?#]|$)`, segments are now escaped before being spliced into the RegExp, the unused and
divergent `AreaKind` type was deleted, and a test arm pins the query/hash case.

---

## 2. `cloud_loader_coverage` — two offenders, two OPPOSITE verdicts

Full offender list (the diff truncated it):

- **arm 1** ("no UNWIRED `:cloud` script"): `db:load:magistrate-filing-assets:pg:cloud`
- **arm 2** ("no non-exempt `:cloud` loader missing from the ORCHESTRATOR's Step 9"):
  `proc:verify-seats:cloud`, `db:load:magistrate-filing-assets:pg:cloud`

### 2a. `db:load:magistrate-filing-assets:pg:cloud` — **WIRE IT**

**Root cause.** The npm scripts were added by `991c50692d` (2026-08-25) to a loader that had
shipped without them; nothing then named the `:cloud` twin in any skill.

**It publishes a live-served corpus.** `functions/db_routes.js:4962` calls
`magistrate_filing_assets_json($1)`; `src/data/judiciary/useMagistrateHoldings.tsx:258` reads it.
This is not an operator tool.

**Measured on production (proxy on 5434):**

| | local | prod |
|---|---|---|
| `magistrate_filing_asset` rows | 26,142 | **26,142** |
| `magistrate.real_estate_count_parsed` non-null | 3,587 | **3,587** |
| `magistrate_filing.kind` non-null | 36,995 | **36,995** |

So the corpus **has** been published — by hand, by path, before the scripts existed. Nothing is
broken today.

**The hazard is a future wipe, and it is triggered by a DAILY WATCHER.** `load_magistrates_pg.ts:131`
runs `TRUNCATE magistrate CASCADE`. Measured FK graph:

```
magistrate_filing  --FK--> magistrate(name) ON DELETE CASCADE   ← truncated
magistrate_company --FK--> magistrate(name) ON DELETE CASCADE   ← truncated
magistrate_filing_asset : PK (source_url, table_num, ord), NO FK ← survives
```

So an `ivss_declarations` flip → `update-judiciary` → `db:load:magistrates:pg:cloud` returns
`magistrate_filing.kind` to NULL on 36,995 rows and `real_estate_count_parsed` to NULL on 3,587
magistrates. `070_magistrates.sql`'s own comment states the consequence and that it is deliberate:
the property count **disappears from every card**, with no fallback, until the asset loader runs
again.

**That makes it watcher-triggered, and the repair needs no new crawl** — the loader re-derives from
the already-cached `raw_data/judiciary/filing_cache.json`. This is the C1 rollcall class exactly:
named in a plan, absent from the orchestrator, prod goes stale at a 200.

**Call: wire it in BOTH places, exempt it in NEITHER.**

- `.claude/skills/update-judiciary/SKILL.md` — into the publish block at ~line 189, in the order
  its owning plan prescribes: `db:load:magistrates:pg:cloud` → **`db:load:magistrate-filing-assets:pg:cloud`**
  → `db:load:judicial-bodies:pg:cloud`.
- `.claude/skills/process-watch-report/SKILL.md` — the `ivss_declarations` row (line 520) and the
  Step 9 emit table, for the same reason and in the same order.

⚠️ **State the skip-and-warn in the skill text.** The loader exits 0 without writing when
`filing_cache.json` is absent, so on a machine without the ~3.5 h crawl the emit is a safe no-op
that leaves the columns NULL. An operator must be told that "it ran and printed nothing" is not
the same as "the count is back".

Neither exemption count changes. Exempting this instead would be the wrong answer twice over: it
publishes a real corpus, and its trigger is a watcher.

### 2b. `proc:verify-seats:cloud` — **EXEMPT (`ORCHESTRATOR_EXEMPTIONS`, `operator-tool`)**

It already passes arm 1 (named six times in `update-procurement/SKILL.md`). It fails arm 2 only.

**It cannot cause the harm the gate names.** `scripts/procurement/verify_awarder_seats.ts`'s header:
*"Read-only: it issues one SELECT and writes nothing."* Exit 1 on drift. It publishes nothing, so it
can never "leave prod on the previous vintage at a 200".

**Its owning plan already decided this**, `docs/plans/awarder-seats-freshness-gate-v1.md`:

- §3.3 — "Wire it into `.claude/skills/update-procurement/SKILL.md` as the last line of the publish
  path" — **done**.
- §6 — "It does not make the cloud check automatic. §3.3 is a command someone runs. **Nothing in
  this repo runs a `:cloud` verification on a schedule, and this spec does not change that.**"

And §4 records a **benign divergence** (an awarder gaining a real OCDS address) that makes it exit 1
with nothing wrong. A blind orchestrator emit would turn an expected event into an apparently failed
publish — an argument against adding it to Step 9, not merely a neutral one.

**Call:** add to `ORCHESTRATOR_EXEMPTIONS` in `scripts/db/cloud_loader_coverage.ts` with
`kind: "operator-tool"`, and raise the pinned count in `cloud_loader_coverage.test.ts`
("the orchestrator-exemption list cannot grow unnoticed") from **4 → 5**.

This is the honest kind of exemption: the map's own taxonomy defines `operator-tool` as "not a
corpus reload at all", with two precedents on the identical reasoning (`build:project-members:cloud`,
`data:local-person-refresh:cloud` — "the `:cloud` suffix only redirects which database it READS").
The gate scans by name suffix and structurally cannot tell a verifier from a loader; the exemption
map is the designed escape for exactly that.

The alternative — naming it in Step 9 — would also turn the gate green. It is worse, for the §4
reason. Say so in the entry.

---

## 3. `ogAndSitemapCoverage` — five arms, three verdicts, one non-failure

### 3a/3b. `governance/mayor-pay` undeclared — **DECLARE IT**

Two arms fail on the same page: the count tripwire (`toBe(7)`, now 8) and "accounts for every
undeclared page — the table is the whole list".

The page is a top-20 ranked bar chart plus a sortable, searchable table of ~259 municipalities'
mayor pay per 1,000 residents. That is indexable editorial content, and its direct sibling
`governance/municipal-finance` is fully declared. Undeclared means Firebase serves it the
**homepage's** `<title>` and canonical — CLAUDE.md's "SEO needs prerendered HTML" rule.

⚠️ **Do not take the `NO_STATIC_PAGE` path.** Every existing entry there is either browser-local
(`useNoindex()`), an empty on-ramp, or explicitly marked `UNDECIDED`. `mayor-pay` is none of those.
Note the arithmetic makes the right answer the cheap one:

- **Declare it** → undeclared returns to 7 → the pinned `toBe(7)` needs **no edit at all**.
- **Exempt it** → `toBe(7)` must become `toBe(8)` *and* a `NO_STATIC_PAGE` entry must be invented
  — two edits, a worse site, and a false reason on the record.

**Work required (four parts; the og image is a hard dependency):**

1. `staticPage({ path: "governance/mayor-pay", ogImage: "/og/governance-mayor-pay.png", title,
   description, breadcrumbName, bodyHtml, english: {...} })` in `scripts/prerender/routes.ts` —
   copy the shape at `routes.ts:2540` (municipal-finance). Follow its rule: **no figures in the
   prerendered body**; this HTML is rebuilt only on deploy and the numbers move with each filing.
2. A capture entry in `scripts/og/capture-screens.ts`:
   `{ slug: "governance-mayor-pay", routePath: "governance/mayor-pay", waitFor: "table tbody tr",
   anchor: "h1", viewport: OG_CLIP_VIEWPORT, settleMs: 2500 }`. Both selectors verified present —
   the screen renders `<table>` at line 233 and `<Title>` (`src/ux/Title.tsx`, an `h1`) at line 125.
3. `npx tsx scripts/og/capture-screens.ts governance-mayor-pay` against a running dev server →
   `public/og/governance-mayor-pay.png`. **Without this the gate trades one failure for another**:
   `hasProducer()` requires the PNG on disk or a `generate.ts` card, else "og:image with no producer
   — the crawler gets a 404 image".
4. **Both** `scripts/sitemap/route_defs.ts` entries — the flat list (~line 59) *and* the tree entry
   (~line 358). Adding only one lists the BG page and not the EN mirror; the gate has a separate arm
   for that.

Then `npm run sitemap` (see 3c/3d) to mint the `<loc>`s.

### 3c/3d. `companies` and two funds procedures have no `<loc>` — **REGENERATE**

**`companies`** — measured: declared in `scripts/prerender/routes.ts:4684` and in **both**
`route_defs.ts` places (line 140 flat, line 551 tree). Grepped every `public/sitemap*.xml` for the URL as a FIXED FULL-STRING match. Two traps here, both
of which produce a confident wrong answer:

- The ellipsis form `<loc>…/companies</loc>` also matches `/governance/companies` and
  `/sofia/companies` — **4 hits at the baseline** — so a reader reproducing it concludes the claim
  was wrong.
- `grep -x` (whole line) matches NOTHING in these files ever: the shards are **CRLF**, so every
  line ends `…</loc>\r`. It returns 0 whether the URL is there or not, which is the worst kind of
  check.

`-oF` without `-x` is immune to both — and `<loc>https://electionsbg.com/companies</loc>` is not a
substring of the `/governance/companies` line, so it needs no anchoring:

```bash
grep -hoF '<loc>https://electionsbg.com/companies</loc>' public/sitemap*.xml | wc -l
#   0 at the cd1a438461 baseline  ·  1 after the re-mint in C
```

Timeline: the route landed in `bd90e5bae1` (2026-08-25, the 188 registry browse); the sitemap was
last regenerated for these shards in `76b5fdb371` (**2026-08-20**) — which is also the commit that ADDED `/governance/companies`, so the re-mint self-corrects a five-day-old entry. (`b0dd4277ce`, 2026-08-19, is the newest sitemap commit overall but did not touch the static shards `/companies` lives in.) The declaration is complete; only the committed
artifact is behind. This is exactly what the gate's own message prescribes.

**`funds/procedure/BG14MFPR001-2.006` and `funds/procedure/BG16FFPR002-3.012`** — measured:
`sitemap_funds.xml` carries **987** `funds/procedure` locs; `data/funds/projects/by-procedure/index.json`
carries **989** procedures, including exactly those two (real ИСУН codes — 4 and 3 contracts,
€316,730.23 and €218,497.34, both `procedureName: null`). Prerender and sitemap share one enumerator
(`readIndexableProcedures`), so they cannot disagree about the *rule* — only about vintage.

⚠️ **This arm is MACHINE-DEPENDENT, and it should be recorded as such.** That index is gitignored
(`.gitignore:267`), so on a fresh clone the enumerator returns `[]` and this arm passes vacuously.
It reproduces here because this machine's ИСУН corpus is newer than the 2026-08-19 sitemap. Same
one-command fix.

The /en arm correctly flagged only `companies`: both procedures carry `procedureName: null`, so
their mirrors set `english.canonicalUrl` and the gate skips them deliberately.

**Call:** `npm run sitemap`, then commit `public/sitemap*.xml`.

**Safety of a whole-corpus re-mint on this machine — checked, because §6 leaves the local person
layer half-repaired:**

- `scripts/sitemap/index.ts` touches Postgres through exactly two readers, `readSeoCourts` and
  `readSeoCouncils`. Neither reads `person`, `person_role` or `person_browse_table` — verified over
  their SQL. Persons come from the **committed** `data/person/prerender_slugs.json`. So §6 cannot
  poison the artifact.
- The `/court/**` build-time dependency is satisfied: local `judicial_body` = **280 rows**, and the
  committed `sitemap_judiciary.xml` holds **560** locs (280 × 2). A re-mint will not collapse it.

**Pre-commit check — the shard counts must not shrink.** Baseline measured 2026-08-25:

```
sitemap.xml 16 · sitemap_budget.xml 108 · sitemap_candidates.xml 49000 · sitemap_candidates_2.xml 3772
sitemap_funds.xml 1104 · sitemap_index.xml 16 · sitemap_judiciary.xml 560 · sitemap_local.xml 3126
sitemap_parties.xml 450 · sitemap_pensions.xml 62 · sitemap_polls.xml 10 · sitemap_regions.xml 187
sitemap_reports.xml 41 · sitemap_sections.xml 16951 · sitemap_settlements.xml 5276
sitemap_static.xml 49000 · sitemap_static_2.xml 16646 · sitemap_votes.xml 3352
```

```bash
for f in public/sitemap*.xml; do printf "%-32s %s\n" "$(basename $f)" "$(grep -c '<loc>' $f)"; done
```

Refuse to commit any shard that dropped **without accounting for the drop** — a shard CAN
legitimately shrink here, so the rule is "explain every movement", not "never go down".

⚠️ **The deltas this section originally predicted were wrong**, because a count check sees neither
churn nor the 49,000-cap overflow. As measured across the re-mints that shipped:

| shard | predicted | measured | why |
|---|---|---|---|
| `sitemap_funds.xml` | +2 | **+2** | the two new procedures ✔ |
| `sitemap_static.xml` | +2 | **0** | pinned at the 49,000 shard cap; additions push overflow into `_2` |
| `sitemap_static_2.xml` | +2 | **−1, then +2** | `/companies` ×2 in; `/governance/companies` ×2 out (retired, it redirects); `/procurement/settlement/24668` out (0 rows on local AND prod); 886 `/product/` out and 886 in — net-zero prices churn |

The lesson a count check cannot teach: **set-difference the shards, do not diff the counts.**
890 URLs moved to produce a net of +1.

### 3e. `BudgetHubScreen` renders an unlisted `HubHead` — **NOT A FAILURE ON `main`**

```
git show HEAD:src/screens/budget/BudgetHubScreen.tsx | grep -n HubHead   → (nothing)
grep -n HubHead src/screens/budget/BudgetHubScreen.tsx                    → 25, 351
```

The `HubHead` exists **only in the working tree**. The file is ` M` in `git status`, alongside
`scripts/db/schema/pg/156_budget_hub_stats.sql`, `src/data/budget/useBudgetHubStats.ts` and both
locale corpora — another session's in-flight budget-hub work. At `cd1a438461` this arm passes.

**Call: leave it entirely alone.** The owning session must add
`src/screens/budget/BudgetHubScreen.tsx` to `HUB_CAPTURES` (with its og capture) or to
`SUB_PAGE_HEADS`, in the same commit that lands the `HubHead`. **Do not touch that file, and do not
touch those two maps** — editing them here would silence a gate on somebody else's unfinished work.

Worth flagging to that session: this is the gate doing its job on schedule, not a bug.

---

## 4. `graph.data.test.ts` — 52 drifted nodes: **STALE DATA, NOT A WRONG BASIS**

**Gate:** "public_officer_count equals the live person_role basis".

### The drift is bidirectional and small — the signature of a vintage split

```
stored HIGHER than live : 41
stored LOWER  than live : 11
```

Magnitudes are almost all ±1 (largest 4 vs 8). A **wrong basis** drifts one way under a consistent
rule; two-directional ±1 noise is one table having moved under another.

### The sibling arm localises it

`officer_count equals distinct linked people` **PASSES** — `graph_company_node` and `graph_edge`
agree with *each other*, i.e. they are one coherent load. What moved is `person_role`.

### The cause, from the ingest ledger

`state/ingest/update-persons.json` (uncommitted, another session):

```
- "lastSuccessfulIngest": "2026-08-22T18:56:52.448Z"   65065 persons, 125080 roles, +28426 bridge-B, +68662 tier-V
+ "lastSuccessfulIngest": "2026-08-25T10:03:45.507Z"   65099 persons, 125081 roles, +28520 bridge-B, +69138 tier-V
```

`person.updated_at` = `2026-08-25 10:02:53Z`. A `db:resolve:persons` ran **today**, and
`db:load:graph:pg` — which CLAUDE.md's post-resolve repair chain requires (it is 7th of the nine
commands in §6) and which `refresh_coverage.test.ts`'s `ORDER_PAIRS` pins, though only transitively
— has not run since.

### Call: **refresh the data. No code change.** See §6 for the full chain and the coordination risk.

⚠️ *The distribution above (52 / 41 / 11, largest 4 vs 8) is POINT-IN-TIME, measured 2026-08-25
before the §6 chain ran, and is **not reproducible now** — the gate is green and the drift is
gone. It is load-bearing (it is what rules out "a wrong basis" in §9), so the query is carried
here rather than the conclusion alone:*

```sql
SELECT sign(cn.public_officer_count - coalesce((
         SELECT count(DISTINCT r.person_id) FROM person_role r JOIN person p USING (person_id)
          WHERE r.source IN ('tr','ngo') AND r.ref = cn.eik
            AND p.is_public_figure AND p.status = 'active'), 0)) AS direction,
       count(*)
  FROM graph_company_node cn GROUP BY 1;
```

---

## 5. `person_browse.data.test.ts` — 1 non-MP: **SAME ROOT CAUSE, ALSO STALE**

**Gate:** "prominence agrees with officials_rankings on the shared set", non-MP arm.

### The person

```
andrei-dimov-krstev-024d5b | Андрей Димов Кръстев | browse: candidate | officials: councillor | is_mp: f
```

### It is a SLUG that moved, not a category that is wrong

Live `person_role` for that slug (person 1821) is **two `candidate` rows and nothing else**. There
are three homonyms:

```
1821  andrei-dimov-krstev-024d5b     candidate/candidate ×2
1822  andrei-dimov-krstev-024d5b-2   official_muni/councillor   ref = "andrei-dimov-krstev-024d5b"
1823  andrei-dimov-krstev-024d5b-3   local/councillor
```

and `person_slug_retired` carries `andrei-dimov-krstev-5260e2 → andrei-dimov-krstev-024d5b` — one
of the "2 slug(s) retired to a redirect" today's resolve reports. The bare slug was reassigned from
the councillor to the candidate; `officials_rankings_table` still holds the **pre-resolve**
slug→category map. Recomputing that matview's `officials` CTE live for this slug returns nothing.

### The scope of the staleness, and why a row count would have called it fresh

```
officials_rankings_table rows        20,524
live officials people                20,524   ← identical, so a count check passes
stored slugs the live basis no longer yields   8
category disagreements on SHARED slugs         0   ← the RULE is correct
```

Pure slug churn. Only 1 of the 8 trips this gate (the others do not meet its `person_browse_table`
join + `NOT is_mp` filter).

`officials_rankings_table` selects `p.slug` from `person` on `person_id` and carries
`CREATE UNIQUE INDEX idx_officials_rankings_slug` (`100_officials_rankings.sql:271`), so
`REFRESH MATERIALIZED VIEW CONCURRENTLY officials_rankings_table` closes it with **no reader
blocking** and none of the ~8-minute 090 `DROP … CASCADE` outage — which is CLAUDE.md's own rule:
*"After SHIPPING VALUES, refresh — do NOT re-apply."* Values moved; definitions did not.

### Call: **refresh the data. No code change.**

⚠️ *"8 stale slugs, 0 category disagreements, 20,524 = 20,524" is likewise POINT-IN-TIME and no
longer reproducible. The QUALITATIVE evidence still is, and is what the argument rests on: the
three homonyms (person_id 1821/1822/1823), the `person_slug_retired` row
`andrei-dimov-krstev-5260e2 → …-024d5b`, and the UNIQUE index on `officials_rankings_table (slug)`
that makes a CONCURRENT refresh the cheap repair.*

Not the documented mp-outranks-officials carve-out (that arm requires `is_mp`, and this person is
not one), and not a rule defect (0 category disagreements on shared slugs).

---

## 6. The thing behind items 4 and 5 — and it is larger than either gate

Both are symptoms of **one unfinished operation**. Measured on **local**:

| | |
|---|---|
| `declaration.person_id` non-null | **0 of 61,743** |
| `council_vote.person_id` non-null | **0 of 46,121** |
| ~~`person_browse_table` rows vs `person`~~ | ~~137,461 vs 134,237~~ — **RETRACTED, see below** |
| ~~browse slugs that no longer exist in `person`~~ | ~~4,507~~ — **RETRACTED, see below** |
| `person_browse_table.has_declaration` true | **0 of 137,461** |

That is verbatim the state CLAUDE.md warns about: *"Stopping at the resolver leaves 43,168 council
votes and 61,743 filings unattributed at a 200."*

**Production is HEALTHY** (measured over the proxy on 5434):

| | |
|---|---|
| `declaration.person_id` non-null | **61,743 of 61,743** |
| `council_vote.person_id` non-null | **43,261 of 46,121** (93.8% — the documented figure) |
| `person_browse_table.has_declaration` true | **21,170 of 137,399** |

**So there is no production incident and no code change anywhere in §4–§6.** It is a local database
mid-repair.

⚠️ **TWO lines of the table above were MEASUREMENT ARTIFACTS and both are retracted.** They are
the same mistake twice, and it is the mistake this document is otherwise about: a number that
looks like drift but is a constant property of the schema.

**"4,507 browse slugs that no longer exist in `person`"** counted rows failing
`EXISTS (SELECT 1 FROM person p WHERE p.slug = b.slug)`. All 4,507 have a **NULL** slug, so the
probe was asking whether NULL exists in `person` — it never does. Re-measured: **0** non-NULL
browse slugs are absent from `person`, and the figure is 4,507 both before and after the repair.

⚠️ **And the first correction named the wrong cause, which is worth recording rather than
quietly fixing.** It said these were "tier-V rows, which carry no slug by design". They ARE all
tier V, but sluglessness is not a tier-V property: **69,138 of 73,645 tier-V rows carry a slug.**
The set is characterised exactly by `identity_confidence`:

| identity_confidence | slugless | total |
|---|---|---|
| `name_fold` | **4,507** | **4,507** |
| `verified` | 0 | 64,750 |
| `resolved` | 0 | 63,816 |
| `shared_name` | 0 | 4,388 |

So the slugless rows are 120's `name_fold` arm — people known only as a name fold, who get no
`/person` page and therefore no slug — and every other confidence class is 100% slugged.

**"137,461 vs 134,237"** is the same class and was left standing as evidence by the first
correction, which excluded it only by arithmetic ("the other three rows"). It decomposes with no
residue and no reference to staleness: 137,461 = **132,954** slugged browse rows + **4,507**
`name_fold` rows; and 134,237 persons = those 132,954 plus **1,283** that 120's own gate excludes.
Unchanged before and after the repair.

**What WAS genuine**, and is now repaired, is named rather than inferred: `declaration.person_id`
at 0 of 61,743, `council_vote.person_id` at 0 of 46,121, and
`person_browse_table.has_declaration` at 0 of 137,461.

### RUN 2026-08-25 — the chain completed, both gates green

Run with the user's explicit go-ahead while the concurrent session was active. Measured after:

| | before | after |
|---|---|---|
| `declaration.person_id` non-null | 0 of 61,743 | **61,743 of 61,743** |
| `council_vote.person_id` non-null | 0 of 46,121 | **43,261 of 46,121 (93.8%)** |
| `person_browse_table.has_declaration` | 0 of 137,461 | **21,170** — matching prod exactly |
| `graph.data.test.ts` + `person_browse.data.test.ts` | 2 failed | **30 passed** |

Phase 2 of declarations took 2m02s and reported `0/61743 still NULL`; the council loader
reported 93.8%, the documented figure, against its own 90% floor. No code changed — this
was a data repair, as §4 and §5 predicted.

### The repair — CLAUDE.md's chain, in order

```bash
npm run db:load:declarations:pg -- --resolve   # refills declaration.person_id; rebuilds 090/096/097/159/169
npm run db:load:person-elections:pg
npm run db:load:official-candidate-links:pg
npm run db:load:council:pg                     # re-attaches council_vote.person_id (90% floor)
npm run db:load:persons-browse:pg
npm run db:load:person-search:pg
npm run db:load:graph:pg                       # closes §4
npm run db:load:agri-hub-stats:pg
npm run db:load:tr-company-place:pg
```

Two ordering rules that are not optional:

- **`db:load:declarations:pg -- --resolve` MUST precede `db:load:persons-browse:pg`.** Rebuilding
  the browse table while `declaration.person_id` is NULL publishes `has_declaration = false` for
  everyone — the defect CLAUDE.md records as having reached production once. The current
  `0 of 137,461` says this has already happened locally at least once.
- `db:load:tr-company-place:pg` runs last of the three that touch `company_public_money`.

If only §4 and §5 are wanted green and nothing else, the minimum is
`db:load:declarations:pg -- --resolve` (which refreshes `officials_rankings_table`) plus
`db:load:graph:pg`. **That is not the recommendation** — it leaves 46,121 council votes
unattributed.

### ⚠️ COORDINATION — the one item that must not be run unilaterally

Another session is active and appears to be mid-chain (it owns the resolve that caused this).
`db:load:declarations:pg -- --resolve` opens with 090's `DROP MATERIALIZED VIEW person_wealth_year
CASCADE`, taking `/persons`, `/officials/assets`, `/mp-assets` and `/declarations/crypto` offline
locally for the duration and failing any data test that reads them. **Ask before running it.**

`db:load:graph:pg` alone is a stage merge and safe to run against a live database.

---

## 7. Ordering and independence

| # | change | touches (as ANTICIPATED — see each section for what shipped) | ships |
|---|---|---|---|
| **A** | §1 — `"mayor-pay"` → `GOVERNANCE_NON_PLACE_SEGMENTS` | `src/data/area/areaAnchor.ts` | **alone, first** — one line, no data, no build |
| **B** | §2a + §2b | `.claude/skills/update-judiciary/SKILL.md`, `.claude/skills/process-watch-report/SKILL.md`, `scripts/db/cloud_loader_coverage.ts`, `scripts/db/cloud_loader_coverage.test.ts` | **alone** — docs + config only, no data, no build |
| **C** | §3c/3d — `npm run sitemap` | `public/sitemap*.xml` | **alone, before D** |
| **D** | §3a/3b — declare `governance/mayor-pay` | `scripts/prerender/routes.ts`, `scripts/og/capture-screens.ts`, `public/og/governance-mayor-pay.png`, `scripts/sitemap/route_defs.ts`, `public/sitemap*.xml` | after C |
| **E** | §4 + §5 + §6 — the repair chain | **no files** | **coordinate first** |
| — | §3e | — | hand off, do not touch |

**A, B, C/D and E are fully independent** — no shared file, no shared gate.

**C before D, deliberately.** Two sitemap re-mints rather than one: C's diff is the 2026-08-19→now
corpus catch-up (large, needs the shard-count check), and D's is then just the mayor-pay locs
(small, readable). Folding them together buries a new page's `<loc>`s inside a 4,000-line artifact
diff.

**A and D both concern `/governance/mayor-pay` but have no technical dependency** — A is the header
pill, D is the crawler. A is a one-liner and should not wait for D's og capture.

---

## 8. Conventions for whoever implements this

- Plans in `docs/plans/<name>-v1.md` — this file.
- Commit straight to `main` by **explicit pathspec** (`git commit -- <paths>`), never `git add -A`.
  No `Co-Authored-By` trailer.
- **Another session is active.** Before every commit, re-check `git status` and commit only paths
  this work changed. The current foreign set: `src/screens/budget/BudgetHubScreen.tsx`,
  `src/data/budget/useBudgetHubStats.ts`, `scripts/db/schema/pg/156_budget_hub_stats.sql`,
  `src/locales/{bg,en}/translation.json`, the `src/screens/dashboard/Candidate*Tile.tsx` and
  `src/screens/components/candidates/*` files, `src/screens/person/PersonElectoralSection.tsx`,
  `data/parliament/votes/derived/**`, `public/llms-full*.txt`, `state/ingest/update-persons.json`.
  ⚠️ Change **D** edits `src/locales/{bg,en}/translation.json` if the prerender copy needs new keys —
  that file is already dirty from the other session. Either coordinate or put the copy in
  `routes.ts` literals (which is what the municipal-finance entry does — its `bodyHtml` is inline
  Bulgarian, not i18n keys).
- `npx eslint . --fix` before declaring done.
- Re-run the five-file command at the top after each change.

## 9. What was ruled out

- **`scripts/db/bootstrap_roles.test.ts`** — passes normally. It fails only if `DATABASE_URL` is
  pointed at a dead port to "simulate CI", and failing there is CORRECT: it asserts the bootstrap
  refuses a non-docker target. Not in scope, not touched, and not a lead.
- **A wrong `public_officer_count` basis** (§4) — ruled out by the bidirectional ±1 drift and by the
  passing `officer_count` sibling arm.
- **A prominence rule defect** (§5) — ruled out by 0 category disagreements on shared slugs.
- **A production incident** (§6) — ruled out by direct measurement over the proxy.
- **`companies` being under-declared** (§3c) — ruled out; both `route_defs.ts` entries and the
  prerender route are present. Only the committed artifact is behind.
