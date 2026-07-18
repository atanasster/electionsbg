# Procurement risk v2 — tender risk signals + the risk vocabulary contract

Status: DRAFT (2026-07-17). **Both §9 blockers resolved; full adversarial audit folded in
2026-07-17 — see §0 + §0c.** Owner: TBD.

## 0c. Audit summary (2026-07-17) — what a 5-front adversarial pass changed

Five parallel audits (code-vs-repo, academic literature, ЗОП legal text, EC Scoreboard, OCP +
Opentender/ARACHNE), each instructed to falsify. **No blocker fell; six claims did.** All fixes
are inline above/below; this is the index.

| Claim (as originally drafted) | Verdict | Now |
|---|---|---|
| "Five 0–100 risk numbers" | **wrong** | **Six** — added NZOK hospital `risk_index` (§1a). Strengthens §3. |
| C2 "8 not 9 because `appealUpheld` isn't selected" | **wrong (inverted)** | `appealUpheld` IS selected & available; the always-unavailable check is `shortTenderPeriod` (0%-populated `tender_period_*`). Verified. (§1c C2, §7.2) |
| §7 "make КЗК appeal available on the contract page" | **wrong** | Already available; real limit is sparsity — 106 upheld corpus-wide. (§7.2) |
| C1 "two 0–100s on the same screen" | **overstated** | Collides by cross-navigation, not same-screen (Топ договори tile has no risk column). (§1c C1) |
| §4b "keep `score` for flow-viz/My-Area/AI consumers" | **wrong** | Those importers don't exist; `score` has only 2 render surfaces. (§4b) |
| EU 10%/15% de minimis "is ЗОП law" | **wrong** | Not transposed — no "15 на сто" in ЗОП. (§0b, §7.1) |
| Opentender "25d/194d, 7.8× spread" | **unverifiable** | Not in cited D2.2; principle (per-country calibration) confirmed, numbers dropped. (§6b) |
| Decarolis "only study, vs convictions" | **wrong** | Validates vs investigations; not the only one. (§2) |

**What survived, re-confirmed against primary sources:** the weights de-dup (byte-identical,
plan-neutral); the €857M annex finding (raw-feed per-modification cliff, 60/87 АПИ single-annex,
re-confirmed independently); the ЗОП 50% cap is **cumulative** (stricter than EU, *helps* us);
every PRWP 10444 Table 2 band, the Decarolis numbers (F=0.597 etc.), the PwC marginal effects,
every EC Scoreboard figure + the "median" and corruption-disclaimer quotes; OCP's 73 flags +
both quotes verbatim.

**The one thing to check before PUBLISHING (not before building):** is АПИ's +50% growth the
чл. 116 ал. 2 ground, or ал. 3 inflation indexation (which stacks a separate 50%)? Until
answered, do not call it "the legal maximum." (§0b caveat 2.)

## 0. Blocker resolutions (2026-07-17) — SUPERSEDES the blocker notes in §7.1 and §8

### 0a. Weight duplication — RESOLVED (shipped)

The premise was wrong. `041`'s comment claimed the five buyer weights had to be inlined in
two SQL bodies because there is *"no way to share an expression across a STABLE fn and a
set-returning fn."* **The same file already disproves this** — `risk_grade_letter()` and
`upheld_appeal_share()` are scalar SQL helpers that *both* bodies already call.

Extracted **`awarder_risk_grade_frac(double precision × 5) → double precision`**, IMMUTABLE.
The weights now live in exactly one place; `awarder_risk_grade()` and
`awarder_risk_grade_window()` both call it.

Verified:
- **Byte-identical output** across all four surfaces — `awarder_risk_grade_ranking` (1,149
  rows), `awarder_risk_grade(eik)` (400 buyers), `supplier_risk_grade(eik)` (400 suppliers),
  `awarder_risk_grade_window('2024-01-01','2025-01-01')` (546 rows). `diff` clean on all.
- **Zero plan cost** — PG inlines it. `EXPLAIN (VERBOSE)` on the window fn contains no
  reference to `awarder_risk_grade_frac`; the `0.35/0.25/0.20/0.30` literals appear expanded
  in the plan. Worst-case per-entity (`175201304`, 7,538 contracts) 18 ms warm.
- **`npm run kzk:test` ALL PASS**, including `grade parity fn == matview`.
- Type parity is exact: every share is a double-precision ratio (`contracts.amount_eur` is
  `double precision`, 001) and `upheld_appeal_share()` returns double precision, so the
  numeric weight literals promote in the numerator and stay numeric in the denominator
  exactly as when inlined.

**§8's reweight is now a one-line change**, not a two-body lockstep edit. The
`kzk.harness.ts` parity test still guards fn==matview. The supplier weights
(`.30/.25/.20/.25`) appear only once and were left alone — no duplication to fix.

⚠️ **Deploy-path gotcha (verified):** `041` is applied ONLY by `load_tr_pg.ts:382` (guarded on
`to_regclass('public.contracts')`, alongside the K-Index), **not** by `load_pg.ts`. So a weight
change reaches a running DB via `db:load:tr:pg` / `db:load:tr:pg:cloud`, or a surgical
`apply_functions.ts 041_procurement_risk_grade.sql` — a plain `db:load:pg` will NOT pick it up.
After applying, `rebuildRiskGradeScoped()` runs in the same block; a surgical apply must re-fan
the scoped table itself.

### 0b. Annex retention — RESOLVED (decision made; the payoff is measured)

**The blocker was based on a wrong belief. The feed is not lost — it is fully retained on
disk and simply never reaches Postgres.** `raw_data/procurement/anexi/` holds **26,120 annex
records across 1,546 published days (2020-05-08 → 2026-07-15, 24 MB gzipped)**, cached by
`ingest_anexi.ts`. Every field Art. 72 needs is **100% populated**: `publicationDate`,
`lastContractValue`, `currentContractValue`, `contractValueDifference`, plus the join keys.
**No re-crawl is required.**

**Decision: retain → load to PG as an `annexes` table.** Scope is small (26k rows). The loader
**must reuse `anexi_current_value.ts`'s identity resolution** rather than reinvent it — K2
(`УНП|supplier`) tried first, then K1 (`buyer|contractNumber`), behind three guards (supplier
membership, a ±12% continuity anchor on the signing value, a 15× ratio cap). A second,
divergent notion of "this contract's annexes" would be worse than none.

**But most of §7.1 is reachable *today*, with no new infrastructure.** `signing_amount_eur IS
NOT NULL` already marks every contract an annex moved, so the **net-cumulative** Δ is
queryable right now. Measured on the local corpus:

