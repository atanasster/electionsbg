# Procurement risk v2 — tender risk signals + the risk vocabulary contract

Status: DRAFT (2026-07-17). Owner: TBD.

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

### 1a. Five 0–100 "risk" numbers

| Label (BG / EN) | Grain | What the number actually is | Home |
|---|---|---|---|
| Оценка на риска при поръчки / Procurement risk grade | awarder, supplier | value-weighted share of money through risk-carrying channels; A–F banded | `awarder_risk_grade` / `supplier_risk_grade`, `scripts/db/schema/pg/041_procurement_risk_grade.sql` |
| Индекс на риска / Risk index | contract | fired ÷ available checks | `computeProcurementRisk.ts:263` (`cri`) |
| *(unlabelled)* | contract | additive weights, capped at 100 | `computeProcurementRisk.ts:249` (`score`) |
| Скрининг на риска по секции / Section risk screening | polling section | composite of 7 signals, banded | elections |
| Индекс на изборния риск / Election risk index | election | composite of 5 signals, banded | elections |

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

**C1 — two unlabelled 0–100s on the same screen.** `/awarder/:eik` renders the exposure
grade ("8 / 100 · A", `по 689 договора`) and, directly below it, Топ договори rows whose
Риск column carries a per-contract number on the same 0–100 scale. Nothing on screen says
they are different scales measuring different things at different grains.

**C2 — the table and the detail page show different numbers for the same contract.**
`ContractsBrowserDbScreen.tsx:191` and `CompanyContractsDbScreen.tsx:181` render
`<RiskBadges ... showScore />`, which prints **`score`** (the additive legacy key,
`RiskBadges.tsx:61`). `ContractDetailScreen.tsx:147` renders `variant="full"`, which prints
**`cri`** (`RiskBadges.tsx:341`). Same contract, one click apart, two bare 0–100 numbers,
neither labelled in the table.

Worked example — a contract whose only fired check is `directAward`: table shows **20**
(`WEIGHT_DIRECT_AWARD`), detail shows **13** (`round(100 × 1/8)`). A contract whose only
fired check is `debarred`: table shows **80**, detail shows **13**. The table implies the
second is 4× the first; the detail page says they are identical. Both are "true" — they are
answers to different questions that were never given different names.

> Correction to an earlier read: the Риск column is **not** sortable (`enableSorting: false`,
> `ContractsBrowserDbScreen.tsx:188`), so there is no sort/display mismatch. The defect is
> the display/display mismatch above, which is worse — a sort anomaly is invisible, two
> contradicting numbers are not.

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
- **Decarolis & Giorgiantonio (2022)**, EPJ Data Science 11:16 — the only study validating red
  flags against **convictions** (12,786 Italian roadwork contracts; ground truth 15%
  investigated / 2% convicted / 1% debarred). Verdict negative: *"the most obvious and
  scrutinized red flags are either uncorrelated with corruption or, even, negatively associated
  with it"* — urgency procedures and publicity ran **backwards**. Best realistic model
  F=0.597. Cost overruns do not proxy corruption (r ≈ 0.001).
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
- `computeProcurementRisk.ts` — keep `score` as an exported sort key (the flow viz and My-Area
  alerts may order by it), but retag the comment at `:81` from "Sort key only" to "Sort key
  only — never rendered; see docs/plans/procurement-risk-v2.md §1c."

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

## 5. Phase 1 — the rename (no new data)

1. Apply §4a–§4d to `src/locales/{bg,en}/translation.json`.
2. Render changes in `RiskBadges.tsx` per §4b; drop `showScore` + its two call sites.
3. Delete `procurement_flags_explore` from both locale files.
4. `npm run lint && npm run build`.
5. Verify per the house workflow: `/awarder/831661388` (exposure card + Топ договори rows
   must no longer show two bare 0–100s), `/procurement/contract/dcb1efe57a13` (checklist form,
   no "преминати проверки"), `/procurement/contracts` (Сигнали column), `/procurement/flags`,
   `/funds`. Both languages.

Ship this before any of §6–§8.

---

## 6. Phase 2 — ex-ante tender risk signals

**Why tenders and not contracts.** Three independent arguments, all pointing the same way:

- **Ex-ante beats autopsy.** A contract flag reports on money already spent. A tender flag
  fires while bids are open. This is the ProZorro/DOZORRO thesis and it is a genuinely
  different product from anything Bulgarian — SIGMA (`sigma.midt.bg`) does not do it.
- **No company to accuse.** At tender stage there is no winner. Flagging a 6-day submission
  window is a statement about the **buyer's conduct in a procedure** — exactly the grain where
  the exposure logic is already legitimate. §2's defamation concern evaporates.
- **The data exists and is 100% unused.** `tenders` (`009_tenders.sql:23–63`) carries
  `publication_date`, `submission_deadline`, `procedure_type`, `award_method`, `legal_basis`,
  `estimated_value_eur`, `is_framework_agreement`, `has_unsecured_funding`,
  `change_notice_count`, plus `unp` → `kzk_appeals`. Critically, `publication_date →
  submission_deadline` is a **real** tender window — unlike `contracts.tender_period_*`, which
  is 0% populated and is exactly why `063` had to drop the срок-за-оферти metric from normalcy.
  This is the single richest unscored field set in the corpus.

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
- The decision-period flag is **one-sided in Bulgaria** (short = risky). The general GTI
  framework treats it as two-sided; the Bulgarian calibration dropped the long tail. Follow the
  Bulgarian calibration.

