# Procurement project-lifecycle view — implementation plan v1

Status: DRAFT (2026-07-19). Owner: TBD. (Competitive research summarised in the session that produced
this doc; prior art = OC4IDS/CoST — kept out of the plan itself by request.)

One-line thesis: give ANY one public project — a road, a hospital, a school renovation, an IT
system, an EU-funded programme — its own **project file** (проектно досие) that stitches the whole
money chain onto one vertical timeline: tender прогнозна стойност → awarded contract → анекси →
payments, with an optional **"обявено срещу договорено срещу еталон"** (announced vs procured vs
benchmark) honesty header. The file is **seeded by a text search and refined by manual add/remove**;
the УНП spine pulls tenders, contracts, annexes and payments together automatically. Nobody in
Bulgaria does this; the closest global prior art is OC4IDS/CoST, and we already hold every
ingredient in Postgres.

**Not construction-specific.** The €/km benchmark below is a roads-only *optional* enrichment; the
core product is domain-agnostic — a timeline + the announced-vs-contracted gap works for any project.

---

## 0. Pre-implementation audit — corrections that SUPERSEDE the text below

Where §0 conflicts with a later section, §0 wins.

### 0a. BLOCKERS / hard truths — resolve before writing code
- **A text search seeds, humans refine — the search alone is never trusted.** The founding case
  (Sofia ring road SW arc / Югозападна дъга) proved the lexical ceiling: on the tenders side ALL
  matches say only "Софийски околовръстен път" — the relevant prep tender and the tangential
  Ломско-шосе widening tender are lexically identical; the distinction (ring road as OBJECT vs as
  LANDMARK) is semantic and search cannot resolve it. **Resolution: membership = a saved search +
  a manual include-set − a manual exclude-set** (§2). The search gives recall; the user removes
  false positives it dragged in, and adds true positives it missed (offered via a *looser* candidate
  search). The stored artifact is `{search, threshold, includes[], excludes[]}` (full shape §2), not a raw query result
  and not a frozen id-list — reproducible AND curatable, and it stays live so a newly-signed contract or the
  long-awaited construction tender auto-appears for review. (Mirrors the sector-pack rule: never
  trust a name regex unattended — `reference_awarder_group_model`.)
- **The €1bn is a budget-law allocation, not a procured value.** For the Sofia ring road the €1bn
  (~2.1bn BGN, Zhelyazkov cabinet 2026–2028) was an *announced ask* — later largely redirected
  (~€920M to Хемус + Видин–Ботевград, leaving ~€166.7M) — with **no construction tender in the
  corpus at all**. The page must never present an announced figure as if it were contracted. The
  "announced vs procured" gap is the whole point, so the budget number is a **curated, sourced,
  clearly-labelled** field on the project — not something joined from a procurement row.
- **Cost-overrun / forecast-vs-actual on `tenders.estimated_value_eur` is data-gated and mostly
  dishonest.** Per `project_api_road_effectiveness`: `estimated_value_eur` is semantically
  inconsistent (sometimes a copy of the award ratio 1.00, sometimes a whole-procedure ceiling vs a
  single-lot contract), and the contract→tender join is only ~11–23% on roads. **Do NOT compute a
  naive overrun ratio.** The honest comparison is: curated announced budget vs Σ contracted
  (`amount_eur`) vs a €/km benchmark from comparable projects. Per-contract forecast→signing→current
  is fine where a clean УНП lineage exists (it renders already — see `ContractValueBases`).