| | |
|---|---|
| Contracts (`tag='contract'`) | 353,741 |
| …with an annex-moved value | **8,035 (2.27%)** — a healthy base rate, nowhere near OCP's 90% false-positive warning |
| Value moved up / down | 6,309 up · **1,726 down** (annexes *cut* value 21% of the time) |
| Net cumulative growth: p25 · **p50** · p75 · p90 · p99 · max | +0.9% · **+14.6%** · +49.2% · +103.1% · +644.0% · +1,366.7% |
| Over illustrative bands: >10% · >15% · >50% | 4,523 · 3,902 · 1,655 | *(only the >50% ЗОП чл. 116 ал. 2 cumulative cap is a legal threshold; 10/15% are the EU Directive's, NOT ЗОП — see caveat 4)* |
| Total extra value | **+€2,461M gross · +€2,132M net** |

⚠️ The **+€2,132M** here supersedes the +€1.75bn figure carried in project memory — a newer
corpus. Re-check before publishing either number.

**⭐ The finding: threshold-hugging at the 50% legal cap, and it is not subtle.**

The growth distribution decays monotonically — then breaks. Per-1% buckets:

| growth | 43% | 44% | 45% | 46% | 47% | 48% | **49%** | **50%** | 51% | 52% |
|---|---|---|---|---|---|---|---|---|---|---|
| contracts | 31 | 26 | 60 | 23 | 48 | 59 | **328** | **271** | **8** | 5 |

**328 contracts at 49% against ~30–60 in every neighbour, then a 34× cliff from 271 to 8 at
exactly 50%.** And **446 of the 594 contracts in [49%, 50.5%) sit at *exactly* +50.000%** — a
precise 1.5× multiplier, not a cluster. They span the whole size range, from a €6,257
kindergarten contract to a **€68,673,830 → €103,010,745 АПИ contract (+€34.3M, +50.000%)**.

The exactly-50.000% cohort: **446 contracts, +€909.8M of extra value.**

| awarder EIK | contracts at exactly +50.000% | extra value |
|---|---|---|
| **000695089 — АПИ** | **87** | **€857.5M** |
| 130823243 — НКЖИ | 7 | €10.7M |
| 130175000 — Софийска вода | 35 | €4.7M |
| 120503871 — МБАЛ | 82 | €3.1M |
| 000695235 — МВР | 2 | €3.0M |

**АПИ is 94% of it.** Cross-reference [[project_api_road_effectiveness]]: €857M of АПИ's €7.5bn
arrived via annexes priced to the decimal at the legal maximum.

**Additional verification (2026-07-17), all strengthening the finding:**
- **The cliff is in the RAW FEED, per-modification, with no join to our contracts.** Computed
  `lastContractValue → currentContractValue` straight off the 26,112 usable cache records:
  49% = 213 · **50% = 391** · 51% = **10** — a 39× cliff in the source data itself. Our fold
  did not manufacture it.
- **60 of АПИ's 87 are SINGLE-annex at exactly +50.000%** — one modification, at the cap,
  unambiguous. 23 are two-annex, 4 are three-annex. (81.5% of *all* annexed contracts have a
  single annex.) So caveat 1 below is real only for the 27 multi-annex АПИ contracts, not the 60.
- **АПИ figure re-confirmed independently:** 87 contracts, €1,715.0M → €2,572.5M, **+€857.5M**.
  Those 87 are **29.5% of АПИ's entire €8,718.8M** contracted value. (⚠️ АПИ total is €8.72bn,
  not the €7.5bn in [[project_api_road_effectiveness]] — newer corpus; re-check that memo.)
- **Stable every year 2021–2026** (1.2–2.7% of annexes land at exactly +50%) — not a one-off or
  a form change.
- The 8,035/€2,132M headline is a **lower bound**: the cache holds 19,836 annexed contract-keys
  but only ~8,044 match a PG contract (the fold's precision-over-recall guards). Script's own
  dry-run: 8,044 matched, net €2,136.4M — agrees with the PG query modulo shard vintage.

⚠️ **Caveats, revised after primary-source legal verification (чл. 116 ЗОП, consolidated text
to ДВ бр. 11/2024; confirmed unchanged by the 2025 amendments):**
1. **Cumulative IS the right basis in Bulgaria — this inverts the earlier worry.** EU Art. 72 is
   per-modification, but **ЗОП чл. 116, ал. 2 transposed it STRICTER: the 50% applies to
   "общата стойност на измененията" (the TOTAL value of successive modifications).** So our
   signing→current cumulative Δ is exactly the statutory basis. The 27 multi-annex АПИ
   contracts summing to 50% are at the cumulative ceiling *by the same rule* as the 60
   single-annex ones. The `annexes` table is still worth building for per-annex detail, but the
   headline claim does **not** hinge on it.
2. **The 50% ceiling is specifically for grounds ал. 1 т. 2 (additional unforeseen
   works/supplies) and т. 3 (unforeseeable circumstances).** Two ways "amended to the legal
   maximum" could still mislead, both to CHECK before publishing:
   - **чл. 116, ал. 3 (in force 22.12.2023): inflation indexation under чл. 117а has its OWN
     separate 50% ceiling that does NOT count against ал. 2.** Road/строителство contracts are
     exactly the category that got inflation indexation in 2022–23. So an АПИ contract could sit
     at +50% inflation (ал. 3) with the ал. 2 headroom *untouched* — meaning its true ceiling is
     higher, and "the legal maximum" understates it. **Must confirm АПИ's growth is ал. 2, not
     ал. 3.** (Consistent with our own finding that >50% growth occurs every year — see below.)
   - **чл. 116, ал. 6: sectoral (utility) awarders are EXEMPT from the ал. 2 cap.** АПИ is a
     classical public-sector awarder, not секторен, so this should not apply to it — but verify
     per-awarder before ever calling +50% "the maximum" (Софийска вода, in the same cohort, IS
     closer to sectoral — check it separately).
3. **NOT a hard ceiling nobody crosses.** >50% cumulative growth occurs every year (2.0–5.4% of
   annexes), and there are genuine round-number spikes at +100% (216 annexes) and +150% (28).
   50% is a value buyers **cluster against**, not a wall — frame it "clustered at the чл. 116
   ал. 2 cap," never "capped at 50%." The one-sided cliff (8.2× more mass just below 50% than
   just above, vs 1.6× at the round-number +20%/+25% control points) is what distinguishes a
   binding constraint from a mere round-number preference.
4. **The 10%/15% de minimis is NOT Bulgarian law — REMOVE it from §7.1.** ЗОП contains no
   "15 на сто" anywhere and no numeric de minimis; "non-substantial" changes are handled
   qualitatively (чл. 116 ал. 1 т. 7 / ал. 5). The 10%/15% figures are the EU Directive's only.
   Do not attribute them to ЗОП.
5. **An exact 1.5× could be computed by the form, not chosen by the buyer.** The exact-50.000%
   clustering is strong evidence a statutory percentage rule was applied, but which ground
   (ал. 2 vs ал. 3 inflation) it was, and whether the buyer or a source-side formula produced
   it, are separate questions. Do not assert intent.

⭐ This upgrades §7.1 from "a flag" to a publishable finding: **no empirical distribution of
contract-amendment growth exists for EU procurement** (§9), and ours has a 34× cliff at the
чл. 116 ал. 2 cap in it.