### 6b. Calibrate on our own corpus before committing to any threshold

⚠️ **Imported thresholds are noise.** Opentender's country calibrations put the decision-period
cut at **25 days in Romania and 194 in Italy** — a 7.8× spread on the same indicator. Their
Appendix Table 3 also shows procedure-type mappings **inverted between countries** ("Outright
award" = 100 in Italy, 50 in Spain). These are empirical, not normative.

So Phase 2 opens with a **base-rate script**, not a migration: per-flag prevalence over our
`tenders` corpus, by year and by CPV division. Publish it in the plan before writing SQL.
Free calibration reference: `risks.prozorro.gov.ua/api/*` is unauthenticated and live.

**Kill rule (OCP 2024 p. 13):** *"if a flag is detected for 90% of the procedures, it's likely
that there are many false positives."* Any flag firing on a very large share of the corpus does
not ship. Which brings us to the flag we already over-weight.

### 6c. Missing-data handling

**Never flag on missing data.** PwC/Ecorys rejected **both** of its TED missing-field proxies
because France and the Netherlands scored worst — flag incomplete records and you rank your
most transparent buyers as most corrupt. ARACHNE has the same defect structurally (unscored ≠
zero, shrinking denominator).

If we band missing values at all, do it **Opentender's way** (explicitly bin "missing" into a
score band) rather than ARACHNE's (drop and shrink the denominator). Our CRI's
available-count denominator (`computeProcurementRisk.ts:263`) already gets this right and is
worth preserving as the house pattern.

### 6d. Surface

`Сигнали за риск при процедурата` on `TenderDetailScreen.tsx`, same checklist form as the
contract (§4b), same OCP a/b/c framing. Plus a flags column on `/procurement/tenders`
(`TendersBrowserDbScreen`), which today has **no risk surface at all**.

⚠️ `TenderDetailScreen.tsx:366` currently scores a tender's **awards** by adapting each into a
contract shape (`scoreRow(awardToContract(...))`). That is contract-grain scoring wearing a
tender page's clothes and it must not be confused with §6 — it stays, it is correct, but the
new procedure-grain signals are a separate block with a separate label.

---

## 7. Phase 3 — contract check additions

Ranked by (data we already have × defensibility). Measured weights are from PwC/Ecorys 2013 —
⚠️ conditional on a **50/50 case-control sample**, so they are *not* precision estimates; treat
as relative ordering only.

1. **Annex value growth.** `signing_amount_eur` vs `amount_eur` — we already compute this Δ for
   display and never score it. Art. 72 gives legally-defensible bands (**50%** per individual
   modification; **10%** supplies/services / **15%** works net cumulative). PwC: substantial
   post-award changes **+35.6%, p<0.05** — among the strongest published weights.
   ⚠️ **Blocker:** migration 078 flips `amount_eur` in place and keeps no annex count, date, or
   reason (`scripts/procurement/anexi_current_value.ts`); there is **no `annexes` table**. Scoring
   the Δ works today; scoring *per-modification* Art. 72 bands needs the feed retained first.
   ⭐ **No published empirical distribution of contract-amendment growth exists for EU
   procurement.** We have the ЦАИС анекси feed and it already produced +€1.75bn of post-annex
   value. This is a publishable finding, not just a flag.
2. **КЗК appeal upheld, made available on the contract page.** The reason the detail page reads
   "8" and not "9" is that `useContract` does not select the appeal join — only the contracts
   browser and tender page do, so `computeProcurementRisk.ts:173` marks it unavailable.
   Complaints from non-winning bidders: PwC **+33.6%, p<0.05**. Close to free.
   `kzk_appeals.suspension` and `.vm_requested` are also unused.
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

- The EU median (28%) is **above the Commission's own red threshold (>20%)**. A flag firing on
  the typical case is close to uninformative.
- **Denmark — the least-corrupt country measured — scores "red."**
- **Bulgaria has the *lowest* single-bid rate of the four CEE countries here.** Poland is
  perceived 10 CPI points cleaner with 20pp *more* single bidding.
- ⭐ **The defensible Bulgarian anomaly is "no calls for bids": 20% vs an EU median of 5%** —
  4× the norm, double the red threshold. That maps to our `direct` component, currently
  **.20**.
- ⚠️ The Commission **explicitly disclaims** that the Scoreboard measures corruption: *"some
  aspects of public procurement have been omitted entirely or covered only indirectly, e.g.
  corruption."* It is filed under competition/market access.

⚠️ **The EU "average" above is a median** (*"a typical (mid-ranking) EU country is used for the
EU average"*). OECD's TED-based 35.9% (2022) / 37.2% (2023) and ECA's 41.8% (2021) are **means
on wider scope**. The two families are not comparable — do not mix them in any copy.

**Proposal:** raise `direct`, lower `singleBid`. Exact numbers pending the §6b base-rate run —
this plan does not pick them.

⚠️ **Blocker:** the five weights are **duplicated verbatim** in two SQL bodies
(`041:144` and `041:322`) by documented necessity (`041:77–88` — no way to share an expression
across a STABLE fn and a set-returning fn). A parity test in
`scripts/procurement/kzk.harness.ts` locks them. Any reweighting touches both, then re-fans
`awarder_risk_grade_scoped` via `scripts/db/lib/riskGradeScoped.ts:26`.

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
- **Open:** the §7.1 annex work needs a decision on retaining the анекси feed before the
  Art. 72 bands are reachable.

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