- **€/km benchmark must reuse the guarded engine, not raw amount/length.** `src/lib/roadAttributes.ts`
  already exists; only ~7% of road rows carry a defensible €/km after workType-gate + segment-parse +
  plausibility floor, and it must be bucketed by (workType × roadClass), never a portfolio mean
  (`project_api_road_effectiveness`). The benchmark is a **curated range** on the project (e.g.
  "comparable АПИ design-build: Габрово Shipka bypass €14.5M/km; Струма Кресна ~€20M/km → a realistic
  8 km build ≈ €150–400M"), optionally cross-checked against the live engine — not a live per-project
  computation in P1.

### 0b. ARCHITECTURAL CORRECTIONS (reuse, don't reinvent)
- **Lineage join key is УНП, never ocid** (`reference_contract_tender_lineage`). `tender_detail(unp, ocid)`
  already joins awards `WHERE c.unp = t.unp`. A project's tender↔award threading uses this.
- **The headline money basis is Σ per-row `amount_eur`** (current/post-annex value), never
  sum-per-currency-then-convert (`reference_procurement_eur_sum_basis`). `signing_amount_eur` drives the
  per-contract Δ. Reconcile at whole-euro grain.
- **Membership + fold engine already exists.** The sector-pack grammar (`SECTOR_BROWSE_PACKS` = an
  EIK-set + optional Section, folded by `awarder_group_model()` → `buildAwarderModelFromAggregates`) is
  the direct template. A **project extends it**: an EIK-set is too coarse (АПИ = 1 EIK, €10.66bn / 2,601
  contracts — a project is a tiny slice of it), so a project's membership is a **contract-`key` set +
  tender-`unp` set**, not just an EIK.
- **Value-ladder visual already ships.** `ContractValueBases` (in `ContractDetailScreen`) renders
  прогнозна → при сключване → текуща as scaled bars with a red Δ note. Reuse it per-member and as the
  project-level rollup.
- **Timeline event vocabulary already ships.** `DefenseProgramsTile` (span bars + milestone dots by kind)
  is the nearest existing lifecycle visual — borrow its event-node vocabulary, but the project timeline is a
  **bespoke vertical CSS tree**, NOT a Recharts chart and NOT the hero (the honesty totals block is the hero;
  the timeline is the body — §4.2).
- **No calendar from-to picker exists anywhere — don't add one.** Scope vocabulary is strictly
  `ns|all|y:YYYY` (`useProcurementScope`). A project view is intrinsically all-time for its members, so
  it largely sidesteps scope; do not introduce a date-range picker.

### 0c. INTERNAL CONTRADICTIONS resolved
- "Auto-derive membership" vs "curated" → **resolved as search-seeds-humans-refine.** Membership is a
  saved text search (recall) plus a manual include-set and exclude-set (precision), not an auto-classifier
  and not a frozen id-list. The included/excluded ids are stored; the search re-runs live (§2).
- "Construction/roads project" vs generic → **the product is domain-agnostic;** roads-specific bits
  (`sector:"roads"`, the €/km benchmark, `roadAttributes`) are OPTIONAL enrichments keyed off `sector`,
  never core. Most files will have no benchmark and that's fine.

### 0d. SMALLER GAPS
- No election-window column exists on `contracts`; scoping is app-side. A project view doesn't need it.
- **Payments — RESOLVED (2026-07-19): the dated-payment timeline node is not buildable in bulk; downscope it.**
  Two independent blockers (researched): (1) **No clean УНП↔ИСУН-project join key exists** — contracts carry
  only `eu_funded` (0/1) + `eu_program` (programme name); `fund_projects` carries `contract_number` (ИСУН БФП)
  + `beneficiary_eik`, no УНП. The only robust bulk join is **EIK (company)**; a **partial ~17%** contract-grain
  link is regex-recoverable from the free-text `europeanProgram` field (6,235 of 35,652 EU-funded rows embed a
  parseable BG16…-C01 code → joins `fund_projects.contract_number`); TED eForms BT-5010 is the only structured
  slot but is above-threshold/optional and not ingested. (2) **Even with a join, ИСУН bulk data has NO payment
  dates** — only `duration_months` + contracted/paid totals (dated tranches are behind the F5-WAF module,
  `isun-project-details-v1` SHELVED). So: render an EU-**funding annotation** (contracted/paid totals) at EIK
  grain, optionally upgraded to per-contract via the 17% regex — NOT a dated «плащане» node. A true complete
  key needs a ЗДОИ bulk request to АОП / ИСУН УО (МИДТ) — out of scope. **Not coming via data.egov.bg:** ИСУН
  dated payments + the award→payment link are recorded as structural gaps in `docs/egov-single-source-roadmap.md`
  §4 ("data that exists nowhere machine-readable") with the award→payment link only a Phase-5 *wish* in §5 —
  our proposal to МИДТ, not a committed deliverable; and data.egov.bg's own ИСУН datasets are frozen at 2018.
  So the "no dates" assumption is durable — design around it.
  **CLEANEST RESOLUTION (2026-07-19): let the curator do the join.** Because membership is a curated
  search+add, make ИСУН `fund_projects` a **searchable, manually-addable member type** (§4.3) — the user
  attaches the EU-funds project by hand, so NO auto-join key is needed at all; the EIK/regex links degrade to
  mere "add?" suggestions. The added project contributes contracted/paid **totals** (the funding block, §4.2),
  not dated events. Prereq: the combined search does NOT cover funds today (verified — `procurement-search`
  runs only contractors/awarders/contract-titles/tender-subjects); add a `search_fund_projects` fn (§4.1).

### 0e. GAPS FOUND IN AUDIT (2026-07-19) — resolve during Phase 1
- **Registry facts corrected (§4.1):** `tenders_list.unp` and `contracts_list.key` are NOT filterable today;
  `contracts_list` may not project `unp`. The spine needs `unp filter:"in"` on both tables + `tag IN ['contract']`.
- **Annex event detail needs a new `annexes` resource (§4.1 step 2b)** — only the net Δ is exposed now.
- **Resolution formula now encodes the lots_count guard (§2)** — siblings are members only when few lots.
- **DIY breadth cap + URL-list validation (§4.1)** — cap over-broad searches; bound/validate URL-provided ids.
- **i18n:** follow the sector-pack convention — **bilingual-inline** (`const bg = lang==="bg"`, no i18n keys
  except a nav label). Curated `title`/`thesis`/`note` are `{bg,en}`; DIY files inherit the searched (BG) text.
- **Testing:** the resolver is pure logic — unit-test lot fan-out, dedup, the over-expansion guard, confidence
  scoring, and the fold (Vitest, co-located, per CLAUDE.md). `__project_lint.ts` is a data check, not this.
- **`confidence()` compute location = client-side** (the search rows already carry titles; derive `distinctive`
  as the rarest query token, score in JS). No endpoint change; keep it explainable for the "защо е тук?" chip.
- **Empty / all-forecast state:** a project with договорено €0 (the ring road today) must still read as a
  report — lead with the gap + the празнина node, not a broken KPI. State the zero-contract layout.
- **Mobile:** the two-indent timeline tree collapses gracefully at the article measure (date inline in the
  card header, not a separate rail; consortium co-signers under the contract, no third indent).

### 0f. RESEARCH-SPEED CORRECTIONS (2026-07-20) — grounded in the "elections cost" case
A live hand-analysis of a real topic (cost of running an election: **ballot printing** vs **machine voting**)
was assembled by hand from the corpus and exposed where this plan is *correct but slow for a researcher*. The
§2 model (search-seeds-humans-refine, УНП spine, honesty/gap) stands; these six close the time-to-insight gap.
**FOLDED into the body (2026-07-20):** multi-thread `search` (§2 formula + artifact), `recurrence` + the
per-cycle rollup (§4.2.2b), the cross-awarder `buyerEik` confidence rule (§2), the gap-node `reason`/authority
(§4.2.3 «празнина»), the extended `nature` taxonomy (§2/§4.4), starter templates (§4.3b/§10 P1), and the
broader-matches panel promoted to P1 (§4.3/§10). The `benchmark → unitCost`/compare generalization already
rides `benchmark.unit` (§2) + a compare route (§4.5).
The founding facts from that case (for the flagship + the tests): ballot printing = **Печатница на БНБ** (EIK
130800278), €18.6M / 19 contracts under ЦИК (EIK 176481459), ~€0.9–1.1M per plain parliamentary election;
machine chain = **Сиела Норма** (EIK 130199580), €67.4M; the printing awarder **moved МС → ЦИК ~2016** (pre-2016
printer = Мултипринт ООД, Костинброд, EIK 122013040); and — the crux — **paper-ballot transport & securing are
NOT procured** (state function via областни администрации + МВР on budget), while the *machine* transport/insurance
IS tendered. That asymmetry is the whole story.

1. **Starter templates belong in Phase 1, not Phase 3.** A researcher must not face a blank search box. Ship a
   small gallery of pre-built multi-term/multi-EIK **starter seeds** on the `/procurement/project` on-ramp +
   the picker footer ("Избори — машини срещу хартия", "Магистрала Хемус", a hospital) that populate `search`
   on click. This is a lightweight, uncurated *starter-search* list — NOT the committed curated-flagship track
   (still Phase 3, §10). Near-zero cost, the biggest single lever for "quickly research such topics." (Amends §4.3b / §10 Phase 1.)
2. **A seed is a SET of sub-searches, not one query (§2 model change).** The elections topic needed three
   lexically-disjoint terms with different scopes — `бюлетин` (printing), `СУЕМГ` (machine transport),
   `компютърна обработка` (IT processing). `search.terms + mode:"any"` cannot express "OR of phrases, each with
   its own `buyerEik`." **Change `search` to an array of `{terms, mode, buyerEik, distinctive, threshold}`
   threads, unioned** (`matched = ⋃ thread(search[i])`). One file then assembles a whole topic instead of the
   user running three searches and merging by hand. Back-compatible: a single-object `search` is a one-thread array. (Amends §2 resolution + the stored-artifact shape.)
3. **Promote the "broader matches" candidate panel to Phase 1.** When the user checks one ballot-printing
   contract, the file should immediately offer its sibling legs — "same awarder, other roles" via
   same-buyer + adjacent-CPV + УНП-neighbours (the ИО processing contract, the Siela transport). §4.2.6 / §4.3
   currently defer this to Phase 2, but it is the difference between two clicks and three separate searches —
   it is core to research speed, not enrichment. Move the looser-candidate panel + `+ добави` into Phase 1. (Amends §10 Phase 1/2.)
4. **Add a recurring-object (per-cycle) rollup — a genuinely missing view.** Elections are a *recurring* project,
   one instance per cycle; annual road maintenance and yearly IT support are the same shape. The single vertical
   timeline (§4.2) clusters ONE lifecycle and cannot render "all parliamentary printing 2016–2026" — yet the
   natural research pivot is **group-by-cycle** (the per-election table the hand-analysis produced). Add an
   optional "повтарящ се проект" fold: members grouped by election/year into a compact trend table + a small
   bar-per-cycle strip, above the timeline. Keyed off an optional `recurrence: { by: "cycle"|"year", label }`
   on the file. (New sub-section under §4.2; NOT a Recharts chart — CSS strip per the dataviz rule.)
5. **Upgrade «празнина» from "absent stage" to "done off-tender by X."** The paper-transport gap is not *missing*
   — it is *deliberately not procured*. For a researcher, "why isn't X here?" is as valuable as what is. The gap
   node (§4.2.3) gains an optional curated `{ reason, authority, basis, sourceUrl }` so it can state
   "логистика на хартиени бюлетини — държавна функция (областни администрации + МВР), не по ЗОП" instead of a
   bare dashed placeholder. This is the honesty thesis at its sharpest and the elections flagship's punchline. (Amends the «празнина» node in §4.2.3 + §2 artifact.)
6. **Generalize `benchmark` → a `unitCost` lens, and add a compare mode.** The machine-vs-paper insight IS a
   *normalized* number (€/глас) and a *two-file comparison*; the plan's `benchmark` is roads-only €/km and every
   file is standalone. (a) Generalize `benchmark.unit` to an arbitrary unit (`глас`, `km`, `случай`, `ученик`)
   with a curated denominator, rendered as a "единична цена" figure in the honesty block. (b) Allow 2+ files
   side-by-side (a thin compare route/param) so "машинен глас €3–5,30 срещу хартиен ~стотинки" is one screen.
   Both stay OPTIONAL/curated. (Amends §2 `benchmark`, §4.2.2 honesty block, §4.5.)

Smaller, from the same case:
- **Extend the `nature` role taxonomy beyond construction.** Add `печат`, `ИТ обработка`, `логистика`,
  `застраховане`, `доставка`, `услуга` alongside проектиране/строителство/надзор; CPV-division fallback stays. (Amends §2 `nature` + §4.4.)
- **A `buyerEik` scope must NOT feed confidence for cross-awarder topics.** The elections file spans two awarders
  (МС pre-2016, ЦИК after) plus областни администрации for local ballots — a buyer-EIK confidence boost (§2)
  would wrongly *demote* the true МС-era printing contracts. Rule: `buyerEik` is a recall filter only when the
  user sets it; it must never be an implicit precision signal on a multi-awarder file. Same-buyer stays a
  *boost* only within a single-thread search, never across threads. (Amends the `confidence()` rule in §2.)
- **Flagship candidate.** "Колко струват изборите" is the ideal first curated file for Phase 3 — it exercises the
  multi-thread seed (#2), the recurring rollup (#4), the off-tender gap (#5) and the unit-cost/compare lens (#6)
  all at once, and it already has a companion `naiasno-post` DATA card ready.

### 0g. FIELD-TEST — the Shishkov road-legacy claim (2026-07-20) — supersedes/extends the model

A live press statement by regional minister Ivan Shishkov (2026-07-20, faktor.bg / BTA / bgonair /
cross.bg) is the exact use-case this view exists for, and running it against the corpus both **validated
the design and exposed four missing pieces**. What Shishkov claimed: (a) the Видин–Ботевград modernisation
was contracted in-house without an open tender and split into 5 lots; (b) АПИ gave **35% advances** yet
some sections have no construction; (c) **~30 active major-repair contracts** are held by "фирми от
наследството" (legacy firms) named in the subcontract chains; (d) declared subcontractors were swapped for
others after award; (e) prosecutor signals + asphalt-quantity discrepancies.

**What our data confirms today (the design works):**
- The head object is one row: `contracts` — АПИ (EIK `000695089`) → **Автомагистрали ЕАД** (EIK
  `831646048`), **€461.4M**, `procurement_method = "Вътрешен конкурентен избор по РС"`, title
  «Модернизация на път I-1 (Е-79) Видин–Ботевград», dated 2020-10-02. A search-seeded project file lands
  on it immediately.
- The **in-house / no-open-tender mechanism is quantifiable**: АПИ awarded **€526.5M via «Вътрешен
  конкурентен избор по РС» (163 contracts) + €516.5M «Договаряне без предварително обявление» (124)** —
  ~€1.04bn steered without an open procedure. This is precisely Shishkov's "наследство" and it is a
  first-class field (`procurement_method`) we already hold.
- The **named legacy firms resolve as contractors**: Нивел строй €413M, Европейски пътища €303M, ПСТ Груп,
  Геострой, Пътстрой-92, Водно строителство-Благоевград — >€1bn combined, each with a `/company/:eik` page.
  Claim (c) is confirmable at the firm level today.

**What we CANNOT do yet — four additions (these are the improvements):**

1. **Competitiveness / award-method must be a first-class HONESTY node on the timeline, not just a table
   flag.** Shishkov's core complaint IS the award method (in-house, negotiation-without-notice, single-bid).
   §4.2 currently surfaces `computeProcurementRisk` only "inline in the tables" (§4.5). PROMOTE it: every
   contract node carries a **method badge** — `открита` (neutral) vs `вътрешен избор` / `договаряне без
   обявление` / `единствен участник` (`number_of_tenderers ≤ 1`) rendered as a red honesty flag. Add a
   project-level **"как е възложено"** strip in the honesty block: Σ contracted split by competitive vs
   non-competitive method (the €461M Видин–Ботевград reads "100% без открита процедура"). Data exists
   (`procurement_method`, `number_of_tenderers`; `computeTenderRisk.ts` / `useContractRiskFlags.tsx` ship). For
   **legacy rows the named method is blank and unrecoverable** — the strip falls back to a bid-count basis
   (конкурентно ≥2 / единствена оферта ≤1 / неуточнен), recovered by the `БРОЙ ОФЕРТИ` parser fix (§11
   blank-method resolution).

2. **Subcontractor chain is a STRUCTURAL GAP — render the absence (like payments, §0d).** The subcontract
   layer Shishkov names (Автомагистрали ЕАД → 25 sub-contracts / 856M лв per Сметна палата) is **NOT in the
   ЗОП corpus**: `contracts` has no subcontractor field, and Автомагистрали ЕАД **as awarder** shows only 16
   tiny rows (€1M) — the in-house state company's onward awards escape ЦАИС/АОП. So a project file for
   Видин–Ботевград captures the €461M head contract but **cannot show where the money went**. Add a
   **«подизпълнители» timeline node** that is honest about this: where a member's contractor is a state
   in-house company (a small curated `inhouseAwarderEiks` set — Автомагистрали ЕАД, etc.), render a dashed
   "паричната следа спира тук — подизпълнителите не се публикуват в ЦАИС" node, optionally with a curated
   `knownSubcontractors[]` list (sourced from Сметна палата / news). This makes claim (d) — the
   declared-vs-actual subcontractor swap — visible as a *known blind spot*, which is itself the finding.

3. **Advances vs physical progress — a curated honesty row (the «къде отидоха парите» question).** The whole
   claim (b) is 35% advance paid / nothing built. The honesty block today is announced-vs-contracted-vs-
   benchmark; it has **no advance/progress axis** and the corpus has no advance data (verified — no payments
   table for ЗОП). Add an OPTIONAL curated field `advance: { pctDeclared, amountEur, physicalProgressNote,
   source, asOf }` (Tier B, same status as `announcedBudget`) and a fourth honesty figure **«авансово
   изплатено»** with the progress note as a pull-quote. Absent → hidden. This is the single most
   citizen-legible number in the whole story and it will always be curated+sourced, never joined.

4. **A "провери твърдение" (fact-check a claim) on-ramp + a `claims[]` field.** The user's framing —
   *"quickly confirm/deny such statements"* — is a distinct entry point from "build a dossier". Add:
   - A **claim box** on `/procurement` ("Провери твърдение за обществена поръчка"): paste a sentence, we
     extract the object + firm/number and seed the project search, landing on the dossier with the honesty
     block answering the specific figure. (Reuses the picker; the AI `projectLifecycle` tool, §6, does the
     extraction once ≥3 files exist.)
   - A **`claims[]`** array on the project artifact: `{ text, byWhom, saidAt, sourceUrl, verdict, ourNumber,
     note }` — so the dossier literally prints "Шишков, 20.07.2026: «35% аванс, нищо построено» → нашите
     данни: договор €461M, метод «вътрешен избор», подизпълнители не се публикуват". Renders as a **claims
     ledger** section (potvarzhdava / oprovergava / chastichno) above the provenance footer. This is
     обективност-срещу-заглавието made explicit and is the sharpest differentiator vs SIGMA.

**These four are now folded into the body:** the model shape (§2 JSON: `advance`, `claims[]`,
`inhouseAwarderEiks`, `knownSubcontractors[]`, computed per-member `method`/`singleBid`); the honesty block +
timeline (§4.2: "как е възложено" strip, method badge, «подизпълнители» blind-spot node, «авансово изплатено»
figure, claims-ledger §4.2.6b); the on-ramp (§4.3b claim box); Tier B (§3); phasing (§10 — the method strip
in P1, the rest in P2); and risks (§11 — the blank-method caveat + the blind-spot honesty rule). None require
new ingest: (1) reuses existing columns; (2)'s node reuses them too; (2)'s subcontractor list, (3), (4) are
curated Tier-B fields.

---

## 1. Goal & thesis

**Goal.** A `/procurement/project/:slug` page (and an on-the-fly builder) that tells the money-story of
any one named public project across its whole procurement lifecycle in a single vertical-timeline scroll,
and — where the numbers exist — makes the honesty gap between what was *announced*, what was actually
*contracted*, and what a *benchmark* says it should cost impossible to miss.

**Thesis (why this wins).** Every existing tool — ours included — is siloed by *layer* (budget execution
here, contracts there) and grained at the *contract* or *procedure*, never the *project*. A public project
is lived as a story over years across many procedures; no platform assembles that story. The €1bn ring-road
headline is the archetype: a budget-law number with no contract behind it, impossible to fact-check
anywhere. A project file that threads tender→award→annex→payment on one spine — and, when a curated budget
figure exists, states "announced €X / contracted €Y / benchmark €Z" — is Наясно's editorial thesis,
обективност срещу заглавието, rendered as a reusable product.

**Persistence, staged (see §2):**
- **v1 — localStorage only.** Anyone types a search, prunes/adds rows, and **saves the project to
  localStorage** (the `/procurement/watchlist` precedent — no backend, no auth); the same `{search, …}` is
  URL-encoded so a file is shareable by link. This is the whole first version.
- **Later — user auth.** Accounts move saved projects server-side (cross-device, a "my projects" list, stable
  shareable URLs).
- **Later — curated flagship files.** Editorially-maintained, committed-JSON, prerendered + SEO'd dossiers
  (Sofia ring road etc.) — same artifact shape, a parallel editorial track, not gated on auth.

**Non-goals (v1).** Not a comprehensive registry (a few curated flagships + the DIY builder). Not an
auto-classifier (search seeds, humans refine). Not payment reconciliation for non-EU contracts (data absent
— shown honestly as "не се проследява").

---

## 2. The "project file" entity — data model

A project file is **a saved search + manual overrides**, generic across domains. Membership resolves as:

```
matched   = ⋃ᵢ [ search(sᵢ, contracts.title_fold) ∪ search(sᵢ, tenders.subject_fold) ]  // search is an ARRAY of threads sᵢ (§0f.2), unioned; each thread has its own terms/mode/buyerEik/distinctive/threshold
autoIn    = { r ∈ matched : confidence(r, r.thread) ≥ r.thread.threshold }  // per-thread threshold; a single-search file is a one-thread array
seed      = (autoIn ∪ includes) − excludes                                 // human precision (the checkboxes)
lineage   = tenders(seed.unps)                                             // contract → its procedure (+ its lots[])
          ∪ contracts(seed.unps, tag='contract')                          // procedure → its contract(s)
          ∪ siblingLots(seed.unps  WHERE tender.lots_count ≤ K)           // GUARD: auto-include siblings only when few lots;
                                                                          //        many-lot tenders → siblings are CANDIDATES, not members
          ∪ annexes(seed.contractKeys)                                     // contract → its amendments (needs the annexes resource)
          ∪ euFunding(seed.contractorEiks)                                 // EU-funded → ИСУН totals at EIK grain (~17% per-contract via europeanProgram regex); NO dated payments (§0d)
members   = dedup( (seed ∪ lineage ∪ includes) − excludes )               // includes force-add candidates; excludes prune; dedup by key/(unp,lotId)/unp
```

The УНП spine (§0b) does the stitching automatically — you search once over titles; tenders, their lots,
annexes and (where available) payments are pulled in via lineage, not searched for separately. **This is why
the search seeds the whole file, not just the contracts layer** — you select the договори/процедури you
recognise and the spine attaches their parent tenders, sibling lots + annexes without a second search.

**Multi-lot fan-out (contract → tender → lots → more contracts).** A tender (`unp`) has 1:N lots
(`tenders.lots` jsonb, each `{lotId, name, cpv, estimatedValueEur, nuts}` — a per-lot forecast, CPV and NUTS);
each lot is awarded to 1:M contracts (matched by the title prefix `"Обособена позиция N"` = `lots[].lotId`,
migration 050 — a *title-parsed* link, NOT a hard FK, so partial coverage). So one seed lot's contract
resolves to the whole procedure and every sibling lot. Rules:
- **Membership grains** — `contractKey` (finest, always available), `(unp, lotId)` (a lot; title-derived),
  `unp` (whole procedure), and — NEW — `fundContractNumber` (an ИСУН project, `fund_projects.contract_number`).
  `includes`/`excludes` may key any grain. Seed is contract-level from search; sibling lots are surfaced as
  in-thread candidates; **fund projects are manual-add only** (no lineage from a ЗОП contract — §0d — so a
  fund member is always an explicit `include`, contributing a funding block not a timeline event).
- **Over-expansion guard.** On resolving a seed's tender, gate sibling-lot inclusion by `lots_count`: few lots
  (a genuinely split single object, e.g. ОП1+ОП2 of one build) → auto-include all; many lots (a framework, a
  lot-per-oblast maintenance tender) → include only the matched lot(s), render the rest muted with `+ добави`.
- **Value semantics.** Project forecast = Σ of the **included lots'** `estimatedValueEur` (lot-precise) — NEVER
  the whole-tender `estimated_value_eur` when subsetting (it's inconsistent and would overstate). Contracted =
  Σ contract `amount_eur` over included-lot contracts (consortium splits already divided → sums cleanly).
  Never mix tender-level and lot-level estimates (double count).
- **Dedup.** Two lots of one tender both matched → ONE tender node, two lot branches. Dedup tenders by `unp`,
  lots by `(unp, lotId)`, contracts by `key`.
- **Coverage fallback.** A contract lacking the `"Обособена позиция N"` prefix can't be pinned to a lot — it
  attaches under the tender node without a lot badge. Honest, labelled. Future: persist a derived `lot_id`
  column the way 050 persists `lot_name`.

**Confidence & the checkboxes (the authoring gesture).** The picker (§4.3) is the existing combined-search
dropdown with a checkbox per row. `confidence(r)` is a transparent, explainable rule — NOT a classifier:
does the row carry a *distinctive* query token (e.g. "дъга") vs only a generic landmark token
("София"/"пътища"/"околовръстен"); + boosts for a matching road-ref/km-range and being УНП-linked to an
already-selected row. **`buyerEik` is a per-thread recall FILTER only, never a cross-file confidence boost**
(§0f): a multi-awarder topic — elections span МС pre-2016 + ЦИК after + областни администрации — would have
its true МС-era printing contracts wrongly demoted by a same-buyer signal. Same-buyer boosts only within a
single thread's own scope, never across threads. Rows `≥ threshold` are auto-checked; the rest show unchecked with a
"само спомената" (landmark-only) tag, one tap from inclusion. The checkboxes map straight onto the override
sets: uncheck an auto-checked row → `excludes`; check a below-threshold row → `includes`. The same score
becomes the row's "защо е тук?" provenance chip later. This is the object-vs-landmark call search alone
can't make (the founding Ломско-шосе / Самоков-София false positives) — surfaced as a score, decided by a human.

The stored artifact is tiny and the same shape in both tiers (curated flagship vs DIY build):

```jsonc
{
  "slug": "sofia-околовръстен-jz-дъга",              // omitted for DIY (URL-encoded instead)
  "title": { "bg": "…", "en": "…" },
  "search": [                                         // the seed — recall; an ARRAY of unioned threads (§0f.2). A single-search file is a one-element array.
    { "terms": "околовръстен дъга", "mode": "any",    // matched against title_fold + subject_fold; mode = phrase | all-words | any
      "buyerEik": ["000695089"],                      // optional per-thread recall scope (NOT a cross-thread confidence signal — §2 confidence rule)
      "distinctive": ["дъга"], "threshold": 0.6 }     // distinctive token(s) drive confidence (rarest query token); threshold = auto-check cutoff
  ],                                                  // multi-topic example: [{terms:"бюлетин",buyerEik:["176481459"]},{terms:"СУЕМГ"},{terms:"компютърна обработка"}]
  "recurrence": { "by": "cycle",                      // OPTIONAL — a recurring project (elections/annual maintenance): fold members into a per-cycle rollup (§0f.4)
                  "label": { "bg": "по избори", "en": "by election" } },
  "includes": { "contractKeys": ["<key>"], "tenderUnps": ["00044-2015-0031"],
                "fundContractNumbers": ["BG16M1OP001-1.001-0004"] },            // manual adds (incl. ИСУН fund projects)
  "excludes": { "contractKeys": ["<key>"], "tenderUnps": ["<unp>"] },            // auto-checked rows the user unchecked
  "nature":   { "00044-2015-0031": "construction" }, // OPTIONAL per-member role: проектиране|строителство|надзор|печат|ИТ обработка|логистика|застраховане|доставка|услуга (§0f); CPV-division fallback

  "sector": "roads",                                  // OPTIONAL — unlocks roads-only benchmark
  "status": "procurement",                            // OPTIONAL lifecycle phase for the header
  "thesis": { "bg": "…", "en": "…" },                 // OPTIONAL editorial paragraph
  "announcedBudget": {                                // OPTIONAL, CURATED & SOURCED — never joined
    "amountEur": 1070000000, "basis": "ЗДБ 2026 капиталова програма", "sourceUrl": "…", "asOf": "2026-01",
    "note": { "bg": "~€920M пренасочени; остават ~€166.7M.", "en": "…" }
  },
  "benchmark": {                                      // OPTIONAL, roads-only for now, cites comparables
    "unit": "eur_per_km", "low": 14500000, "high": 20000000, "km": 8,
    "comparables": [ { "name": "Габрово тунел Шипка", "eurPerKm": 14500000 } ]
  },
  "advance": {                                        // OPTIONAL, CURATED & SOURCED — no bulk advance data exists (§0g.3)
    "pctDeclared": 35, "amountEur": 161504000, "asOf": "2020-08", "sourceUrl": "…",
    "physicalProgress": { "bg": "участъци без започнало строителство", "en": "…" }
  },
  "inhouseAwarderEiks": ["831646048"],                // OPTIONAL — contractors that are state in-house cos; money trail stops here (§0g.2)
  "knownSubcontractors": [                            // OPTIONAL, CURATED — the sub-layer absent from ЦАИС (§0g.2)
    { "name": "Нивел строй ЕООД", "eik": "…", "amountEur": 0, "source": "Сметна палата", "note": {"bg":"…","en":"…"} }
  ],
  "claims": [                                          // OPTIONAL — the "провери твърдение" ledger (§0g.4)
    { "text": {"bg":"35% аванс, нищо построено","en":"…"}, "byWhom": "Иван Шишков (МРРБ)",
      "saidAt": "2026-07-20", "sourceUrl": "https://faktor.bg/…", "verdict": "chastichno",
      "ourNumber": {"bg":"договор €461M, метод «вътрешен избор»; подизпълнители не се публикуват","en":"…"} }
  ],
  "curator": { "by": "…", "verifiedAt": "2026-07-19" }  // curated tier only
}
```

Every **member node also carries a computed (not stored) `method` + `singleBid` flag** — derived from
`procurement_method` / `number_of_tenderers` at fold time (§0g.1), driving the timeline method badge and the
"как е възложено" honesty strip. Nothing to persist; it re-derives from the live rows.

Why this shape:
- **`search` gives recall, `includes`/`excludes` give precision** (§0a). Reproducible, auditable, and it
  cannot silently drift into a false-positive because the exclude-set is explicit and versioned.
- **Live, not frozen.** A new contract or the long-awaited construction tender that matches the search
  auto-appears on next load (for review, in the curated tier) — the "did they finally procure it?" moment
  surfaces itself. `excludes` neutralises any future false positive.
- **Almost everything is OPTIONAL.** A minimal file is just `{search}`. Budget/benchmark/advance/thesis/nature
  and `claims`/`knownSubcontractors` are editorial extras that power the honesty header when present, absent otherwise.
- **`advance` + `claims` are the fact-check payload.** `advance` answers the «къде отидоха парите» question
  (the single most legible number, always curated — no bulk source, §0g.3); `claims` prints the confirm/deny
  ledger that IS the "провери твърдение" product (§0g.4). Both are dated snapshots with `sourceUrl`.
- **`inhouseAwarderEiks` marks where the money trail stops** — a member whose contractor is a state in-house
  company (Автомагистрали ЕАД) gets the «подизпълнители» blind-spot node (§0g.2); the sub-layer is not in ЦАИС.
- **`nature`** turns a flat list into a design→build→supervise narrative where labelled (the OC4IDS `nature`
  trick); defaults to the contract's CPV division otherwise.
- Each member deep-links: `tenderUnp` → `/procurement/tenders/:unp`, `contractKey` → `/procurement/contract/:id`.

**Storage (staged).**
- **v1 — localStorage.** The whole `{search, threshold, includes, excludes, + title/thesis/…}` artifact is
  saved under a `naiasno.projects.<id>` key (a "Запази проект" button), and also URL-encoded (`?q=`-style,
  §4.3) so it's shareable by link — exactly the `/procurement/watchlist` model. A "Моите досиета" list reads
  the localStorage keys. No file, no backend, no auth. `id` is a slug of the title (or a short client-side
  hash of the search) — NOT `Math.random`/timestamp in a memoized path.
- **Later — auth:** the same artifact persisted server-side (cross-device, stable URLs, sharing) once accounts
  exist. The artifact shape does not change — localStorage entries can migrate up.
- **Later — curated:** committed static JSON `data/procurement/projects/<slug>.json` + `index.json`
  (slug → {title, sector, status, headline}), like `data/defense/programs.json`, prerendered + SEO'd (§4.4) —
  same shape, authored with the same picker, exported to the repo.
- **Caveat:** localStorage is per-browser and can be cleared — acceptable for v1 (the shareable URL is the
  real backup); auth fixes durability. Say so in the UI ("запазено локално в този браузър").

### Curation is interactive, not a batch script
Both tiers use the SAME in-page editor (§4.2 "membership mode"), so curated files are authored with the
same tool users get:
1. Type/adjust the search → the resolved timeline updates live.
2. Each timeline row has a **× remove** (→ `excludes`) and a **"why here?"** chip (matched term / manually
   added / pulled via lineage from УНП X).
3. A **"broader matches"** panel runs a *looser* candidate search (fewer terms, or trigram-similar titles,
   or same-buyer+same-CPV, or УНП-neighbours of current members) — each candidate has a **+ add** (→ `includes`).
4. Curated tier only: an "export" copies the JSON to commit; a `__project_lint.ts` check asserts every
   include/exclude id exists in PG and no curated slug's seed claims another's exclude. CI-cheap.

This is the only sane answer to the "дъга vs Ломско шосе" problem and matches the field's own honest
admission (OC4IDS: without a project id in the source data, project↔contract association is *manual*).

---

## 3. Data source inventory (tiered by ingest cost)

- **Tier A — already ingested, zero new work:**
  - `contracts` (key, unp, ocid, amount_eur, signing_amount_eur, cpv, awarder/contractor eik, dates,
    procurement_method, number_of_tenderers, eu_funded) — the spend members. **`procurement_method` +
    `number_of_tenderers` also power the method badge + "как е възложено" strip (§0g.1) — no extra ingest.**
  - `tenders` (unp, estimated_value_eur, buyer_eik, subject, cpv, publication_date, procedure_type) — the
    procedure members.
  - Annex-folded current value (`amount_eur` already flipped; per-annex Δ via `signing_amount_eur`).
  - `roadAttributes.ts` (roadRef/length/workType/€-per-km) for the benchmark cross-check.
- **Tier B — curated, hand-authored (small, per project):** `announcedBudget`, `benchmark`, `advance`
  (§0g.3), `thesis`, `nature`, `status`, `claims` (§0g.4), `inhouseAwarderEiks` + `knownSubcontractors`
  (§0g.2). Sourced from budget-law text / АПИ & Сметна палата reports / ministerial statements / news. This
  is editorial work, not an ingest. (The cover's authority defaults to the dominant member `buyer_eik`; add an
  optional `publicAuthority`/`location` field only if the derived value is wrong.)
- **Tier C — optional enrichment:** budget-law line linkage (the `data/budget/investment_program/`
  Приложение III per-project capital allocations already exist for some objects — a real join candidate
  for the announced figure where the object is named there).
- **Tier D — stretch / future:** an EU-**funding annotation** (ИСУН contracted/paid totals) joined at EIK
  grain, optionally per-contract via the `europeanProgram` БФП-code regex (~17% coverage — §0d); a true dated
  ИСУН payments stage needs a ЗДОИ bulk request (out of scope). Plus geo polyline for a route map, TED/eForms
  `ProcedureIdentifier` threading for procedures not in ЦАИС.

---

## 4. Architecture — reuse against the sector-pack grammar

A project file is a **read-only fold over a live search + overrides**, so it needs almost no new backend.

### 4.1 Resolving members & folding the money (v1 = client-side, minimal new SQL)
The resolution in §2 is a few cheap DbDataTable calls + the УНП spine, all client-orchestrated. The picker
extends the existing global search component `src/layout/search/Search.tsx` (+ `SearchContext`/`SearchItems`).
- **Fund projects as a member type (search prerequisite).** The combined search `/api/db/procurement-search`
  (`ProcurementSearchTile`, schema `035_procurement_search.sql`) currently runs only `search_contractors` /
  `search_awarders` / `search_contract_titles` / `search_tender_subjects` (+ client-merged persons) — **no
  ИСУН funds**. Add a `search_fund_projects($1,$2)` fn (trigram/FTS over a `subject_fold` on `fund_projects`,
  same shape as the other four; `fund_projects` is already in PG with title + `contract_number` +
  `beneficiary_eik` + contracted/paid/status) and a 5th "ЕВРОФОНДОВЕ · проекти" group in the endpoint + tile.
  Then a fund project is an addable member (§4.3) — the curator performs the ЗОП↔ИСУН join by hand (§0d).
- **REGISTRY work (corrected — the earlier "already filter:in" claim was wrong).** In `functions/db_table.js`:
  `tenders_list.unp` is currently `{type:"text"}` with NO filter, and `contracts_list.key` has no filter.
  Add `filter:"in"` to `tenders_list.unp` and `contracts_list.key`; **verify `contracts_list` even projects
  `unp`** (add the column + `filter:"in"` if missing) — the whole spine needs `unp` filterable on BOTH tables.
  `contracts_list.tag` is already `filter:"in"` (use it — next bullet). `buyer_eik`/`awarder_eik` are `in`.
- Step 1 — **seed**: one `contracts` search (`title` text + optional `awarder_eik IN` + **`tag IN ['contract']`**
  so amendment/award rows aren't pulled as duplicate contract nodes) and one `tenders` search (`subject` +
  optional `buyer_eik IN`) → matched rows; apply `includes`/`excludes`.
- Step 2 — **lineage + lots** (the spine): fetch `tenders WHERE unp IN (...)` (brings each procedure's `lots`
  jsonb) and `contracts WHERE unp IN (...) AND tag IN ['contract']` (brings sibling-lot contracts). Apply the
  §2 **over-expansion guard**: for a tender with many lots keep only the matched lot's contracts as members,
  the rest as candidates (title→`lotId` via `contractTitle.ts`).
- Step 2b — **annex detail (NEW — not currently exposed).** `contracts_list` only projects the *net* folded
  Δ (`amount_eur` − `signing_amount_eur`), not per-annex events. To render annex nodes with **date +
  `changeReason` (чл.116)**, add an `annexes` DbDataTable resource (or a small fn) over the anexi feed keyed
  `(unp, contract_id)`. If deferred, the annex node degrades to "net Δ only" (no date/reason) — state which.
- Step 3 — **fold** byCpv / byYear / byContractor / byNature client-side. Money basis = Σ `amount_eur`
  (whole-euro reconcile, `reference_procurement_eur_sum_basis`); forecast = Σ **included lots'**
  `estimatedValueEur`, falling back to a labelled "прогнозна: непълна" when a lot's estimate is null (never
  silently undercount, never substitute the whole-tender estimate — §2). Dedup by key / (unp,lotId) / unp.
- **Breadth cap (DIY).** Refuse to build a file from an over-broad search (e.g. > ~300 matches): prompt to
  narrow. Validate + bound URL-provided `includes`/`excludes` id-lists before they hit any `IN` (registry
  guard + a hard length cap). Curated files are editor-bounded so this is a DIY concern.
- **No new SQL fn in v1** (beyond the registry flags + the optional `annexes` resource). If a curated file
  ever grows large, promote to `project_model(keys[], unps[])` mirroring `awarder_group_model` (§5).

### 4.2 The page — a REPORT, not a dashboard
The project file is document-shaped, so it uses the **`ArticleLayout`/`ArticleProse` family**
(`project_article_layout`), NOT the wide dashboard shell — a constrained editorial measure, serif title in
Наясно's voice (`--font-voice`), single vertical scroll, no tabs. It must read like a printed dossier both
on screen and as an exported PDF (§4.7). Numbers are **large display totals, not KPI tiles** (per the user
and the mockup). Sections top→bottom:
1. **Cover block** — brand row ("Наясно · проектно досие" + generated date + the PDF button), the authority
   + lifecycle status, the serif title, and a one-line thesis subtitle.
2. **Honesty block (the hero) — big totals, not chips.** Two-to-four large display figures side by side:
   договорено (Σ `amount_eur`) · обявено (curated budget, muted) · **авансово изплатено** (curated `advance`,
   muted — present only when curated, §0g.3) · еталон (curated benchmark, muted). Below them the three-bar
   comparison on one scale, then the gap statement as a serif pull-quote ("от обявените €1.07 млрд са
   договорени 9% · строителна процедура още няма") — the comparison SIGMA stores-but-won't-make. When
   `advance` exists, its `physicalProgress` note becomes a second pull-quote ("35% авансово изплатено · участъци
   без започнало строителство" — the «къде отидоха парите» line). When no budget is curated it degrades to
   just the договорено total + span (still large-format, no tiles).
   - **"Как е възложено" competitiveness strip (§0g.1).** A thin CSS bar directly under the totals splitting
     Σ contracted by award method — открита процедура (neutral) vs вътрешен избор / договаряне без обявление /
     единствен участник (red). Derived at fold time from each member's `procurement_method` /
     `number_of_tenderers` — no new data. The Видин–Ботевград file reads "€461M · 100% без открита процедура",
     which is precisely Shishkov's "наследство" complaint, quantified.
   Secondary figures (# процедури, # изпълнители, прогнозна стойност labelled "не разход", EU-funded share)
   read as a compact inline stat line under the hero, not a tile grid.
2b. **Повтарящ се проект — per-cycle rollup (§0f.4).** Present only when the file carries `recurrence`
   (elections per cycle, annual road maintenance, yearly IT support). The single vertical timeline (#3) renders
   ONE lifecycle and can't show "all parliamentary printing 2016–2026"; the natural research pivot is
   group-by-cycle. Render a compact trend table (one row per election/year: Σ contracted, # contracts, top
   contractor, method mix) + a thin bar-per-cycle CSS strip, *above* the timeline. A plain CSS strip, not a
   Recharts chart (dataviz rule). Members are grouped by `recurrence.by` (cycle|year).
3. **The vertical timeline (the body — see the multi-lot mockup).** One time spine, chronological, a **thread
   per procedure** clustered on the spine. A thread is a small TREE (procedure → lots → contracts → annexes),
   because a tender fans out into lots (§2):
   - **процедура** (tender) — hollow ringed marker at `publication_date` on the spine; shows procedure type,
     buyer, `lots_count`, and Σ прогнозна of its included lots. Deep-links `/procurement/tenders/:unp`.
   - **обособена позиция / ОП** (lot) — an indented branch under its tender (dashed connector); shows lot name,
     a role badge from `nature`/lot CPV, and the lot's `estimatedValueEur`. A single-lot tender collapses this
     level (no ОП badge). **Sibling lots not in the file** render muted with `не е част · + добави` (the
     over-expansion guard surfaced as a candidate — §2).
   - **отменена процедура** (cancelled tender) — a distinct struck/greyed node when `tenders.is_cancelled`.
     Story-relevant (a tendered-then-cancelled build is the ring-road narrative) — show it, don't drop it.
   - **договор** (contract) — filled marker under its lot; contractor (→ `/company/:eik`), signed value, role
     badge, and a **method badge** (§0g.1): `открита` neutral, or a red `вътрешен избор` / `договаряне без
     обявление` / `единствен участник` (`number_of_tenderers ≤ 1`) from `procurement_method`. Deep-links
     `/procurement/contract/:id`. Consortium co-signers group under one lot.
   - **подизпълнители** (subcontractor blind-spot — §0g.2) — when the contractor EIK is in the file's
     `inhouseAwarderEiks` (a state in-house company, e.g. Автомагистрали ЕАД), a dashed node under the договор:
     "паричната следа спира тук — подизпълнителите не се публикуват в ЦАИС", listing any curated
     `knownSubcontractors[]` (sourced). Renders the *known blind spot* — the sub-layer (856M лв per Сметна
     палата on Видин–Ботевград) is absent from the ЗОП corpus, so the absence itself is the finding.
   - **обжалване** (КЗК appeal) — a badge/flag on any member carrying `has_appeal`/`appeal_upheld` (already
     projected on `contracts_list`, migration 042) — a free delay/dispute signal on the timeline.
   - **анекс** (amendment) — a `ti-git-branch` caret off its contract; Δ value + `changeReason` (чл.116); red
     when the value grew. Reuse `ContractValueBases` inline for the прогнозна→сключване→текуща ladder.
   - **финансиране от ЕС** (EU-funding annotation, NOT a dated payment) — for an `eu_funded` member, a small
     annotation with the ИСУН contracted/paid totals, linked at EIK grain (the beneficiary's ИСУН projects) or
     per-contract for the ~17% where `europeanProgram` embeds the БФП code. **No dated «плащане» node** — ИСУН
     bulk data has no payment dates (§0d). Otherwise a muted "плащания: не се проследяват" line — honest.
   - **празнина** (gap) — a dashed placeholder for an expected-but-absent stage ("строителна процедура за
     последните 8 км — още не обявена"). Rendering the *absence* is core to the honesty thesis. **Optional
     curated `{ reason, authority, basis, sourceUrl }` (§0f.5)** upgrades it from "missing" to "done off-tender
     by X": "логистика на хартиени бюлетини — държавна функция (областни администрации + МВР), не по ЗОП" —
     "why isn't X here?" answered, the elections flagship's punchline.
   - Each row: a small horizontal money bar (scaled to the file max), a **× remove** (membership mode, at the
     row's grain — lot or contract), and a **"защо е тук?"** provenance chip.
   - Build as a bespoke CSS/flex component (the mockups are pure CSS — dataviz rule: heroes are CSS). Two indent
     levels (spine → lot → contract); borrow the event-node vocabulary from `DefenseProgramsTile`, vertical.
3b. **Европейско финансиране (ИСУН) block** — present only when the file has ≥1 fund-project member (§2).
   Each added ИСУН project renders a card: programme badge + `contract_number`, beneficiary (→ `/company/:eik`),
   **договорено / изплатено / усвоено %** (a disbursement bar — real ИСУН data), status, and a provenance chip
   (`добавен ръчно` or, if we ship the suggestion helper, `съвпадение по ЕИК`) with a `× remove`. An honest note:
   "ИСУН публикува договорени и изплатени суми, но не и дати на плащане" — so no dated tranches (§0d). In the
   timeline this also shows as the single **финансиране от ЕС** annotation node (dateless), not a «плащане» event.
4. **Money split by role/CPV** — проектиране / строителство / надзор / печат / ИТ обработка / логистика /
   застраховане / доставка / услуга (the extended `nature` taxonomy, §0f), `nature`-first, CPV-division
   fallback. CSS flex bars.
5. **Contractors table** & **procedures table** — scoped `DbDataTable` over the member sets; rows deep-link
   to `/company/:eik` and `/procurement/tenders/:unp`. Inline member-level red flags via `computeProcurementRisk`.
6. **Membership editor (mode toggle, screen-only)** — the §2 interactive curator: the search box + "broader
   matches" candidate panel with `+ add`, and every row's `× remove`. Curated tier adds "export JSON"; DIY
   tier writes to URL/localStorage. This whole block is `@media print`-hidden (§4.7) — controls aren't report.
6b. **Проверка на твърдения (claims ledger — §0g.4)** — present only when the file has ≥1 `claims` entry.
   Each claim renders a row: the quote + who-said-it + date (→ `sourceUrl`), a verdict pill
   (потвърждава / опровергава / частично), and **нашите данни** — the grounded counter-number pulled from the
   file's own totals (договорено, method mix, advance, blind-spot). This is обективност-срещу-заглавието made
   literal and the sharpest differentiator vs SIGMA. Prints in the PDF (it *is* the report). Curated tier only
   in v1 (DIY files stay unbranded to avoid a user claim reading as a Наясно verdict — §11).
7. **Provenance footer** — the search string, includes/excludes counts, `verifiedAt`, and sourced links for
   any curated budget / benchmark / advance / claim (method transparency — the Наясно data-map ethos). Doubles
   as the PDF footer.

### 4.3 The picker: the combined-search dropdown IS the on-ramp
The starting gesture for every file — curated or DIY — is the **existing combined-search dropdown**
("Търсене в обществените поръчки") extended into a selection surface:
- Each result row (across the ДОГОВОРИ, ПРОЦЕДУРИ and — once `search_fund_projects` ships (§4.1) —
  ЕВРОФОНДОВЕ sections) gets a checkbox; ЗОП rows scoring `≥ threshold` (§2) are pre-checked, the rest show
  unchecked with a "само спомената" tag. **Fund-project rows are never auto-checked** (no lineage — manual add
  only). "Виж всички (N)" expands the preview to the full result set for review, not a separate page.
- A primary "Създай досие · N избрани" button turns the current selection (+ its УНП lineage) into a file:
  the search terms → `search`, the unchecked-confident rows → `excludes`, the checked-unconfident rows →
  `includes`. Nothing to hand-assemble — the search you already ran becomes the dossier.
- The same component serves every persistence stage: v1 a citizen builds a file (state → URL + localStorage);
  later an editor authors a curated file (then "export JSON"); the gesture is identical.

### 4.3b Where it lives in the hub + routes
- **v1 routes:** `procurement/project` + `?q=<encoded {search,threshold,includes,excludes}>` (the builder /
  viewer, localStorage-mirrored + shareable — `/procurement/watchlist` precedent, no backend) · `procurement/projects`
  ("Моите досиета", reads localStorage keys).
- **Later routes:** `procurement/project/:slug` (curated file, prerendered) folded into the same screen; the
  index gains the curated flagships.
- Entry points: a "Създай досие на проект" tile on `/procurement`; the picker's "Създай досие" button in the
  global search dropdown; a **"проследи като досие"** action on any contract/tender detail page (seeds the
  search from that row's title + УНП, pre-checked). The natural on-ramp is the search a user already ran.
- **Starter templates (§0f.1) — a researcher must not face a blank box.** A small gallery of pre-built
  multi-thread **starter seeds** on the `/procurement/project` on-ramp + the picker footer ("Избори — машини
  срещу хартия", "Магистрала Хемус", a hospital) that populate `search` on click. A lightweight, *uncurated*
  starter-search list — NOT the committed curated-flagship track (Phase 3). Near-zero cost, biggest single
  lever for "quickly research such topics"; ships in Phase 1.
- **"Провери твърдение" claim box (§0g.4) — the fact-check on-ramp.** A prompt on `/procurement` ("Провери
  твърдение за обществена поръчка"): the citizen pastes a sentence from the news ("Видин–Ботевград взе 35%
  аванс и нищо не е построено"), we extract the object + firm/number, seed the project search, and land on the
  dossier whose honesty block + claims ledger answers the specific figure. This is a distinct gesture from
  "build a dossier" — it starts from a *claim*, not a search. v1 = keyword extraction into the picker; the AI
  `projectLifecycle` tool (§6) does the parse once ≥3 curated files exist.
- **Search-box → project page link.** The combined-search dropdown also carries a footer link
  ("Отвори като досие →") to the full-page builder `procurement/project?q=<current search>` — the picker in a
  roomy layout (checkbox list + live timeline preview) for when the dropdown is too cramped. Later smart case:
  if the query resolves to an existing curated file, the link points straight at `procurement/project/:slug`.
- Long-term citizen of the money-flows hub (`project_hubs_redesign`).

### 4.4 SEO
- **v1** files are localStorage/URL-based (user-generated, unbounded) → `noindex`, shareable by link, not
  crawled. No prerender in v1.
- **Later (curated track):** each committed **curated** file = one prerendered static page with its own OG
  card + sitemap `<loc>` (per `feedback_static_seo` / `project_sitemap_validity_audit`) — high-value, linkable,
  investigation-shaped URLs, exactly the discoverable long-form the SEO-discovery-gap memo wants.

### 4.5 World-best UI patterns to import (from OC4IDS/CoST + ProZorro DREAM prior art)
- OC4IDS/CoST national portals (Costa Rica MapaInversiones, CoST Ukraine/Thailand): per-project page =
  map + lifecycle stage bar + budget-vs-contract-vs-paid + firms + assurance findings. Our v1 = same
  spine minus the map (add geo in Tier D).
- Ukraine **DREAM**: project ID aggregates N ProZorro procedures + financing + physical progress, with
  the procurement layer *delegated* to the existing OCDS system rather than duplicated — validates our
  "thin project layer over the live corpus" architecture.
- DIGIWHIST/OpenTender red-flag library (single-bid, short window, non-open, concentration) — we already
  have this via `computeProcurementRisk`; surface member-level flags inline in the tables.

### 4.6 Report layout & totals (per the report reframe)
- Layout family = `ArticleLayout`/`ArticleProse` (`project_article_layout`), constrained measure, serif
  title via `--font-voice`, Наясно navy+coral (`project_naiasno_rebrand`) — NOT the dashboard shell / StatCard
  tiles. The page is a document that happens to be interactive.
- **Totals are large display figures**, set side-by-side with a small label above (see the report mockup):
  ~40px number, muted context figures for обявено/еталон, the договорено total emphasised. Reuse
  `formatEurCompact`; round every displayed number. Secondary counts collapse into one inline stat line.
- The gap statement is a serif pull-quote, not a callout box. The three-bar comparison is a thin CSS strip.

### 4.7 PDF / report export
- **MVP = print-to-PDF via a tuned `@media print` stylesheet + `window.print()`** behind an "Изтегли PDF"
  button. No new backend, no PDF lib — because §4.6 already makes the page a report, print CSS is mostly
  hiding chrome and fixing page geometry:
  - Hide: global nav/header/footer, the membership editor (§4.2.6), all `× remove` / `+ add` / mode toggles,
    deep-link affordances-as-buttons (keep the text). Everything interactive is `.no-print`.
  - A4 portrait, sensible margins; `break-inside: avoid` on each timeline thread and table row; repeat a
    lightweight running header (project title) + footer (source line + generated date + naiasno.bg URL +
    page number) via `@page`. Force light-mode tokens for print (a report prints on white regardless of the
    viewer's theme).
  - The cover block + honesty totals become page 1; timeline flows across pages; tables last.
- **Determinism / dating:** stamp the "изготвено {date}" from a build-time or request-time value passed in,
  never `new Date()` inside a memoized render path; for curated files use `curator.verifiedAt`.
- **Phase-2+ upgrades (optional):** (a) a true downloadable branded file without the browser print dialog via
  `@react-pdf/renderer` — a second, print-only component tree (more work; only if the print-CSS output isn't
  crisp enough); (b) a server-rendered stored PDF via a Firebase function + headless Chrome, for curated
  files, so the dossier has a stable shareable/attachable PDF URL and can feed a richer OG image. Defer both;
  print-CSS covers the DIY "download what I built" need at zero cost.
- Scope note: only the **report** surfaces export (curated `:slug` + the DIY full-page builder). The dropdown
  picker doesn't.

---

## 5. Data model & SQL performance
- v1 new SQL is small but NOT "one flag" (see the §4.1 correction): `filter:"in"` on `tenders_list.unp` +
  `contracts_list.key` (+ verify `contracts_list` projects `unp`), the `search_fund_projects` fn, and the
  optional `annexes` resource. Member fetch is a key-set `IN` query — index-backed (`key` is the PK). Tiny N
  per project → sub-10ms.
- If promoted: `project_model(p_keys text[], p_unps text[])` returning compact jsonb (headline +
  byCpv[] + byYear[] + suppliers[] + valueLadder), mirroring `awarder_group_model` (`061`), folded by a
  `buildProjectModel` in `src/lib/`. EXPLAIN ANALYZE the largest curated project before promoting
  (`feedback_db_query_perf`).
- Reconcile Σ member `amount_eur` at whole-euro grain (`reference_procurement_eur_sum_basis`).

## 6. AI chat tools
- `projectLifecycle(slug)` → the folded project model + honesty gap (договорено, method mix, advance,
  blind-spot, claims verdicts), for grounded answers ("how much of the €1bn ring road is actually
  contracted?" / "did Видин–Ботевград get 35% advance?"). Register under the existing procurement tool family
  (`project_ai_chat_tools`); numbers must pass the grounded-number gate (`project_ai_chat_grounding_gate`).
- **Claim-parse for the "провери твърдение" box (§0g.4):** the same tool extracts the object + firm/number
  from a pasted sentence and maps it to (or seeds) a project — the fact-check on-ramp's engine.
- Defer both until ≥3 curated projects exist.

## 7. Watchers & process-watch-report wiring
- No new watcher source — files derive from the already-watched `eop_procurement`/`egov_procurement`
  corpus. Because membership is a *live* search + overrides, a curated file's contents update automatically
  as new matching contracts/annexes (or the awaited construction tender) land — surfaced for review, not
  silently. Add a monthly `__project_lint.ts` to catch a stale include/exclude id that no longer resolves.

## 8. recent_updates / changelog
- N/A in v1 (localStorage files aren't a dataset). **Later (curated track):** each new curated file = one
  `data-changes.json` entry (`/data/updates`) + a PG `recent_updates` row (`feedback_pg_changelog_required`,
  `reference_two_changelogs`).

## 9. Data Map & README docs
- v1: note the feature + its method (search + manual include/exclude, live, localStorage) in the procurement
  README. **Later (curated track):** register `data/procurement/projects/*` in the Data Map (`/data/sources`)
  — method transparency is part of the product.

## 10. Phasing (localStorage builder first; curated + auth later)

**Phase 1 (shippable): the whole build→view→save→PDF→share loop, localStorage-only, no auth.**
- REGISTRY (§4.1): `filter:"in"` on `tenders_list.unp` + `contracts_list.key` (+ verify `contracts_list`
  projects `unp`).
- The §2 resolver (search → score → seed → УНП lineage → fold) as a client hook. Domain-agnostic.
- The §4.3 **picker**: combined-search dropdown with per-row checkboxes + confidence pre-check + "Създай досие",
  **multi-thread `search`** (§0f.2), **starter templates** (§0f.1), and the **"broader matches" candidate panel
  with `+ добави`** (§0f.3 — promoted from P2: two clicks beat three separate searches, core to research speed).
- `ProjectFileScreen` at `/procurement/project?q=<encoded>` in **report layout** (§4.2/§4.6 — `ArticleLayout`,
  large display totals, serif title; NOT dashboard tiles): cover, honesty block, the §4.2 vertical timeline
  (процедура/договор/анекс/gap; payments deferred), money-by-role, contractors table. Reuse `ContractValueBases`,
  `DbDataTable`; timeline + totals bespoke-CSS off the mockups.
- **Method badge + "как е възложено" strip (§0g.1)** — ships in P1: pure derivation from `procurement_method`
  / `number_of_tenderers`, no ingest, and it is the cheapest high-signal honesty element (the Видин–Ботевград
  "100% без открита процедура" line).
- **Save/share:** "Запази проект" → localStorage; `?q=` share link; "Моите досиета" list at `/procurement/projects`.
- Optional editorial extras entered inline for the ring-road file (curated `announcedBudget` + `benchmark` +
  `advance` + `nature`) so the honesty block is real — held in the saved artifact, not yet a committed repo file.
- **PDF export** (§4.7): `@media print` stylesheet + "Изтегли PDF" `window.print()` — in P1, cheap given the
  report layout, and a headline capability.
- Social card: "€1.07 млрд обявени · €X договорени · €150–400 млн по еталон" (`naiasno-post` DATA, fact-checked).

**Phase 2: on-ramps, richer curation, more example files.**
- The "проследи като досие" on-ramp from contract/tender detail + the search-box footer link (§4.3b).
  (The "broader matches" candidate panel moved to P1 — §0f.3.)
- **The "провери твърдение" claim box (§0g.4)** — keyword extraction into the picker (the AI parse waits for
  §6). Ships with the **claims ledger** section (§4.2.6b) + the `claims[]` field, curated-tier only.
- **Subcontractor blind-spot node (§0g.2)** — the «подизпълнители» dashed node keyed off `inhouseAwarderEiks`
  + curated `knownSubcontractors[]`, and the curated `advance` honesty figure + progress pull-quote (§0g.3).
  All curated Tier-B — authored inline on the Видин–Ботевград / ring-road flagships.
- **EU funds as a member type:** ship `search_fund_projects` (§4.1) + the ЕВРОФОНДОВЕ search group + the
  Европейско финансиране (ИСУН) block (§4.2.3b) — so a curator can hand-attach an ИСУН project (договорено/
  изплатено/усвоено %, no dates). This is how the "funding" stage lands, join-key-free (§0d).
- A handful of shared example files across domains (Хемус, Струма Кресна, a hospital/stadium, an ИСУН
  EU-funded object — the last exercises the funding block) to prove the engine isn't roads-specific — still
  as shareable localStorage/URL files, no backend yet.

**Phase 3: auth + curated track + differentiators.**
- **User auth** → server-persisted projects (cross-device, "my projects", stable shareable URLs); migrate
  localStorage entries up (same artifact shape).
- **Curated flagship track:** committed `data/procurement/projects/<slug>.json` + `index.json`, prerendered +
  SEO'd (§4.4), `procurement/project/:slug` route, member→file up-links, Data Map registration (§9).
- ИСУН payment stage (`isun-project-details-v1`); `project_model()` SQL fn if any file grows large; AI
  `projectLifecycle` tool; budget-line linkage to `data/budget/investment_program/` (Приложение III) so an
  announced figure is *sourced* not just curated; geo route line + map; roads-only €/km benchmark cross-check.
- **PDF upgrades (only if needed):** `@react-pdf/renderer` direct-download, and/or a Firebase-function +
  headless-Chrome server render giving curated files a stable shareable PDF URL + richer OG image (§4.7).

## 11. Open questions / risks
- **Curation cost & bias.** A search + include/exclude is far cheaper than a full id-list, but still
  editorial — publish the search string + include/exclude counts + verifiedAt per file so the method is
  auditable. Risk: accusations of cherry-picking; mitigate with the transparent provenance footer.
- **Live-search drift.** Because the search re-runs, a future contract could enter (good — the "did they
  finally build it?" signal) or a new false positive could appear (bad). Curated files need periodic
  re-review; the exclude-set neutralises bad entries permanently. DIY files are the user's own snapshot.
- **DIY abuse / quality.** User-built files are `noindex` and unbranded-as-editorial to avoid a bad search
  being read as a Наясно finding; the provenance footer states "изготвено от потребител, не редакционно".
- **Multi-lot fan-out & framework over-inclusion (§2).** One УНП → many lots → many contracts. A seed
  contract resolves to every sibling lot — desirable for a split single object, dangerous for a framework
  tender (lot-per-oblast). Gate by `lots_count`; keep sibling lots as candidates when many. Forecast = Σ
  *included* lots' `estimatedValueEur`, never the whole-tender estimate. Dedup by key / (unp,lotId) / unp.
- **Contract→lot linkage is title-parsed** (`"Обособена позиция N"` → `lots[].lotId`, `contractTitle.ts`),
  not a hard FK → partial coverage. Contracts without the prefix attach at `unp` level (no lot badge) —
  labelled honestly. Future: persist a derived `lot_id` column (as 050 does `lot_name`).
- **Announced- & advance-figure freshness.** Budget allocations get redirected (the €920M reroute) and
  advances are dated events. `announcedBudget.asOf` / `advance.asOf` + a note field; treat both as dated
  snapshots, not live numbers.
- **Subcontractor layer is a genuine blind spot, not a bug (§0g.2).** The money trail stops at the in-house
  head contract (Автомагистрали ЕАД → private firms is absent from ЦАИС). The «подизпълнители» node must read
  as *"не се публикува"*, never imply we've traced it. Curated `knownSubcontractors[]` is explicitly sourced
  (Сметна палата / news), so a reader can tell our data from a third-party finding.
- **Blank `procurement_method` — back-classification RESOLVED (2026-07-20).** 139,904 contract rows / €34.2bn
  corpus-wide (34%) carry an empty `procurement_method`; 117k are the `ocds-legacy-*` annual-AOP-CSV feed
  (`legacy_csv.ts`), the rest pre-2020 aop.bg. **The procedure NAME is unrecoverable:** the annual CSV has no
  procedure-type / правно-основание column at all (verified across 2016–2023 headers), and the УНП→`tenders`
  bridge yields only 106 rows (the tenders corpus starts 2020). Do NOT invent a named method. **But the
  competitive-vs-single-bid CLASS — all the "как е възложено" strip needs — IS recoverable:** the CSV carries
  `БРОЙ ОФЕРТИ` (bid count), which `legacy_csv.ts` silently dropped. Fixed 2026-07-20 (map `БРОЙ ОФЕРТИ` →
  `numberOfTenderers`); validated at ~100% coverage for 2016–2023 (2019: 39% single-bid, 2016: 30%). So the
  strip's bands are **конкурентно (`number_of_tenderers` ≥ 2) · единствена оферта (≤ 1, the red flag) ·
  неуточнен (no data)** — derived from bid count, NOT the named method, for legacy rows. Residual "неуточнен":
  the 2011–2015 JSON bulk (~125k rows corpus-wide) has no count column and stays honestly grey. **Local
  re-ingest DONE (2026-07-20):** of 266,546 blank-method rows, 141,260 (53%) recovered a bid count → 84,991
  competitive / 56,269 single-bid; АПИ alone gained 200 single-bid awards worth €331.8M. **Cloud SQL deploy
  pending** (`db:load:pg:cloud`, ~68min, operator-run in a quiet window — `reference_cloud_sql_deploy_perf`);
  until it lands, served rows still show legacy method as неуточнен.
- **Payments stage downscoped (§0d, researched 2026-07-19).** No bulk УНП↔ИСУН key (EIK = only robust join;
  ~17% via `europeanProgram` regex) AND ИСУН has no bulk payment dates → render an EU-funding annotation
  (totals), never a dated «плащане» node. Be honest ("плащания: не се проследяват").
- **Benchmark defensibility.** €/km comparables must be like-for-like (design-build, same road class);
  cite each comparable; never a portfolio mean.
- **УНП lineage coverage.** ≤2019 procedures join at ~0% (tenders corpus starts 2020); older members will
  be contract-only with no tender marker on the timeline — label the gap, don't hide it.

## 12. First social card (already in the data)
"Строим ли околовръстното? €1.07 млрд. бяха обявени в бюджета за 2026–2028. Договорени към днес: €X.
Реалистичен еталон за 8 км: €150–400 млн. Разликата е историята." (DATA card, grounded, sourced.)