**Not an artifact of the matching guards** — they sit at 15× (`MAX_MULTIPLE`) and ±12% on the
signing anchor (`CONTINUITY_TOL`); neither can manufacture a discontinuity at 50% growth.

Two things that must ship together, in this order:

1. **A vocabulary contract** for the word "риск" across the site, plus the rename that
   enforces it (§2–§5). Cheap, no new data, unblocks the rest.
2. **An ex-ante tender risk signal set** (§6), plus three additions to the contract
   checks (§7) and a rebalance of the awarder weights (§8).

The rename is first because we currently ship **five 0–100 "risk" numbers** and **six
"flag" labels** with no scheme behind the nouns. Adding a sixth number at tender grain
without settling the vocabulary makes it permanently unfixable.

**Non-goal, decided:** no A–F letter grade per contract or per tender. §2 is the
evidence. If a later revision wants to reopen this, it has to answer §2 first.

---

## 1. What exists today

### 1a. Six 0–100 "risk" numbers

⚠️ **Corrected from "five" after audit — the NZOK hospital risk index was missed.** That only
sharpens §3: it is another 0–100 rendered under a bare "Риск"/"Risk" column.

| Label (BG / EN) | Grain | What the number actually is | Home |
|---|---|---|---|
| Оценка на риска при поръчки / Procurement risk grade | awarder, supplier | value-weighted share of money through risk-carrying channels; A–F banded | `awarder_risk_grade` / `supplier_risk_grade`, `scripts/db/schema/pg/041_procurement_risk_grade.sql` |
| Индекс на риска / Risk index | contract | fired ÷ available checks | `computeProcurementRisk.ts` (`cri`) |
| *(unlabelled)* | contract | additive weights, capped at 100 | `computeProcurementRisk.ts` (`score`) |
| Риск по болници / Risk (hospitals) | hospital | mean of 3 percentile ranks × 100 | `054_nzok_risk.sql:153` (`risk_index`), `NzokHospitalRiskTile.tsx`, `/awarder/121858220` |
| Скрининг на риска по секции / Section risk screening | polling section | composite of 7 signals, banded | elections |
| Индекс на изборния риск / Election risk index | election | composite of 5 signals, banded | elections |

(A 7th borderline: `NzokDrugRiskTile` "Риск по лекарства" is a €-overpay *ranking*, not a 0–100
index — excluded. Funds/ИСУН integrity is correctly NOT a 0–100 — HHI bands + serial-winner/
debarred flags — so it is not a collision.)

Plus **Колко типична е тази поръчка?** (`063_procurement_normalcy.sql`, `067_tender_normalcy.sql`)
— a descriptive percentile panel that deliberately carries no risk vocabulary. It is the
one surface in this whole area that is named correctly. Leave it alone.

### 1b. The flag vocabulary

Six labels, three concepts, and BG/EN drift on nearly every one:

| Key | BG | EN |
|---|---|---|
| `flags_title` | Сигнали за риск в поръчките | Procurement red flags |
| `flags_nav` | Рискови сигнали | Risk flags |
| `procurement_section_risk` | Рискови сигнали | Risk signals |
| `risk_cri_clear` | Няма сигнали за риск | No red flags |
| `funds_section_red_flags` | Сигнали за риск | Red flags |
| `integrity_page_title` | Сигнали за концентрация и риск | EU-funds red flags |

Note `flags_nav` and `procurement_section_risk` are **the same BG string under two keys
with two different EN strings**. And `risk_methodology_h_bands` / `composite_methodology_h_bands`
are identical in BG ("Категории на риска") but differ in EN ("Risk categories" / "Risk
bands"). The two languages are inconsistent in mirror-image directions — BG collides where
EN diverges and vice versa. Any fix has to be enforced per-key across both.

### 1c. The collisions that a real user hits

**C1 — the same 0–100 scale means different things one click apart (cross-navigation, NOT
same-screen).** ⚠️ *Corrected after audit.* The awarder overview (`CompanyDbScreen`) renders the
exposure grade ("8 / 100 · A", `по 689 договора`, `EntityRiskGradeCard`) and a `CompanyTopContractsTile`
— but that tile shows only title + amount, **no risk column**. So the two 0–100s do **not**
co-occur on one screen. The collision is by navigation: the grade card is a 0–100 at
`/awarder/:eik`; click through to `/awarder/:eik/contracts` and every row carries a *different*
0–100 (the contract `score`) under a "Риск" column, on the same visual scale, with no cue that
the awarder's 8 and a contract's 20 are unrelated quantities.

**C2 — the table and the detail page show different numbers for the same contract.**
`ContractsBrowserDbScreen.tsx:191` and `CompanyContractsDbScreen.tsx:181` render
`<RiskBadges ... showScore />`, which prints **`score`** (the additive legacy key,
`RiskBadges.tsx:61`). `ContractDetailScreen.tsx` renders `variant="full"`, which prints
**`cri`** (`RiskBadges.tsx:341`). Same contract, one click apart, two bare 0–100 numbers,
neither labelled in the table.

Worked example — a contract whose only fired check is `directAward`: table shows **20**
(`WEIGHT_DIRECT_AWARD`), detail shows **13** (`round(100 × 1/8)`). A contract whose only
fired check is `debarred`: table shows **80**, detail shows **13**. The table implies the
second is 4× the first; the detail page says they are identical. Both are "true" — they are
answers to different questions that were never given different names.

> The **8** in `round(100 × 1/8)` is the available-check count, and its cause is **not** what an
> earlier draft said. Of the 9 checks, exactly one — **`shortTenderPeriod`** — is *always*
> unavailable on every contract, because `contracts.tender_period_*` is **0% populated**
> (verified: 0 / 357,240). `appealUpheld` is **already selected** by `useContract`
> (`CONTRACT_SQL`, `db_routes.js:52`, a never-null boolean) and is therefore *available* — so
> "8 not 9" is the shortTenderPeriod gap, not an appeal-join gap. (The plan's own arithmetic
> proves it: if appealUpheld were *also* unavailable, availableCount would be 7 and cri would be
> `round(100/7) = 14 ≠ 13`.)

> The Риск column is **not** sortable (`enableSorting: false`, `ContractsBrowserDbScreen.tsx:188`),
> so there is no sort/display mismatch — the defect is the display/display mismatch above, which
> is worse: a sort anomaly is invisible, two contradicting numbers are not.

**C3 — the nouns carry no information.** "Оценка" for the awarder, "Индекс" for both the
contract CRI and the election composite, "Скрининг" for sections. Picked per-feature, not
from a scheme. A reader cannot infer grain or math from the noun, which is the noun's job.

### 1d. Two epistemics bugs found while inventorying

**E1 — "преминати проверки" / "checks passed" overclaims.** In Bulgarian *преминати
проверки* sits in the same register as `ipop_submitted_label` ("В проверка от МРРБ" — under
ministry review): it reads as having passed an official inspection. English "checks passed"
does the same work. Nobody inspected the contract; nine rules ran and eight had enough data
to evaluate. We are careful to say signal-not-evidence everywhere else, and then the contract
page quietly issues a clean bill of health.

**E2 — the English accuses and the Bulgarian doesn't.** `about_procurement_risk_note` is the
only string on the site that says **"Corruption Risk Index"**, and only in EN; the BG says
plain "Индекс на риска". Same key, same page, materially stronger claim in one language.

### 1e. Dead key

`procurement_flags_explore` (BG "Виж сигналите за риск в поръчките" / EN "See the procurement
red-flag feed") has **no consumer** anywhere in `src/`, `functions/`, `ai/`, `scripts/`. Delete.

---

## 2. Decision: no A–F letter per contract or tender

The awarder card is defensible because of the grey text under it: *по 689 договора*. It is an
exposure grade over hundreds of transactions. A contract is n=1.

- **World Bank PRWP 10444** (Fazekas, Poltoratskaia & Tóth 2023) — 148,637 **Bulgarian**
  contracts, 2011–2019, p. 10: *"Arguably, CRIs at the individual contract level may be quite
  noisy… when aggregating risk information at the organizational level, it is possible to
  identify more robust patterns. For example, a municipality that awards a high-risk tender
  every now and then may still be of high integrity but awarding nearly all its contracts with
  high corruption risks practices signals weak institutional control of corruption."*
  Same corpus as ours, World Bank-published. The named alternative to a high single-contract
  score, in Fazekas, Tóth & King (2016) p. 11, is *"random fluctuations in the data."*
- **Decarolis & Giorgiantonio (2022)**, EPJ Data Science 11:16 — a leading study validating red
  flags against firm-level **police-investigation** data on a near-population of Italian
  roadwork contracts (12,786 contracts; ground truth 15% investigated, and the authors
  **explicitly discard convictions as too rare to use** — 2% / 1%). ⚠️ *Corrected from an earlier
  draft that called this "the only study validating against convictions" — wrong on both counts:
  it validates against investigations, and PwC/Ecorys 2013 already validates against final
  rulings.* Verdict negative: *"the most obvious and scrutinized red flags are either
  uncorrelated with corruption or, even, negatively associated with it"* — urgency procedures
  and publicity ran **backwards**. Best realistic model F=0.597. Cost overruns do not proxy
  corruption (r ≈ 0.001). (The one flag that holds up *positively* is MEAT — multi-criteria
  award — which is the EU's *recommended* practice, a tension worth remembering before we score
  discretionary criteria.)
- **OCP (2024) p. 13** — the framing to adopt verbatim: a flag means the behaviour is
  *"a) not at all illicit or suboptimal; b) not illicit, but suboptimal in terms of value for
  money…; or c) illicit."* It names the two innocent explanations before the guilty one.
- ⚠️ Both OCP guides assume the reader is a **monitoring institution with a legal mandate**
  (DGCP, SERCOP, ANAC). No published guidance exists for a **public-facing publisher**. We are
  the latter. The conservative default is ours to set, and a red letter next to a named company
  on a named deal is read as a verdict, not a prior.

**Therefore:** the contract/tender surface stays a **checklist that fires or doesn't**, with
the normalcy panel supplying context. `063_procurement_normalcy.sql:6–13` already argues this
split well — judgment lives in the flags, normalcy supplies the context that makes a flag
legible. v2 keeps that boundary and removes the number that blurs it.

---

## 3. The vocabulary contract

One noun per kind of math, site-wide. Never reused across kinds.

| Noun (BG / EN) | Means | Grain | Owns |
|---|---|---|---|
| **Изложеност** / exposure | value-weighted share of money through risk-carrying channels | entity | awarder, supplier |
| **Сигнали** / flags | discrete binary checks | transaction | contract, tender, funds project |
| **Скрининг** / screening | statistical anomaly vs peers | section | elections *(already correct)* |
| **Индекс** / index | composite of other composites | election | election risk index only *(already correct)* |
| **Колко типична** / normalcy | descriptive percentile, no judgment | transaction | contract, tender *(already correct)* |

Three consequences fall out, and each fixes a problem we already had:

1. **The awarder card is renamed to exposure — which is what it always was.**
   `risk_grade_hint` already concedes it: *"сигнал за изложеност на риск"*. The card does not
   claim a ministry is corrupt; it says what share of its money went through channels that
   carry risk. Naming it exposure kills collision **C1** *and* stops the card overclaiming.
2. **The contract stops being an index and becomes a checklist** — which is §2's conclusion
   reached independently. Kills **C2** by deleting one of the two numbers from the UI.
3. **The tender signal set names itself**: transaction + flags ⇒ *Сигнали за риск при
   процедурата*. No new noun, no new scale.

**Explicit non-conflict:** `/indicators` uses "риск от бедност" (AROPE) and "риск от
престъпност" — same word, unrelated statistical meaning, established Eurostat term of art. Do
not touch it. Just never let integrity vocabulary drift into that view or vice versa.

---

## 4. The rename table

⚠️ **The BG wording below is a proposal, not a decision.** Per the house convention (natural
Bulgarian, not word-for-word from the English), every BG string here needs an ear-check before
it moves. Alternatives listed where the choice is genuinely open.

### 4a. Entity grade → exposure

| Key | Current BG | Current EN | Proposed BG | Proposed EN | Consumer |
|---|---|---|---|---|---|
| `risk_grade_title` | Оценка на риска при поръчки | Procurement risk grade | **Изложеност на риск при поръчки** | **Procurement risk exposure** | `EntityRiskGradeCard.tsx:55` |
| `risk_grade_board_title` | Възложители с най-висок риск (оценка) | Riskiest buyers (grade) | **Възложители с най-висока изложеност** | **Buyers with the highest risk exposure** | `RiskGradeLeaderboardTile.tsx` |
| `risk_grade_hint` | Претеглен по стойност сигнал за изложеност на риск (по модела на Hlídač státu) — показател за модел, не доказателство за нарушение. | A share-of-value-weighted exposure signal (Hlídač-státu style) — a pattern indicator, not proof of wrongdoing. | *keep* — it is already the most honest string in the feature | *keep* | `EntityRiskGradeCard.tsx` |

Keep the A–F letter and the 0–100 here. This is the one grain where the literature supports a
graded composite, and `по N договора` is already on the card.

### 4b. Contract index → checklist

| Key | Current BG | Current EN | Proposed BG | Proposed EN | Consumer |
|---|---|---|---|---|---|
| `risk_cri_label` | Индекс на риска | Risk index | **Задействани сигнали** | **Flags fired** | `RiskBadges.tsx:341` |
| `risk_cri_checks` | проверки за риск | risk checks | **от приложимите проверки** | **of applicable checks** | `RiskBadges.tsx` |
| `risk_cri_clear` | Няма сигнали за риск | No red flags | **Няма задействани сигнали** | **No flags fired** | `RiskBadges.tsx:322` |
| `risk_cri_checks_passed` | преминати проверки | checks passed | **автоматични проверки без сигнал** | **automated checks, none fired** | `RiskBadges.tsx:328` |
| `company_contract_risk` | Риск | Risk | **Сигнали** | **Flags** | `ContractsBrowserDbScreen.tsx:187`, `CompanyContractsDbScreen.tsx` |

`risk_cri_checks_passed` is the **E1** fix. BG alternatives to weigh:
- `автоматични проверки без сигнал` — literal, safe, slightly clunky
- `проверени показатели без сигнал`
- `8 проверки — нито една не се задейства` — clearest, but needs the count inline so it
  changes the render, not just the string

**Render changes that go with 4b (not string-only):**
- `RiskBadges.tsx:341–345` — drop the `{cri}` number; render **`1 от 8`** instead of `13`.
  The ratio is the honest form and it is self-explaining in a way `13/100` is not.
- `RiskBadges.tsx:61–65` — **delete the `showScore` branch.** This removes `score` from the UI
  entirely and kills **C2**. Drop the `showScore` prop and its two call sites
  (`ContractsBrowserDbScreen.tsx:191`, `CompanyContractsDbScreen.tsx:181`).
- `computeProcurementRisk.ts` — ⚠️ *audit correction:* the module header claims `score` is
  shared by "the flow link-colouring, the My-Area alerts builder, and the AI tools." **Those
  importers do not exist.** The only importers of the scorer are `RiskBadges`,
  `ContractDetailScreen`, `TenderDetailScreen`, the two DB tables above, and two scripts
  (`cpv_competition.ts`, `risk_scorer.harness.ts`); none order by `score`. So deleting
  `showScore` removes `score` from its **only two render surfaces and nothing else reads it**.
  Decision is therefore cleaner than drafted: either (a) delete `score` outright and sort by
  `cri`, or (b) keep it as an internal sort key and fix the stale header comment. Prefer (a)
  unless the base-rate work (§6b) turns up a reason to keep an additive ordering. Either way the
  stale header comment must go.

### 4c. Flag labels → one BG/EN pair per concept

| Key | Current BG | Current EN | Proposed BG | Proposed EN | Consumer |
|---|---|---|---|---|---|
| `flags_title` | Сигнали за риск в поръчките | Procurement red flags | *keep* | **Procurement risk flags** | `ProcurementFlagsScreen.tsx`, `RiskSignalsTile.tsx` |
| `flags_nav` | Рискови сигнали | Risk flags | **Сигнали за риск** | *keep* | `ProcurementFlagsScreen.tsx`, `ProcurementScreen.tsx` |
| `procurement_section_risk` | Рискови сигнали | Risk signals | **Сигнали за риск** | **Risk flags** | `ProcurementOverviewScreen.tsx` |
| `procurement_risk_see_feed` | Виж всички рискови сигнали | See the full red-flag feed | **Виж всички сигнали за риск** | **See the full risk-flag feed** | `RiskSignalsTile.tsx` |
| `funds_section_red_flags` | Сигнали за риск | Red flags | *keep* | **Risk flags** | `FundsScreen.tsx` |
| `integrity_page_title` | Сигнали за концентрация и риск | EU-funds red flags | **Сигнали за риск при еврофондовете** | **EU-funds risk flags** | `FundsIntegrityScreen.tsx` |
| `procurement_flags_explore` | Виж сигналите за риск в поръчките | See the procurement red-flag feed | **DELETE** — no consumer (§1e) | **DELETE** | — |

Rule enforced: **"red flag" disappears from EN entirely**; the pair is *сигнал за риск* /
*risk flag*. `flags_nav` and `procurement_section_risk` converge to the same pair in both
languages (they are the same concept — consider collapsing to one key in a follow-up; out of
scope here to keep the diff reviewable).

### 4d. Cross-language parity fixes

| Key | Issue | Fix |
|---|---|---|
| `composite_methodology_h_bands` | BG "Категории на риска" = `risk_methodology_h_bands`, but EN differs ("Risk bands" vs "Risk categories") | EN → **Risk categories** |
| `about_procurement_risk_note` | EN says "Corruption Risk Index", BG says "Индекс на риска" (**E2**) | Reword both. Drop "Corruption" and "Индекс"; describe the checklist. Draft below. |

**`about_procurement_risk_note` — proposed opening (rest of both strings unchanged):**
- BG: *"Всеки договор минава през набор от автоматични проверки за риск — показваме кои са се задействали и кои не (…)"*
- EN: *"Every contract runs through a set of automated risk checks — we show which fired and which did not (…)"*

Both strings also enumerate the checks and must be updated when §7 adds new ones.

### 4e. Not renamed, deliberately

`risk_score_*` (section screening), `composite_index_*` (election index), `risk_clusters_*`,
`risk_history_*`, `risk_persistence_*`, the normalcy strings, and everything under
`/indicators` (AROPE et al.). They already conform to §3, or are outside it.

---

## 5. Phase 1 — the rename (no new data) — ✅ SHIPPED 2026-07-17 (5e30b48a6)

1. ✅ Applied §4a–§4d to `src/locales/{bg,en}/translation.json` (+ §4c/§4d, dead key deleted).
2. ✅ Render changes in `RiskBadges.tsx`; dropped `showScore` + its two call sites. The detail
   meter now renders "Задействани сигнали N от M приложими проверки" (no bare CRI number).
3. ✅ Deleted `procurement_flags_explore`; locales key-set-identical (4818 each).
4. ✅ `npm run build` green (after fixing an unrelated pre-existing break in
   `scripts/funds/projects_share.ts`, committed separately as 2ab63e4c0).
5. ✅ Verified in-browser (BG + EN): exposure card reads "Procurement risk exposure"; contract
   fired meter "2 от 8"; clear state "Няма задействани сигнали · 8 автоматични проверки без
   сигнал"; contracts table "СИГНАЛИ" column, no bare score. No console errors.
6. /code-review + /code-repair: 4 stale-fallback fixes applied. `risk_scorer.harness` ALL PASS.

---

## 6. Phase 2 — ex-ante tender risk signals

**Why tenders and not contracts.** Three independent arguments, all pointing the same way:

- **Ex-ante beats autopsy.** A contract flag reports on money already spent. A tender flag
  fires while bids are open. This is the ProZorro/DOZORRO thesis and it is a genuinely
  different product from anything Bulgarian — SIGMA (`sigma.midt.bg`) does not do it.
- **No company to accuse.** At tender stage there is no winner. Flagging a 6-day submission
  window is a statement about the **buyer's conduct in a procedure** — exactly the grain where
  the exposure logic is already legitimate. §2's defamation concern evaporates.
- **The data exists and is unused for risk.** `tenders` (126,413 rows, `009_tenders.sql:23–63`)
  carries `publication_date`, `submission_deadline`, `procedure_type`, `award_method`,
  `legal_basis`, `estimated_value_eur`, `is_framework_agreement`, `has_unsecured_funding`,
  `change_notice_count`, plus `unp` → `kzk_appeals`. Critically, `publication_date →
  submission_deadline` is a **real** tender window — **both endpoints ~100% populated** (verified:
  `publication_date` 100%, `submission_deadline` 126,412/126,413) — unlike
  `contracts.tender_period_*`, which is 0% populated and is exactly why `063` dropped the
  срок-за-оферти metric from normalcy. ⚠️ **But density is per-field:** `procedure_type` ~100%,
  `estimated_value_eur` ~100%, `legal_basis` **74%**, `has_unsecured_funding` **34%**. Check
  each field's fill rate in the §6b base-rate pass before scoring on it — a 34%-populated field
  scored naively re-imports the missing-data defect (§6c).

### 6a. Baseline: the Bulgaria-calibrated CRI

**Do not invent cut-points.** WB PRWP 10444 Table 2 already calibrated them on 148,637
Bulgarian contracts, with an external-validity anchor: these flags raise award prices **+5.3%**
(→ US$2.6bn lost 2007–2021, GTI Corruption Cost Tracker). Cite, don't assert.

| Flag | Bulgaria-validated banding | Our field |
|---|---|---|
| Single bidder | 1 bid = 1 | *(award stage only)* |
| Call for tenders published | not advertised = 1 | `notice_type` / absence |
| Procedure type | open = 0 · negotiated/accelerated = **0.5** · non-open = 1 | `procedure_type`, `legal_basis` |
| Submission period | 12–183d = 0 · 7–11d = **0.5** · 1–6d = 1 | `publication_date → submission_deadline` |
| Decision period | 9–365d = 0 · 5–8d = **0.5** · 1–4d = 1 | `submission_deadline` → award date via `unp` |
| Buyer's dependence | continuous share | supplier share of buyer value |

Two things to carry across:
- The bands are **0 / 0.5 / 1**, not binary. Our `shortTenderPeriod` uses a flat 14-day cut
  (`computeProcurementRisk.ts:109`, `SHORT_TENDER_DAYS`) lifted from Directive 2014/24 Art. 27
  — that is a **legal minimum, not a calibrated risk threshold**. Re-cut to 1–6 / 7–11 / 12+.
- The decision-period flag's *banding* is **one-sided** (only short periods 1–4d score 1).
  ⚠️ But PRWP 10444's own prose justifies risk via the **opposite** mechanism — *"an overly
  lengthy decision period gives the opportunity for multiple legal challenges… the issuer wants
  to award the contract to a specific company."* The calibration penalises short, the narrative
  worries about long: a documented internal inconsistency in the source. **Do not treat the
  decision-period flag as settled** — run it two-sided in the §6b base-rate pass and look at
  where our own mass sits before committing to a direction. (This is a weaker indicator to lead
  with than submission-period or no-CFT, which are unambiguous.)

### 6b. Calibrate on our own corpus before committing to any threshold

⚠️ **Imported thresholds are noise — every framework calibrates them per country.** Opentender's
own methodology (iMonitor D2.2, 2025) states the day-interval and procedure-type cut-points are
**country-specific and "calculated… provided upon request"** — i.e. deliberately not published
as universal constants. (⚠️ A specific "25d Romania vs 194d Italy" spread and an "Outright
award" 100/50 inversion circulated in earlier notes; those figures are **NOT in the current
D2.2** and could not be verified — do not cite them. The *principle* they illustrated —
per-country calibration — is confirmed verbatim by D2.2.) Take the lesson, not the numbers: a
borrowed threshold means nothing here.

So Phase 2 opens with a **base-rate script**, not a migration: per-flag prevalence over our
`tenders` corpus, by year and by CPV division. Publish it in the plan before writing SQL.
Free calibration reference: `risks.prozorro.gov.ua/api/*` is unauthenticated and live.

**Kill rule (OCP 2024 p. 13):** *"if a flag is detected for 90% of the procedures, it's likely
that there are many false positives."* Any flag firing on a very large share of the corpus does
not ship. Which brings us to the flag we already over-weight.

### 6b-results. Base rates MEASURED (2026-07-18, 126,413 tenders 2020–2026)

Read-only pass over the `tenders` corpus (script committed at
`scripts/procurement/tender_base_rates.sql`). Three findings, each a calibration decision:

**1. Non-open procedure — SHIP as the hero flag.** Bucketing `procedure_type` into open (0) /
restricted-or-negotiated-with-prior-call (0.5) / non-open-no-notice (1):

| bucket | share |
|---|---|
| 0 open (Открита, Публично състезание, Събиране на оферти с обява) | 83.9% |
| 0.5 restricted / negotiated WITH call | 1.8% |
| **1 non-open** (Пряко договаряне, Договаряне без обявление/покана/публикуване, Покана до определени лица) | **14.3%** |

Stable 12.8–16.0% every year 2020–2026. A 14.3% fire rate is genuinely discriminating (nowhere
near the 90% kill line), and it *is* the EC-Scoreboard "no calls for bids" story where BG is the
real outlier (§8). This subsumes the separate "call for tenders not published" flag — in this
corpus `notice_type` is 100% present (these *are* the notices), so non-publication only shows up
*as* a no-notice procedure type. **One flag, not two.**

**2. Short submission window — MUST be procedure-tier-conditional; the flat PRWP band fails
here.** Window = `submission_deadline − publication_date`. Flat over the whole corpus: 1–6d =
3.1%, **7–11d = 18.5%**. Importing PRWP 10444's flat "7–11d = 0.5 risk" would fire on ~1 in 5
tenders — straight into the kill rule. The reason is entirely procedure tier:

| procedure | median days | 1–6d | 7–11d |
|---|---|---|---|
| Открита процедура (open, high-value) | 30 | 0.0% | **0.3%** |
| Публично състезание (competition) | 21 | 0.1% | **0.9%** |
| Събиране на оферти с обява (low-value, advertised) | 12 | 0.1% | **44.1%** |
| Пряко договаряне / Договаряне без… (already non-open) | 10 | ~20% | ~45% |

The entire 18.5% mass is the low-value tier, where a ~10-day window is the **statutory norm**, not
a red flag. **Decision: the short-window flag fires ONLY on the competitive tiers (Открита
процедура + Публично състезание).** There, ≤11d is already <1% and ≤6d ≈ 0.0–0.1% (73 tenders
corpus-wide) — a rare, meaningful signal. On low-value / already-non-open procedures the window
is not scored. This is the §6b thesis proven on our own data: the borrowed band was noise; the
tier-conditional cut is signal.

**3. Short decision period — measurable, defensible, but carry the §6a caveat.** Joining
`tenders.submission_deadline → min(contracts.date_signed)` on `unp` (93,543 matched): median 46d,
p10 14d, p90 114d. PRWP's short-risk bands: 1–4d = **3.2%**, 5–8d = 2.6%. A 3.2% fire rate is
usable. But §6a flagged that PRWP's banding penalises *short* while its prose worries about
*long* — run it two-sided in the scorer (also surface the extreme-long tail, p90 = 114d ⇒ >365d
is a candidate) before committing a direction.

**Unusable fields (do not score — §6c):** `change_notice_count` is **0.1%** populated (essentially
empty); `has_unsecured_funding` is **33.8%** filled (missing-data trap). `is_framework_agreement`
0.8%, `is_eu_funded` 17.1% — descriptive context, not risk.

**Net Phase-2 flag set to build:** (a) non-open procedure [ship], (b) tier-conditional short
submission window on competitive procedures [ship], (c) two-sided decision period [ship, verify
direction], (d) single-bidder + buyer-dependence [award-stage, via the existing
`awardToContract` path]. Drop `change_notice_count` and `has_unsecured_funding` as scored inputs.

### 6c. Missing-data handling

**Never flag on missing data.** PwC/Ecorys rejected **both** of its TED missing-field proxies
because France and the Netherlands scored worst — flag incomplete records and you rank your
most transparent buyers as most corrupt. ARACHNE has the same defect structurally (unscored ≠
zero, shrinking denominator).

If we band missing values at all, do it **Opentender's way** (explicitly bin "missing" into a
score band) rather than ARACHNE's (drop and shrink the denominator). Our CRI's
available-count denominator (`computeProcurementRisk.ts:263`) already gets this right and is
worth preserving as the house pattern.

### 6d. Surface — ✅ detail panel SHIPPED 2026-07-18 (d219013a1)

**Shipped:** `Сигнали за риск при процедурата` on `TenderDetailScreen.tsx` (mounted after the
normalcy panel), same checklist form as the contract (§4b), same non-verdict framing.
`computeTenderRisk.ts` (pure scorer) + `TenderRiskPanel.tsx` + `tender_risk.harness.ts` (8
checks). The shared `criColor` + `RISK_CHIP_BASE` were extracted into `lib/riskGrade.ts` so the
contract and procedure meters share one source. Verified in-browser (BG + EN) across all states.

⚠️ `TenderDetailScreen.tsx:366` still scores a tender's **awards** by adapting each into a
contract shape (`scoreRow(awardToContract(...))`) — contract-grain scoring on the tender page. It
stays, it is correct, and it is a separate block/label from the new procedure-grain panel.

**Two deferred follow-ups (kept out to stay reviewable):**
- **Step 3b — the `/procurement/tenders` browser column — ✅ SHIPPED 2026-07-18 (0593032ca).**
  Added `submission_deadline` to the `tenders` registry (columns + select; `tenders_list` already
  exposed it). `computeTenderRisk` now takes a structural `TenderRiskInput` so the same scorer
  drives the detail panel and the row; `TenderRiskChips` (compact, extracted `FlagChips`) renders
  the column. Awards aren't per-row, so shortDecisionPeriod is unavailable there by design.
  Verified: non-open rows flag, restricted "с предварителна покана" rows correctly don't.
- **⭐ `tender_detail()` awards join (032): ocid → unp — ✅ FIXED 2026-07-18 (30aaf2558).**
  Switched the awards subquery to `c.unp = t.unp`. Measured on the full corpus: **+166,591 award
  links, −0** (every ocid match is also a unp match; unp is a strict superset), Index Only Scan
  on `idx_contracts_unp` (0.365ms; worst-case 212-award tender = 11.6ms). Verified in-browser: an
  awarded tender that showed "Очаква изход · 1 от 2" now shows "Възложени договори (1)" and the
  risk panel "2 от 3 · КРАТЪК СРОК ЗА ОФЕРТИ · БЪРЗО РЕШЕНИЕ" — `shortDecisionPeriod` now fires.

---

## 7. Phase 3 — contract check additions

Ranked by (data we already have × defensibility). Measured weights are from PwC/Ecorys 2013 —
⚠️ conditional on a **50/50 case-control sample**, so they are *not* precision estimates; treat
as relative ordering only.

1. **Annex value growth.** `signing_amount_eur` vs `amount_eur` — we already compute this Δ for
   display and never score it. The legally-defensible band is **ЗОП чл. 116, ал. 2: a 50% cap
   on the CUMULATIVE value of modifications** on grounds ал. 1 т. 2/т. 3 (primary-source
   verified, §0b). ⚠️ **Do NOT use the EU Directive's 10%/15% de minimis — ЗОП did not
   transpose those numbers** (no "15 на сто" appears in the law; non-substantial change is
   qualitative, чл. 116 ал. 1 т. 7 / ал. 5). And note the separate stacking inflation ceiling
   (ал. 3 / чл. 117а, since 22.12.2023) — a works contract can carry +50% unforeseen AND +50%
   inflation, so a single 50% band cannot assume which ground it hit. PwC: substantial
   post-award changes **+35.6%, p<0.05** — among the strongest published weights.
   ✅ **Unblocked — see §0b.** The feed is fully retained on disk (26,120 records, 100%
   populated, no re-crawl); it just never reaches PG. Because the ЗОП cap is **cumulative**, the
   scoreable band is queryable today off `signing_amount_eur` and is **already measured** (§0b):
   8,035 affected contracts, median +14.6%, +€2,132M net. The `annexes` table adds per-annex
   grounds/dates (which ал. ground; ал. 2 vs ал. 3 inflation) — needed to *label* a breach, not
   to detect the cumulative one. Well-specified: load 26k rows from cache; reuse
   `anexi_current_value.ts`'s K2→K1 resolution and its three guards.
   ⭐ **No published empirical distribution of contract-amendment growth exists for EU
   procurement**, and §0b found a **34× cliff at exactly the 50% legal cap — 446 contracts at
   exactly +50.000%, +€909.8M, of which АПИ is €857.5M.** Publishable finding, not just a flag.
2. **КЗК appeal signal — the gap is data sparsity, not a missing join.** ⚠️ *Audit correction:*
   an earlier draft said `useContract` doesn't select the appeal join so the check is
   unavailable on the detail page. **Wrong** — `CONTRACT_SQL` (`db_routes.js:52`) already selects
   `appeal_upheld` (a never-null boolean), so `appealUpheld` *is* available and does fire when
   true. The real limitation is that **only 106 contracts across the whole corpus carry an
   upheld appeal** (`contracts_list`), so the check almost never fires — a coverage problem in
   `kzk_appeals`, not a wiring problem. Complaints from non-winning bidders: PwC **+33.6%,
   p<0.05**. The genuinely unused fields are `kzk_appeals.suspension` and `.vm_requested`. The
   real "8 not 9" cause is `shortTenderPeriod` (§1c C2).
3. **Award value vs estimated value.** PwC **+34.1%**. `tenders.estimated_value_eur` + `unp`
   lineage. Already *rendered* on the contract page (the -43.7% in the прогнозна-vs-текуща bar)
   and unscored. Make it **two-sided** — OCP R016 flags the low side too, on the theory of
   deliberate under-valuation to duck a competitive threshold.
4. **Threshold-hugging / CPV-splitting.** Contracts clustered just below the ЗОП competitive
   threshold; repeated same-CPV awards to the same buyer↔supplier pair within a year. Portable
   to `contracts` today (amount, CPV, EIK, date). Reference impls: ProZorro RISK-2-5/2-6, OCP
   R049 (suggests a 1–2% distance band, ~3-month window), K-Index P3.
   ⚠️ Needs the ЗОП threshold as an external input — OLAF's entire split-purchase section
   defers to "the threshold" without ever stating a number.
5. **New-firm winners.** We have TR registration dates. K-Index P4. One of the few flags a lay
   reader instantly understands.
6. **Political donors.** We have ЕРИК. Extends `mpConnected`/`pepConnected` into campaign
   finance. Per GTI's own taxonomy, political-connection indicators systematically
   *under*estimate risk — additive, not double-counting.
7. **Missing bidders.** Strongest published single cartel screen (75%/65% detection) and
   essentially undeployed anywhere. Needs only bidder × buyer × CPV participation history.

---

## 8. Phase 4 — rebalance the awarder weights

Current (`041:144–154`, availability-weighted mean, weights sum to 1.30 when all present):
`connection .35 · singleBid .25 · direct .20 · concentration .20 · upheldAppeal .30`.

**Single-bid is the wrong hero metric.** EC Single Market Scoreboard 2024:

| | Single bidder | No calls for bids |
|---|---|---|
| EU median | **28%** | **5%** |
| Denmark (CPI rank 1) | **23%** | 10% |
| **Bulgaria** | **36%** | **20%** |
| Czechia | 40% | 10% |
| Romania | 44% | 1% |
| Poland | 56% | 7% |

⚠️ **The two indicators use DIFFERENT bands (verified) — don't cross-apply them.** Single
bidder: green ≤10% / red >20%. Direct awards ("no calls for bids"): green ≤5% / red ≥10%.

- The single-bid EU median (28%) is **above that indicator's own red threshold (>20%)**. A flag
  firing on the typical case is close to uninformative.
- **Denmark — the least-corrupt country measured — is "red" on single bidding (23%).**
- **Bulgaria has the *lowest* single-bid rate of the four CEE countries here.** Poland is
  perceived 10 CPI points cleaner with 20pp *more* single bidding.
- ⭐ **The defensible Bulgarian anomaly is "no calls for bids": 20% vs an EU median of 5%** —
  4× the norm, and **2× the direct-award red threshold (≥10%)**. That maps to our `direct`
  component, currently **.20**.
- ⚠️ The Commission **explicitly disclaims** that the Scoreboard measures corruption: *"some
  aspects of public procurement have been omitted entirely or covered only indirectly, e.g.
  corruption."* It is filed under competition/market access.

⚠️ **The EU "average" above is a median** (*"a typical (mid-ranking) EU country is used for the
EU average"*). OECD's TED-based 35.9% (2022) / 37.2% (2023) and ECA's 41.8% (2021) are **means
on wider scope**. The two families are not comparable — do not mix them in any copy.

**Proposal:** raise `direct`, lower `singleBid`. Exact numbers pending the §6b base-rate run —
this plan does not pick them.

✅ **Unblocked — see §0a.** The weights were extracted into `awarder_risk_grade_frac()` and now
live in exactly one place; the "can't share an expression" premise was wrong. A reweight is a
one-line edit, verified byte-identical and plan-neutral, with `kzk.harness.ts` still locking
fn==matview. After changing it, re-fan `awarder_risk_grade_scoped` via
`scripts/db/lib/riskGradeScoped.ts:26` (called from `load_pg.ts`, `load_tr_pg.ts`,
`kzk_appeals.ts`) and REFRESH `awarder_risk_grade_ranking`.

---

## 9. Risks & open questions

- **Goodhart.** Decarolis' urgency/publicity reversal is the empirical case that a published
  flag is also a spec for evasion. OECD (2024) on Hungary, p. 65, names the channel for our
  exact hero metric: targets *"can open the door to unwanted market practices (such as
  submitting 'supporting' bids or false bids to avoid the problem of single bidding)."*
  ⚠️ Decarolis' own footnote 20 undercuts the story (*"there are no indicators specifically
  monitored and targeted by investigators"*), and the paper never says "Goodhart" — that
  framing would be ours. Carry the caveat if we cite it.
- **Unresolved tension worth writing about:** OCP publishes 73 flags with formulas; the best
  empirical paper on flag validity concludes you should limit *"access to the information about
  which features are subject to monitoring."* The open-contracting transparency thesis and the
  measured-adaptation finding are in direct conflict. We are on OCP's side by disposition — we
  should say so deliberately rather than by default.
- **Construct validity.** The CRI's components are validated against single bidding; single
  bidding is validated against perception indices; single bidding detected 10–12% of 73 proven
  cartels. GTI states the circularity openly.
- **Open:** does `flags_nav` collapse into `procurement_section_risk`? (§4c — deferred.)
- **Open:** the `annexes` table (§0b) — the only remaining piece of §7.1. Needs a migration
  (`080_procurement_annexes.sql`), a loader reusing `anexi_current_value.ts`'s identity
  resolution, and a `recent_updates` changelog wire-up (house rule: every PG-migrated dataset
  registers there). It answers the one question the §0b finding cannot: **one annex at the cap,
  or several summing to it?**
- **Open:** the exactly-50.000% cohort (§0b) is a story before it is a flag. Decide whether it
  ships as an article, a tile, or both — and settle caveat (2) (buyer intent vs a source-side
  1.5× formula) before either. Do not publish the АПИ number without that.

## 10. Sources

- Fazekas, Poltoratskaia & Tóth, *Corruption Risks and State Capture in Bulgarian Public
  Procurement*, World Bank PRWP 10444 (2023). ⚠️ `govtransparency.eu` serves an expired TLS
  cert — `curl -k`.
- Fazekas, Tóth & King, EJCPR 22(3):369–397 (2016), DOI 10.1007/s10610-016-9308-z.
- Decarolis & Giorgiantonio, EPJ Data Science 11:16 (2022), PMC8933377.
- iMonitor D2.2 *Risk Assessment Methodology* (2024 & 2026 eds.) — Opentender indicator list +
  country calibrations. ⚠️ Both PDFs defeat text extractors; use `pdftotext -layout`.
- OCP, *Red Flags for Integrity* (2024, 73 flags — the better source) and (2016, 60 flags).
- PwC/Ecorys, *Identifying and Reducing Corruption in Public Procurement in the EU* (2013) —
  the only source with measured per-flag weights. ⚠️ Dead at its EC URL; Wayback only.
- OLAF, *Fraud in Public Procurement: A collection of Red Flags and Best Practices* (2017).
  ⚠️ Dead at its EC URL; Wayback only.
- EC Single Market Scoreboard, public procurement, 01/2024–12/2024.
- OECD (2024), Hungary public procurement review, p. 65.
