# /culture as an investigative hub + new procurement datasets — v1 plan

**Status:** research complete, nothing built. EXTENDS `docs/plans/kultura-view-v1.md`
(which shipped Phases 1–2: the НФЦ film-subsidy story) with the accountability half that plan
deferred, converts `/culture` to the house hub pattern, and adds a general procurement-ingest
roadmap.

**Trigger:** the ACF „Милиони зад кулисите" I+II fact-check (2026-08-13). Of 44 claims, 9 were
unanswerable _not because the data does not exist_ but because we do not ingest it — and the
whole story is invisible on `/culture`, which is a subsidy dashboard with no procurement
layer, no EU-funds layer, and an EIK register that omits its largest buyer.

**Decisions taken (2026-08-13, user):**

1. The contracts browser gets a **generic `?sector=` filter**, not a bespoke culture route.
2. **Ingest everything in Part 2** that serves investigative work and generalises beyond culture.
3. `/culture` becomes a **dashboard-hub** with a four-subject finder.

**Audit pass (2026-08-13, post-draft).** Every §0 figure was re-derived against local PG and
every claim about the repo re-checked against the code. The corrections are folded in below and
marked ⓐ; the audit's structural findings are §1.3 (the filter already exists), §1.3-B
(`/procurement/contractors` is not servable), §1.7 (the hub blob is a `db:gen-*` artifact) and
the three new gates in §4. Nothing in Part 2 changed.

**T0.0 implemented (2026-08-18).** `src/lib/cultureMatch.ts` now carries the four matching
definitions and `scripts/db/tests/culture_match.data.test.ts` pins them (9 tests). Figures it
CHANGED are marked **ⓑ** — and it changed the plan's central claim: guarded, ИСУН grants to
culture bodies are **€147.1m — the SAME SIZE as the €146.5m of procurement**, not €474.3m /
3.2x above it. The draft's number was ~70% false positives (dominated by `опера` matching
_оператор_) and its replacement went through two revisions before it settled: the first cut
also carried a FALSE NEGATIVE — the stem `театр` cannot match „театър" — that hid €14.6m and 24
theatres, two of them members of this repo's own curated register. Both directions are now
pinned by `culture_match.data.test.ts` (16 tests, 4 mutations verified to fire).

---

## 0. Every figure below was measured, with its denominator

Per the hub skill §0. Measured 2026-08-13 against local PG (`contracts` 408,967 rows).
Rows marked **ⓐ** were corrected by the audit pass — the draft's originals are shown struck
through so the delta stays visible rather than being quietly overwritten.

| Figure                                                            | Value                                                                                    | Denominator / basis                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ⓐ** Culture group contracts (`CULTURE_GROUP_EIKS`, **23** EIKs) | **677** ~~674~~                                                                          | `tag='contract'`, whole corpus                                                                                                                                                                                                                                                                                                                                                          |
| **ⓐ** Culture group money                                         | **€146,456,882** ~~€145,966,111~~                                                        | Σ `amount_eur`, post-annex current value                                                                                                                                                                                                                                                                                                                                                |
| **ⓐ** Culture single-bid rate                                     | **40.0%** ~~40.2%~~                                                                      | 179 of **447 contracts where `number_of_tenderers IS NOT NULL`** — not of 677                                                                                                                                                                                                                                                                                                           |
| **National single-bid baseline**                                  | **40.9%**                                                                                | 108,413 of 264,837 bid-known, whole corpus                                                                                                                                                                                                                                                                                                                                              |
| Art-school tier single-bid                                        | **53.0%**                                                                                | 71 of 134 bid-known                                                                                                                                                                                                                                                                                                                                                                     |
| Distinct suppliers                                                | 336                                                                                      | distinct `contractor_eik`, consortium members excluded                                                                                                                                                                                                                                                                                                                                  |
| Risk grades                                                       | A 387 / B 199 / C 78 / D 10                                                              | `contract_risk_cache.grade`; €87.8m / €28.9m / €23.1m / €6.2m. **Sums to 674, not 677** — the three-row gap is the draft's set; resolve with T0.0. **No E or F rows exist in culture.**                                                                                                                                                                                                 |
| Annex uplift                                                      | €758,745 over 71 contracts                                                               | `procurement_annexes.value_diff_eur`                                                                                                                                                                                                                                                                                                                                                    |
| КЗК appeals                                                       | 13 across 7 buyers, 1 upheld                                                             | `kzk_appeals` on the culture buyer set                                                                                                                                                                                                                                                                                                                                                  |
| **ⓑ ИСУН grants to culture bodies**                               | **€147,135,798 / 1,559 projects / 1,365 beneficiaries** ~~€474,276,649 / 1,866 / 1,527~~ | `fund_projects`, `cultureNameSql('beneficiary_name')` (`src/lib/cultureMatch.ts`). **The draft's figure was ~70% false positives — see the ⚠️ below.**                                                                                                                                                                                                                                  |
| — of which читалища                                               | €22,140,281 / 1,332 projects / 1,196 beneficiaries                                       | `chitalishteNameSql`. **ⓑ Reproduces the draft EXACTLY** — the читалища arm was always right; only the broad arm was not.                                                                                                                                                                                                                                                               |
| **ⓓ** — to the register, EIK-exact                                | **€94,075,904 / 40 projects** ~~€91.5m / 19~~ ~~€56.2m across "26 named institutions"~~  | `beneficiary_eik = ANY(CULTURE_GROUP_EIKS)`. **The figure moved because the REGISTER did** — T0.6/T0.1 took it from 23 EIKs to 45, so the same expression now books 40 projects rather than 19. A reproducible set, unlike the draft's €56.2m, and a strict subset of the €147.1m name-matched figure.                                                                                  |
| **ДФЗ subsidies to читалища**                                     | **€18,341,814 / 264 rows / 197 beneficiaries**, 2015–2025                                | `chitalishteNameSql('name')`. **ⓑ Reproduces the draft EXACTLY on all three counts.** The denominator is `coalesce(eik, name)`: `agri_subsidies` has 2,094,249 rows with a NULL eik, so counting EIKs alone reads 170 and drops every unregistered читалище. Culture-wide the arm is €18,956,087 / 277 rows, i.e. **97% читалища** — no state culture institution files a farm subsidy. |
| **Interreg — culture BODIES as partners**                         | **€10,990,255 / 77 rows / 67 partners**                                                  | `interreg_partners`, `country='Bulgaria'`, name-matched                                                                                                                                                                                                                                                                                                                                 |
| **ⓑ Interreg — culture/heritage-THEMED operations**               | **€48,807,847 / 202 BG partner rows / 168 partners** ~~€89,551,792 / 420 / 340~~         | `interregThemeSql('o.title_en')`. Two guards, measured separately: bare-`art` adds €18.2m of Partnership/Participation/Smart; the missing `-culture` compound exclusion added €4.0m of agriculture, aquaculture and viticulture — `култур`→`аквакултури` in English, on the arm that shipped with no exclusion list at all.                                                             |
| Culture-institute directors in the person layer                   | **198**, all public figures, all with declarations                                       | `person_role source='public_sector' role='cultural_institute'`                                                                                                                                                                                                                                                                                                                          |
| Procurement officers („Упълномощено лице по ЗОП")                 | **782 people / 2,848 filings**, 2018–2025, all resolved to `person_id`                   | `declaration.category='procurement_officer'`                                                                                                                                                                                                                                                                                                                                            |
| Cached officials declaration XMLs                                 | **44,142** (1.8 GB), **17,389 distinct `<Work>` employers**                              | `raw_data/officials/**/*.xml`                                                                                                                                                                                                                                                                                                                                                           |
| **Grant → contract lineage**                                      | **260 of 263** ПИИ codes in tender subjects match a `fund_projects` row — **98.9%**      | see §1.6                                                                                                                                                                                                                                                                                                                                                                                |
| ПИИ-coded procurement                                             | 1,829 tenders · 2,703 contracts · 262 distinct codes                                     | `subject`/`title ~* 'BG-RRP-[0-9]'`                                                                                                                                                                                                                                                                                                                                                     |
| `fund_projects` with a BG-RRP `contract_number`                   | 14,180                                                                                   | exact                                                                                                                                                                                                                                                                                                                                                                                   |

> ⚠️ **The single-bid figure is the trap on this page.** Culture is **40.0%** against a
> national **40.9%** — _typical_, not alarming. A tile showing 40.0% alone asserts something
> false. The real signal is the art-school tier at **53.0%** (+12 points). Any single-bid tile
> ships with the baseline as its `metricSecondary` or it does not ship.

> ⚠️ **ⓐ The Interreg thematic regex carries the `култури` defect — in this document, one
> bullet away from the paragraph warning about it.** The draft's
> `~* 'cultur|heritage|museum|theatre|festival|art'` leaves `art` **unanchored**. Measured
> 2026-08-13:
>
> |                                               | operations    | BG partner rows | Σ `budget_eur`        |
> | --------------------------------------------- | ------------- | --------------- | --------------------- |
> | regex as drafted                              | 361           | 329             | €70,898,768           |
> | with `\yart` (word-anchored)                  | —             | 237             | €54,200,430           |
> | **matched by the bare `art` substring alone** | **121 (33%)** | **92 (28%)**    | **€16,698,338 (24%)** |
>
> What the bare substring pulls in: „Cross-Border **Part**nership for Training and Labour
> mobility", „STIMULATING CITIZENS **PART**ICIPATION TO RECYCLE", „Sm**art** Building –
> Sm**art** Grid – Sm**art** City". Labour mobility, risk management and smart cities rendered
> as culture money. **§3.2-B's rule applies to this regex too**, and §4's gate („the exclusion
> **changes** the number") must cover it — not only the agri one.
>
> Second, separate problem: the corrected figures above (329 rows / €70.9m) **do not reproduce
> the draft's 420 rows / €89.55m / 340 partners** even before anchoring, so the join the draft
> actually ran is undeclared. Re-derive and publish it (T0.0) before any surface quotes a
> thematic Interreg number.

> ⚠️ **ⓑ €474m vs €146m was wrong, and the corrected answer took TWO passes — which
> is the more useful half of the story.** ИСУН grants to culture bodies are
> **€147,135,798**, against €146,456,882 of procurement: the two are the **same
> size to within 0.5%**, not 3.2x apart. The draft's headline, the band-1 tile
> designed around it and the „EU money is the bigger story" framing all rest on a
> number that was **~70% false positives**.
>
> **Pass 1 — the stem that was too WIDE.** `опера` is a substring of оператор,
> операция, кооперация — the exact trap `kulturaReferenceData.ts`'s own header
> warns about for the EIK list. Measured:
>
> | Beneficiary                                      | ИСУН grant                | Why it matched |
> | ------------------------------------------------ | ------------------------- | -------------- |
> | Електроенергиен системен опер**атор** ЕАД (ЕСО)  | **€189,443,288** (2 rows) | `опера`        |
> | МОСВ, ГД „**Опера**тивна програма Околна среда"  | €68,004,193               | `опера`        |
> | ИА по рибарство и **аква**култури                | €19,083,778               | `култур`       |
> | ИА „**Опера**тивна програма Наука и образование" | €11,190,064               | `опера`        |
> | УО на ОП „Добро управление"                      | €10,965,194               | `опера`        |
> | ГД „Жандармерия, специални **опера**ции"         | €6,608,880                | `опера`        |
> | Европейски цифров хъб за **изкуствен** интелект  | €4,868,890                | `изкуств`      |
>
> The national electricity grid operator alone is larger than the entire true
> figure. The reproduction is the proof, and it is now producible by an EXPORTED
> matcher rather than by a query in someone's history:
> `cultureNameSql(col, { withExclusions: false, anchored: false })` yields
> **€487,413,412 / 1,937 projects / 1,585 beneficiaries** against the draft's
> €474,276,649 / 1,866 / 1,527 — 2.8% / 3.8% / 3.8% apart, i.e. the same shape of
> query with a slightly different term list. The draft was measured with bare
> substrings.
>
> **Pass 2 — the stem that was too NARROW, and it nearly shipped as the fix.**
> The first corrected figure was €128,967,225 and this box asserted ИСУН was
> _below_ procurement. It was not: the stem `театр` **cannot match „театър".**
> Bulgarian drops the `ъ` only in the plural and the adjective, so a stem taken
> from „театрален" misses the nominative singular every theatre writes its own
> name in — while still matching nine adjectival rows, so no count reached zero
> and nothing looked wrong. It hid **24 theatres and €14,641,941**, including
> Народен театър „Иван Вазов" and Държавен сатиричен театър — **both members of
> `STATE_CULTURE_INSTITUTES` in this repo's own curated register**, so the two
> definitions disagreed about named institutions. `художествен` (НХА) was missing
> outright, and `агрокултур` — the `о` spelling — slipped the crop guard.
>
> **So the honest claim is neither „3.2x above" nor „below": they are the same
> size, and the 0.5% between them is smaller than the effect of any single stem
> fixed above.** A name match cannot separate them, and a surface that ranks one
> over the other is rendering noise as a finding.
>
> **What survives every pass unchanged:** the читалища arm, in both corpora,
> reproduces the draft to the euro. The defect was always in the broad arm — the
> one that got the tile.
>
> **The transferable lesson (§7 rule M):** a too-wide stem inflates a figure, and
> a base rate that looks absurd eventually catches it. A too-narrow one deflates
> it and is caught by **nothing** — every count stays plausible, every test stays
> green, and the wrong number reads as the careful one. The only assertion that
> finds it is agreement with an independent register, which is why
> `culture_match.data.test.ts` now requires every `STATE_CULTURE_INSTITUTE_EIKS`
> member with an ИСУН row to be admitted by the name matcher.

> ⚠️ **The `култури` false positive is a €148m error waiting to be published.** The naive
> culture regex over `agri_subsidies` returns **€166.3m**; the real figure is **€18.3m**. The
> difference is „Институт по полски **култури**", „Институт по фуражните **култури**",
> „Агро **култури** 77 ЕООД" — agricultural _crops_. `kulturaReferenceData.ts` already carries
> exactly this class of trap in `EXCLUDED_EIKS` („Община Куклен — FALSE regex match on
> „куклен""). Any agri arm ships with the `!~* 'култури'` guard **and a test that asserts the
> guard changes the number**, or it does not ship.

> ⚠️ **Interreg answers two different questions and they are ~4.4x apart.** "Culture institutions
> doing Interreg" is €11.0m / 67 bodies. "Interreg culture-and-heritage money reaching
> Bulgaria" is **ⓑ €48.8m / 202 partner rows / 168 partners** (guarded; the draft said
> €89.6m / 340) — and those partners are overwhelmingly общини and NGOs, not culture
> institutes. **ⓑ Only 37 of 202 rows (18%) carry an EIK**, so an EIK-keyed sector filter
> silently drops four fifths of the second answer. Pick one per surface and label it; the
> thematic arm must be joined through `interreg_operations`, never through a beneficiary set.

---

# Part 1 — /culture

## 1.1 What it is today, and why it cannot serve an investigation

`CultureScreen.tsx` renders eleven tiles and **ten are НФЦ film subsidy**: KPI row, discipline
composition, time spine, funding-stream scale, municipal/читалища, concentration, biggest
awards, commissions, НФК grants, oblast map. The eleventh — `CultureAwardersTile` — is a
**static roster of names** linking to `/awarder/<eik>`, with no counts, no money, no risk.

The page answers "who gets film money" (€94.9m over 2014–2025) and cannot answer "who buys
what, from whom, with how much competition" (€146m) or "what EU money arrived" (ⓑ €147m). The
sector headline in `sector_stats.json` is `basis: "budget"` (€269,051,700), so it is not there
either. Film subsidy is **13% of the money on this page's subject** and 100% of its content.

## 1.2 Tier 0 — the EIK register (blocks everything else)

**ⓒ DONE 2026-08-18 (T0.6 → T0.1/T0.3/T0.4/T0.5 + the gate).** The register now carries
**FOUR** declared lists and 78 classified EIKs, and `scripts/db/tests/culture_register.data.test.ts`
enumerates candidates from the corpus and fails on any unclassified buyer over €200k.

**T0.6, decided:** the ROLL-UP stays _principal = МК_ — this file's founding rule, and what keeps
НАТФИЗ and НХА treated alike — and the bodies that rule turns away get a declared `ADJACENT_EIKS`
list rather than the anti-allowlist. The old `EXCLUDED_EIKS` was carrying two different claims
under one name: „this is not a culture body" (Община Куклен, a regex false match) and „this is a
culture body that answers to somebody else" (Националният военноисторически музей). Reading the
second as the first is what made Tier D look „absent" in this plan when it had been documented all
along, and why €28.6m of art-academy procurement had no home. Adjacent bodies are declared,
gate-accepted, surfaceable as a labelled band, and in no roll-up, headline or €-total.

What the sweep then found — the reason a gate beats a re-read: **20 more unclassified buyers over
€200k**, in none of the plan's Tier B/C/D lists. Three were plainly state (Държавна опера — Стара
Загора, a Държавен куклен театър, НИНКН → roll-up), one БАН (→ adjacent), three municipal or NGO
(→ excluded), and thirteen were the regional museum/library/theatre class Tier C exists for
(→ verify-principal: listed, not resolved).

Measured coverage, re-derived after the change:

| Tier                                         | Buyers                | Contracts | Money            | Single-bid          | Status                                                                                         |
| -------------------------------------------- | --------------------- | --------- | ---------------- | ------------------- | ---------------------------------------------------------------------------------------------- |
| **ⓒ A — funders + institutes + art schools** | **42** of 45 declared | **881**   | **€157,944,723** | **42.0%** (260/619) | **the roll-up**                                                                                |
| — of which **B art schools** (was absent)    | **17**                | 186       | €10.19m          | **46.5% (72/155)**  | **+5.6 pts over the 40.9% baseline**                                                           |
| **ⓒ C — verify-principal**                   | **31** of 38          | 152       | €19.60m          | 40.6%               | listed, unresolved; T3.1 settles them                                                          |
| **ⓒ D — adjacent (non-МК principal)**        | **13**                | 434       | €49.80m          | 28.6%               | **NEW declared list** — higher-ed arts, БАН, МО, МЗХ                                           |
| **ⓒ E — народни читалища**                   | **86**                | 134       | €18.05m          | 20.0%               | labelled sub-group, by NAME rule (T0.5)                                                        |
| — excluded (not culture bodies)              | 16 of 17              | —         | _n/a_            | —                   | two are whole MUNICIPALITIES, so a €-total here is their entire procurement, not culture money |
| **ⓒ Universe (the gate's sweep)**            | **220**               | **1,887** | **€275,747,377** | 40.5%               | **57% of the money is in the roll-up**                                                         |

All rows are `tag = 'contract'` — amendments excluded, as everywhere else in this plan. Buyer
counts read „declared EIKs that actually procure": the roll-up declares 45 and 42 have contracts
(НФЦ never procures; two state puppet theatres have published procedures but no award).

⚠️ **The plan's own tier table was wrong in five places and every one was a hand-count.** Tier B
is 17 schools, not 10 (€10.19m at 46.5%, not €9.48m at 53.0% — and that 53.0% was ALSO published
in `kulturaReferenceData.ts`, where the corpus never reproduced it); Tier C is 38 declared, not
9; Tier D is a 13-member class, not 3; the universe is 220 buyers / €275.7m, not 129 / €219.7m;
and the sweep found buyers in `tenders` a contracts-only count can never see, including two state
theatres that belong in the roll-up. Nothing here is hand-counted now — the gate derives the
candidate set from BOTH corpora.
the register is hand-counted now — the gate derives the candidate set from `contracts`.

- **ⓐ T0.0 — ✅ DONE (2026-08-18) — `src/lib/cultureMatch.ts` + `scripts/db/tests/culture_match.data.test.ts`.**
  It found the ИСУН headline was ~70% false positives AND that the first correction carried a
  false negative of its own; the plan's central money claim went €474m → €129m → €147m before
  settling at „the same size as procurement“ (see the ⚠️ in §0). Original statement: Four of the plan's headline
  figures are stated without a reproducible basis, which is §0's own rule failing on itself.
  Land these as **one exported module** (`scripts/culture/cultureMatch.ts` or similar) plus a
  test that pins each number, and re-derive §0 from it:
  1. the **ИСУН beneficiary-name regex** behind €474,276,649 — the largest number in the plan;
  2. the **ДФЗ beneficiary-name regex** the `!~* 'култури'` guard guards (the guard is
     specified, the thing it guards is not);
  3. the **Interreg thematic join** — anchored (`\yart`), and reconciled against the draft's
     420 rows / €89.55m, which the anchored _and_ unanchored forms both fail to reproduce;
  4. the **Tier A set** — the draft's 21 EIKs / 674 contracts / €145.97m is not
     `CULTURE_GROUP_EIKS` (23 / 677 / €146.46m), and the risk-grade row sums to 674, so the
     draft's set is inside the grade split too. Either declare the three-row difference or
     restate everything on `CULTURE_GROUP_EIKS`.
     Nothing downstream — no tile, no blob, no gate — can be written against a set nobody can
     reconstruct. This is now step 1's first item.
- **ⓒ T0.1 — ✅ DONE. Fifteen, not ten.** МК-principal national art schools, in none of the file's
  three lists. **НУКК `831154303`** is the largest buyer in the ACF story (€3.20m) and appears
  in no roll-up, roster, map or search box. Highest single-bid tier in the universe.
- **ⓒ T0.2 — still open, and now 22 EIKs / €18.47m rather than 9 / €14.22m.** Pending since v1 §15; now the difference
  between a €146m and a €160m sector. Resolve from the МК ДКИ register (T3.1).
- **ⓒ T0.3 — ✅ EVIDENCE RECORDED; the verdict deliberately did NOT move.** ACF says principal
  = МК; the theatre is an ОКИ of Столична община and appears in no МК ДКИ listing. The two
  claims are not reconciled from a primary source, so `EXCLUDED_EIKS` now carries both and
  names T3.1 as what settles it — municipal being the reading that does not put a municipal
  theatre into a state roll-up.
- **ⓒ T0.4 — ✅ DONE, and it was NINE buyers, not one.** The theatre had no seat; nor did eight
  more roll-up members, led by Държавен куклен театър — Варна at €3.16m — all invisible to
  `/procurement/by-settlement`, the settlement payloads and every place surface, while their
  money still counted in every national total. Fixed generically rather than per body:
  `CURATED_AWARDER_SEATS` in `scripts/procurement/enrich_awarder_seats.ts` sits between the geo
  block (evidence) and the name parse (a heuristic), takes a settlement NAME rather than an
  EKATTE code so it stays reviewable, and resolves through the same resolver — so a curated
  entry cannot invent a place. Eight seeded; `000804072` („Държавен куклен театър“) is
  deliberately left unresolved because the corpus names no city and a guess would invent one.
- **ⓒ T0.5 — ✅ DECIDED as recommended: a labelled sub-group**, defined by the NAME rule
  `chitalishteNameSql()` rather than an allowlist — there are ~3,000 читалища, they turn over,
  and the register gate treats a name match as classified. Original note: €18.05m of procurement, **€22.1m of EU grants across
  1,196 beneficiaries**, and the largest culture stream (€88.3m/yr). Recommend: a labelled
  sub-group, excluded from the headline, reachable from it. ⓐ Note the ceiling: the
  `awarder-group-model` route **caps at 300 EIKs and silently `slice(0,300)`s the excess**
  (`functions/db_routes.js`). The universe is 129; universe + Tier E (86) + T3.1's ~74 ДКИ is
  ~289. Whatever set the group model is pointed at, it is one roster expansion from silent
  truncation — add a length assertion at the call site rather than discovering it as a
  quietly-shrinking total.
- **ⓐ T0.6 — Decide what the "universe" IS, before Tier D moves.** The draft calls
  Шипка-Бузлуджа / НХА / НАИМ "absent". Two are not: `EXCLUDED_EIKS` carries `000804161`
  (Шипка-Бузлуджа, `principal: "mo"`) and `000670919` (НАИМ, `principal: "ban_mon"`), each with
  a documented reason, and the file's whole design is hand-classification **by principal**.
  НХА is the same class as НАТФИЗ (`000670723`, excluded as higher-ed/МОН) — so as drafted the
  plan admits one art academy and keeps the other out. Adding Tier D therefore reverses two
  standing decisions rather than filling a hole.

  **The rule has to be stated first**, because it decides the headline: is the universe
  _principal = МК_ (in which case Tier D is correctly excluded and the sector is ~€188m), or
  _everything a reader would call culture_ (in which case Tier D and the МО military museums
  belong, at ~€220m, and `EXCLUDED_EIKS`' `principal` field becomes a label rather than a
  filter)? Both are defensible; they are different pages. T0.1–T0.4 and §1.2's gate cannot be
  written until this is answered, and neither can §3.2-A's rule.

**Gate:** a data test enumerating buyers matching the culture regex (T0.0's, by name),
subtracting the declared lists, failing on any unclassified buyer above a money floor. ⓐ It
takes **four** lists, not three — `CULTURE_GROUP_EIKS`, `VERIFY_PRINCIPAL_EIKS`,
`EXCLUDED_EIKS` and whatever T0.5 makes читалища.

## 1.3 The generic `?sector=` filter — **DECIDED** · ⓐ **and ~70% already shipped**

One filter, ~20 sector surfaces, no bespoke routes.

> ⓐ **The audit's largest structural finding: `?sector=` is not new work.** It exists, it is
> read, and it already spans the sector packs:
>
> - **Read on `/procurement/contracts`** — `ContractsBrowserDbScreen.tsx:75`,
>   `getSectorBrowsePack(params.get("sector"))`.
> - **Read on `/procurement/tenders`** — `TendersBrowserDbScreen.tsx:90`, pushing
>   `{ id: "buyer_eik", value: [...pack.eiks] }`.
> - **`SECTOR_BROWSE_PACKS` (`src/screens/components/procurement/sectorPacks.tsx:216`) IS the
>   `SECTOR_EIKS` registry this section proposes to create** — `Record<string, { id, label,
eiks, Section? }>`, **18 entries** (water, roads, noi, nzok, agri, judiciary, defense,
>   security, revenue, customs, edu, transport, social, environment, regional, administration,
>   energy, tourism), each sourced from the per-sector reference module, resolved through
>   `getSectorBrowsePack()`, and referenced from `SectorDashboardConfig.browsePackId`.
> - **`contracts.awarder_eik` is already `filter:"in"` for exactly this** — see the comment at
>   `functions/db_table.js:106`: _"so a sector browse pack can pass an EIK-set as a
>   fixedFilter"_.
> - **Unknown keys are already dropped** — `getSectorBrowsePack` returns `null`. The
>   "validated on read" requirement below is already met, and **not** by
>   `useUrlProcurementFilters`, which does not own this param.
>
> **What is actually missing is much narrower**, and the sequencing in §3 was sized against the
> wrong scope:
>
> |                                             | State                                                                                                 |
> | ------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
> | a `culture` entry in `SECTOR_BROWSE_PACKS`  | ⓐ **absent — one line**, and it alone delivers both Band 3 links                                      |
> | `?sector` on `/procurement/contractors`     | ⓐ **not servable as designed — see §1.3-B**                                                           |
> | `?sector` on the funds / subsidies browsers | genuinely new                                                                                         |
> | the `role` (awarder vs beneficiary) split   | genuinely new                                                                                         |
> | a SQL `sector_eik` dimension                | ⓐ an **optimisation** over today's array-in-request, not a prerequisite — needs its own justification |

- **Registry.** ⓐ **Extend `SECTOR_BROWSE_PACKS`; do not mint a parallel `SECTOR_EIKS`.** A
  second registry over the same 18 sectors is the drift this section exists to prevent. What it
  needs is (a) a `culture` entry, (b) the `role` field below, (c) an import path `scripts/` can
  use — today it lives in a `.tsx` module that pulls in React components (`Section`), so the
  loader-side split is real work: move the data half to a `.ts` sibling and keep the component
  map beside it.
- **SQL.** A `sector_eik(sector_key, eik, role)` dimension loaded from that registry, so
  `db_table.js` resolves `?sector=culture` to an indexed `= ANY(...)` predicate rather than a
  literal array in the route. ⓐ **Justify it before building it.** The array form works today
  at 129 EIKs and the `in` filter is indexed either way; the arguments for the dimension are
  that `scripts/` and the generators need the same set server-side, and that the 300-EIK route
  cap (T0.5) disappears. Neither is "the filter doesn't work without it".
- **`role` is load-bearing.** The same EIK is a BUYER on `contracts`/`tenders` and a
  BENEFICIARY on `fund_projects`/`agri_subsidies`/`interreg_partners`. One column
  (`awarder` | `beneficiary` | `both`) keeps a filter from joining a buyer set to a
  beneficiary corpus and reporting zero. ⓐ This is the one part of the section with no existing
  implementation at all — `SECTOR_BROWSE_PACKS` is buyer-only by construction.

**It must span all four money corpora, not just contracts.** Migration 127
(`company_public_money`) already unions exactly these four arms —
`contracts ∪ agri_subsidies ∪ fund_beneficiaries ∪ interreg_partners` — so the four-corpus
union is an established repo pattern with a canonical spec and a data test pinning it. The
sector filter follows it:

| Corpus                  | Key                         | Culture coverage                                        | Caveat                                              | ⓐ Filter state                                                                                  |
| ----------------------- | --------------------------- | ------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `contracts` / `tenders` | `awarder_eik` / `buyer_eik` | €146.5m (23) → €219.7m (129)                            | —                                                   | **already works** — needs a `culture` pack entry                                                |
| `fund_projects` (ИСУН)  | `beneficiary_eik`           | **ⓓ €94.1m** exact (40 rows) / **€147.1m** name-matched | state which matching                                | **ⓓ the ONE beneficiary corpus the culture EIK set reaches** — declared in `beneficiaryCorpora` |
| `agri_subsidies` (ДФЗ)  | `eik`                       | €18.3m, **читалища only** (96% of the €19.0m arm)       | guard mandatory — now `CULTURE_NAME_EXCLUDE`        | resource exists; no reader. See open Q6 — may be name-only                                      |
| `interreg_partners`     | `eik`                       | €11.0m bodies / **ⓑ €48.8m** thematic (guarded)         | **ⓑ only 18% of thematic partner rows have an EIK** | **no DbDataTable resource at all** — no browser destination exists                              |

- **ⓓ Step 2 shipped (2026-08-18):** a `culture` entry in `SECTOR_BROWSE_PACKS` (the roll-up,
  not the wider universe), a `role` field on `SectorBrowsePack`
  (`awarder` | `beneficiary` | `both`, defaulting to `awarder` because every pre-existing pack
  is a buyer set), `sectorBeneficiaryEiks()` as the only way a pack reaches a recipient corpus,
  and `sector_beneficiary_reach.data.test.ts`. The two contracts/tenders links Band 3 needs now
  work.

  **The funds/subsidies wiring is a REFUSAL, and the refusal is the finding.** An EIK-keyed
  sector filter is valid only on a corpus where that sector's bodies appear under their own EIK,
  and that is decided PER CORPUS — a single „is this sector also a recipient" flag shipped first
  and was wrong. Culture is a recipient, and of the three recipient corpora its 45 EIKs reach
  exactly one:

  | corpus              | ∩ CULTURE_GROUP_EIKS | the sector's real money there                        |
  | ------------------- | -------------------- | ---------------------------------------------------- |
  | `fund_projects`     | **40 rows / €94.1m** | answerable by EIK ✅                                 |
  | `agri_subsidies`    | **0 rows**           | €18.3m — to народни читалища, a NAME population      |
  | `interreg_partners` | **0 rows**           | ~€11m — partner rows that mostly carry no EIK at all |

  In both zero cases the money exists and the EIKs cannot see it, so an empty result is not
  „nothing here" but „not answerable this way" — and the two must not look alike. `?sector` is
  therefore refused on both, in code, by `beneficiaryCorpora`. `/funds/beneficiaries` is separately not a DbDataTable at all —
  it renders from `useFundsIndex()` — so its sector arm is a client-side filter over that blob
  and belongs with the `/culture/funds` body in step 6, not here.

- **Surfaces.** `?sector=` on `/procurement/contracts` ⓐ(done), `/procurement/tenders`
  ⓐ(done), `/procurement/contractors` ⓐ(**see §1.3-B — not servable**), and the
  funds/subsidies browsers ⓐ(new). Validated on read — ⓐ already true via
  `getSectorBrowsePack`; **not** `useUrlProcurementFilters`, which does not own this param, so
  do not add a duplicate validator there.
- **Reciprocity gate** (hub skill §4): every sector key a tile links with must be read by the
  destination. A `?sector` landing on an unfiltered browser is the exact failure the see-all
  rule exists to prevent. ⓐ **As drafted, this plan fails its own gate twice** — Band 2's
  headline tile and finder subject 3 both point at `/procurement/contractors?sector=culture`.
- **Coverage must be declarable per corpus.** An EIK-keyed filter over Interreg answers **ⓑ 18%** of
  the thematic question. The filter returns its own coverage so a surface can say so, the way
  `/api/db/tender-search-coverage` already does.
- **Why it beats a bespoke route:** the culture set is 23→~40 EIKs today and moves with
  T0.1/T0.2/T3.1. A route bakes a set; a filter reads one — ⓐ and the ~18 other sector surfaces
  **already have it**, which is the strongest available argument for the shape.

### ⓐ 1.3-B `/procurement/contractors?sector=` is not servable — decide the destination

`contractor_rank` (migration 122) has **no buyer dimension**. Its columns are
`(scope_key, eik, division, name, name_fold, total_eur, contract_count, award_count,
total_other, is_mp_tied)` — it aggregates CONTRACTORS, while `?sector` is a predicate on the
BUYER. There is nothing to filter on.

Adding one is not a column. The resource is already a **two-dimensional fan-out** with rollup
buckets — `functions/db_table.js:1648` documents that omitting `division` unions the `'ALL'`
row with every per-division row and yields a _~2× double-counted leaderboard served at 200_,
which is why `defaultFilters` exists. A third dimension multiplies
`(scope_key × division × sector)` and re-opens exactly that class.

**ⓓ DECIDED 2026-08-18 — option 3, re-point.** Confirmed first that nothing links `?sector` at
that browser today: `TopContractorsScreen` reads `useUrlContractorFilters`, which owns `?cpv`
and `?mp` and has never read `?sector`, so this is a decision about what NOT to build rather
than a bug to fix. The rule now lives where someone would otherwise add it — a `⛔` block in
the hook's header, and two tests in `useUrlContractorFilters.test.tsx` that fail if the param
reappears (comment-stripped first, since the header now discusses it at length). Band 2's tile
and finder subject 3 point at `/culture/procurement#contractors`, built in T1.2b from
`awarder_group_model`'s complete per-contractor rollup — data that call already returns.

Three options; **the plan assumed the first and never stated it**:

1. **New precompute arm** — a sector dimension on 122, with the rollup-bucket guard extended.
   Real cost: 122 already fans ~29.5k contractors × ~30 windows × CPV division ≈ 9 s locally,
   and every `db:load:procurement-scopes:pg` pays it.
2. **Live aggregate for the sector case only** — `?sector` bypasses the matview and aggregates
   `contracts` filtered by `awarder_eik = ANY(...)`. Cheap for 129 buyers; must be measured
   against the 10 s `statement_timeout` before it is promised, and it makes one surface serve
   two different query shapes.
3. **Re-point the two links.** Band 2's "Изпълнители на културата" and finder subject 3 go to
   `/culture/procurement#contractors` instead — the cross-buyer supplier view (T1.3) is a
   better answer to that reader's question anyway, and `awarder_group_model` already returns a
   **complete** per-contractor rollup for an EIK set (§1.4). **✅ CHOSEN**: it costs nothing, it
   removes the gate failure, and it keeps 122 single-purpose.

## 1.4 Tier 1 — the procurement layer

Everything here runs on primitives that **already exist**. No new migration.

`awarder_group_model(text[], from, to)` (migration 061) returns, for any EIK set: head totals,
bid-known/single-bid counts, a **complete** per-contractor rollup and per-CPV buckets. It is
what the sector packs run on. Point it at the culture set. ⓐ Two constraints from the audit: the
route **caps at 300 EIKs** and truncates silently (T0.5), and its **complete per-contractor
rollup is what makes §1.3-B's recommended fix free** — `/culture/procurement#contractors` is a
render of data this call already returns, not a new query.

- **T1.1** — `useCultureProcurement` over `awarder_group_model` with the resolved set. Reuse
  `buildAwarderModelFromAggregates`; never fetch contract rows client-side.
- **T1.2** — The aggregates land on `/culture/procurement` (§1.7), not on the hub. The hub gets
  only the two or three headline numbers from the hub blob.
- **ⓐ T1.2b** — `#contractors`: the sector contractor leaderboard, from T1.1's rollup. This is
  the destination Band 2 and finder subject 3 point at instead of
  `/procurement/contractors?sector=culture` (§1.3-B), so it is not optional decoration.
- **T1.3** — The **cross-buyer supplier** view, which no current surface offers: measured,
  **ДИНАКОРД-БЪЛГАРИЯ ЕООД serves 9 of the culture buyers (€5.38m)**, А1 5 (€14.26m), Форс
  Делта 4, **Д & Д ООД 3, Крипто енерджи ЕООД 3**. One supplier across many small independent
  buyers is the shape an investigation starts from.

## 1.5 Tier 2 — the people bridge (the part nobody else has)

We hold **198 culture-institute directors**, every one a public figure with a declaration, and
**we cannot link one to the institution they run.** `person_role.ref` is the officials slug,
`source_row` is NULL, `official_roster` has no EIK, and `declaration.institution` is the
register's **group label** — "Културни институти и институции" for all 380 filings,
"Процедури по ЗОП" for all 2,848.

The employer is in the data and always has been. `<Personal><Work>` names the actual
institution; `scripts/officials/slug_identity.ts` already parses it (`workOf()`) **only to
disambiguate slugs, and never persists it.** Measured: **44,142 XMLs on disk, 17,389 distinct
`<Work>` values.**

- **T2.1 — Persist `<Work>` as `declaration.employer`.** A column plus a backfill from the
  existing cache. No network. Highest-leverage cheap change in this plan, and **not
  culture-specific**: it gives an employer to school heads (4,527), hospital heads (2,693),
  state enterprises (5,826) and procurement officers (2,848).
- **T2.2 — `employer → awarder_eik` resolution.** Free text typed by the declarant (the
  officials code documents `ОУ' Д-Р ПЕТЪР БЕРОН"` with stray quotes): fold + trigram match
  against `contracts.awarder_name` ∪ `tr_companies.name`, **store a confidence, publish only
  exact/high**, keep the unresolved visible rather than silently dropped. Per
  `feedback_name_match_not_identity`, show the declared string; never assert the match below
  the bar.
- **T2.3 — „Кой ръководи"** on `/culture/institutions`: each institute with its director,
  their `/person` link, and whether a current declaration exists.
- **T2.4 — The procurement-officer layer (general).** 782 named „Упълномощено лице по ЗОП",
  2,848 filings, 2018–2025, all resolved to `person_id`. With T2.1 they gain an institution,
  making "who was authorised to run procurement at this buyer, in this year" a queryable fact
  on every `/awarder/:eik`. Nothing comparable is published in Bulgaria, and it is the closest
  our data gets to the external-expert/committee angle the ACF story turns on.

## 1.6 ⭐ The money spine — grant → contract lineage (NEW, and general)

The strongest capability the research turned up, and it is not culture-specific.

`fund_projects.contract_number` **is** the ПИИ code, and the same code is written into the
procurement subject:

```
fund_projects  BG-RRP-4.020-0003  Драматичен театър Ловеч   grant €1,167,391  paid €1,095,826
tenders        06257-2024-0002/3  "…ПИИ BG-RRP-4.020-0003: Устойчиво енергийно обновяване…"
contracts      Крипто енерджи €35,279 (авторски надзор) · Нитов инженеринг €824,801 (СМР)

fund_projects  BG-RRP-4.020-0001  Държавен сатиричен театър grant €1,078,149  paid €1,074,305
tenders        00829-2024-0001    авторски надзор  →  Крипто енерджи €34,512
               00829-2025-0002    СМР              →  Д & д ООД €897,058 (1 bidder, grade C)
```

**Measured join feasibility: 260 of 263 ПИИ codes extracted from tender subjects match a
`fund_projects` row — 98.9%.** 14,180 fund_projects carry a BG-RRP `contract_number`; 1,829
tenders and 2,703 contracts carry a code in their text.

- **T1.6a — A `grant_contract_link` table**: `(pii_code, unp, contract_key, confidence,
basis)`, built by regex over `tenders.subject` + `contracts.title`, joined to
  `fund_projects.contract_number`. Extraction is a regex over free text, so **store the basis
  and never present a link as authoritative below exact-code confidence.**
- **T1.6b — Coverage must be published, like `tender-search-coverage`.** This covers the RRF
  slice only. A "money spine" tile that silently omits ЕФРР/ЕСФ contracts reads as "this grant
  bought nothing".
- **T1.6c — Surfaces**: a spine strip on `/funds/contract/:key`, on `/awarder/:eik`, and as the
  signature tile of the culture hub. Extend to ЕФРР/ЕСФ codes once the RRF slice is proven.

## 1.7 `/culture` becomes a hub — the restructure

**Route plan.** `/culture` keeps its URL (it is prerendered and indexed) and changes content.

| Route                                 | Today                  | After                                                              |
| ------------------------------------- | ---------------------- | ------------------------------------------------------------------ |
| `/culture`                            | film-subsidy dashboard | **the hub** — intro, finder, four bands                            |
| `/culture/subsidies`                  | —                      | **NEW** — today's `CultureScreen` body, moved verbatim             |
| `/culture/procurement`                | —                      | **NEW** — the group-model dashboard (§1.4)                         |
| `/culture/funds`                      | —                      | **NEW** — EU money into culture + the spine                        |
| `/culture/institutions`               | —                      | **NEW** — the register: who they are, who runs them, what they buy |
| `/culture/films`, `/culture/film/:id` | browser + record       | unchanged                                                          |

⚠️ **SEO decision required.** `/culture` currently carries the film-subsidy copy and whatever
it ranks for. Moving that body to `/culture/subsidies` needs: a `staticPage` prerender entry
and sitemap `<loc>` for every new sub-page, `dist/<path>/index.html` verified after build, and
the hub intro retaining the subsidy vocabulary. Per `project_seo_discovery_gap`, broader-data
pages already earn ~0 impressions — do not assume the hub inherits the dashboard's traffic.

**ⓐ The move touches five files, not one, and one of them is a BUILD-TIME data dependency:**

1. **`scripts/prerender/routes.ts:229`** — `cultureFacts` **reads `data/culture/overview.json`
   at build time** and every sentence of the `/culture` prerender body (BG and EN) is
   interpolated from it: total subsidy, film count, producer count, top-10 share, biggest
   producer. That body moves _with_ the film content to `/culture/subsidies`; the hub's new body
   needs its own facts source. Same class as the `/court/**` dependency in CLAUDE.md — a
   missing/renamed file degrades quietly rather than failing the build.
2. **`scripts/prerender/routes.ts:2505` and `:2544`** — the BG and EN "one entry to every state
   body" index pages both describe `/culture` as _„филмови субсидии и комисии"_ / _"film
   subsidies and commissions"_. Both become wrong the day the hub ships.
3. **`scripts/sitemap/route_defs.ts`** — **two** halves, and both need the four new paths: the
   path list (`:73`) and the path→file map (`:160`).
4. **`src/routes.tsx`** — four lazy routes, and `scripts/sitemap/families.data.test.ts` gates
   that every `<loc>` has a real `dist/<path>/index.html`, so run it **after** `npm run build`.
5. **`scripts/llms/buildFull.ts`** — if a culture section is enumerated there, its refusal gate
   fires when a section disappears; check before renaming.

**ⓐ Each new sub-page must declare its `ScopeSupport`, and `/culture/funds` has the hard case.**
`?pscope` is in the `usePreserveParams` allowlist, so a scope minted anywhere else rides onto
these pages. `/culture` resolves it today via `scopeCultureOverview` (a year re-aggregation over
`films.json`); the sub-pages inherit nothing.

- `/culture/procurement` — years 2011→current, `allowAll` yes. Straightforward.
- `/culture/subsidies` — the existing НФЦ coverage, moved verbatim with the body.
- **`/culture/funds` — `fund_projects` has NO date columns at all** (CLAUDE.md states this;
  confirmed — the table carries `status` and `duration_months`, no signing/start/end date). A
  year scope is **not answerable**, so decide now between `useScope({ allowAll: true, years: [] })`
  with the picker suppressed, or the `/subsidies` pattern of keeping the raw scope and NAMING
  the gap. What it must not do is show one window and count another — and a Radix `<Select>`
  whose controlled value matches no item renders **empty**, not as a placeholder.
- `/culture/institutions` — a register, not a time series; suppress the control.

**Bands** — named for what is in them, each with a one-line `descKey` (hub skill §3). Grid is
4 columns at `xl`; counts are 4/4/4/3 so no tile is stranded.

**Band 1 — „Парите" · where culture money comes from, in one place**

The full picture, measured. **ⓑ Seven** streams on five different bases — which is precisely
why each tile carries its basis as its `metricSecondary` rather than in a footnote.

**ⓑ Ordered by SOURCE — state, then procurement, then EU, then the sub-groups — and
deliberately NOT by magnitude**, per the ⚠️ below. Sorting this table by € is what asserts the
thing that is not true.

| Stream                          | Amount                                        | Basis                                                | ⓐ Window                                    |
| ------------------------------- | --------------------------------------------- | ---------------------------------------------------- | ------------------------------------------- |
| Бюджет на МК                    | €269.1m **/ yr**                              | 2026, by law                                         | **one year**                                |
| Обществени поръчки              | €146.5m (23 EIKs) / €219.7m (universe of 129) | post-annex current value                             | cumulative, ~2011→now                       |
| **ⓑ** ИСУН (name-matched)       | **€147.1m**                                   | 1,365 beneficiaries — EIK-exact subset ⓓ €94.1m      | **undated — the corpus has no date column** |
| НФЦ филмови субсидии            | €94.9m                                        | 944 projects                                         | cumulative, 2014–2025                       |
| Interreg — тематично            | **ⓑ €48.8m** (guarded)                        | 202 partner rows, **ⓑ 37 of 202 (18%)** EIK-resolved | cumulative, multi-period                    |
| Interreg — културни организации | €11.0m                                        | 67 partners                                          | cumulative, multi-period                    |
| ДФЗ — читалища                  | €18.3m                                        | 197 читалища, crops excluded                         | cumulative, 2015–2025                       |

> ⚠️ **ⓐ This table ranks a per-year FLOW against multi-year STOCKS, and the ordering itself
> asserts something false.** €269.1m **/yr** is ranked against €146.5m and €147.1m, which
> accumulate over 12–15 years — over the procurement window the МК budget line is roughly
> **€4bn**. ⓑ The ИСУН figure moved twice while this plan was being written (€474m → €129m →
> €147m) and crossed the procurement line in both directions on the way, which is the argument
> in miniature: an ordering that flips on a stem spelling was never carrying information. The
> table below is presented in a FIXED editorial order — budget, procurement, EU, film — and is
> deliberately not sorted by magnitude. Putting the basis in `metricSecondary` does not
> repair an _order_; a reader takes the ranking before the caption.
>
> Two of the seven are additionally not windowable at all: ИСУН has no date column, and the
> Interreg budget is a whole-operation figure spanning programme periods.
>
> Pick one and state it: **(a)** normalise everything to a common window and drop what cannot
> be windowed to a labelled aside; **(b)** split the tile into „годишен поток" and „натрупано
> от …" as two visually distinct groups; or **(c)** drop the ranking and present the streams in
> a fixed editorial order. What must not ship is a magnitude-sorted list mixing the two.

| Tile               | Destination            | Headline · secondary                                  |
| ------------------ | ---------------------- | ----------------------------------------------------- |
| **ⓑ** Еврофондове  | `/culture/funds`       | **€147m** ИСУН · „по име на бенефициент; €92m по ЕИК" |
| Обществени поръчки | `/culture/procurement` | ⓐ €146.5m · „677 договора, 336 доставчици"            |
| Филмови субсидии   | `/culture/subsidies`   | €94.9m · „944 проекта, 2014–2025"                     |
| Бюджет на МК       | `/budget/ministry/…`   | €269.1m · „2026, по закон"                            |

⚠️ **ⓐ `/governance/sectors` already publishes a culture headline, and it is a third number.**
`data/procurement/derived/sector_stats.json` carries `culture: { kind: "eur", basis: "budget",
value: 269051700, year: 2026 }`, written by `db:gen-sector-stats`. If the hub's headline is
€146.5m or ⓑ €147.1m, two surfaces disagree about what „culture" is worth with nothing failing.
Decide which is canonical and make the other cite it — and note the writer is a generator, so
changing it is a code change, not a data edit.

**Where ДФЗ and Interreg go.** Neither earns a band-1 tile — €18.3m and €11.0m against a
€269m budget line would over-weight them, and both are читалища/общини stories rather than
institute stories. They ride as **named arms inside `/culture/funds`**: a „Всички публични
пари" stacked view with one row per corpus, each labelled with its basis and its coverage.
That view is the four-corpus union of §1.3 rendered once, and it is the reusable piece —
every sector gets the same six-row breakdown from the same query.

**Band 2 — „Кой получава" · the recipients, ranked and cross-referenced**
| Tile | Destination |
|---|---|
| Изпълнители на културата | ⓐ `/culture/procurement#contractors` — **NOT** `/procurement/contractors?sector=culture`, which cannot serve it (§1.3-B) |
| Доставчици на повече от един възложител | `/culture/procurement#network` |
| Продуценти | `/culture/films` |
| Читалища и общини | `/culture/funds#chitalishta` |

**Band 3 — „Как се раздава" · the award mechanics, with the national baseline beside each**
| Tile | Destination |
|---|---|
| Конкуренция | `/procurement/contracts?sector=culture&single=1` ⓐ works the moment the `culture` pack entry lands |
| Риск | ⓐ `/procurement/contracts?sector=culture&grade=C,D` — **not `C,D,E,F`**: culture has zero E and F rows, and the tile's count must come from the same query as the link, not from the grade list |
| Анекси и обжалвания | `/culture/procurement#changes` |
| Кой решава (комисии) | `/culture/subsidies#commissions` |

**Band 4 — „Кой отговаря" · the people**
| Tile | Destination |
|---|---|
| Институциите | `/culture/institutions` |
| Директори и декларации | `/culture/institutions#people` |
| Проследи парите (спината) | `/culture/funds#spine` |

Rules that apply: **one accent per tile, unique across all four bands** (19 tokens exist in
`TILE_ACCENTS`, 15 needed); **every tile id has a scene** or the page white-screens; **no
seeded `:param` destinations** — `/culture/institutions` is the picker that replaces them.

⚠️ **ⓐ Six of the fifteen tiles point at a `#anchor`, and nothing gates those.** `#contractors`,
`#network`, `#changes`, `#chitalishta`, `#spine`, `#people`, `#commissions` — §4's gates check
that `to` is absolute and in the routed list, which a dead anchor passes. A `#` that resolves to
nothing is the seeded-destination defect with no error and no 404: the reader lands at the top
of a long page and concludes the tile lied. Add the anchor-existence gate in §4, and treat each
anchor as a **named section id the sub-page must declare**, not as a scroll convenience.

**One hub blob**, `data/culture/derived/hub_stats.json` — the ~15 headline numbers, coverage
flags and nothing else. Byte-budgeted and gated. No tile fetches an artifact.

> ⚠️ **ⓐ It is a `db:gen-*` artifact, not an ingest output — the draft names the wrong
> pattern.** „Generated from the objects the pipeline already holds in memory" is the hub
> skill's rule for a JSON-pipeline hub. This blob unions `contracts` ∪ `fund_projects` ∪
> `interreg_partners` ∪ `agri_subsidies`, none of which the НФЦ ingest
> (`scripts/culture/ingest.ts`) has ever seen. It is the `db:gen-hub-stats` /
> `db:gen-sector-stats` class — the sanctioned JSON-from-PG exception — and that class carries
> requirements this section omits:
>
> - **`REFRESH_GENERATORS` membership** (`scripts/db/refresh_coverage.ts:141`) **plus a place
>   in the `db:refresh` chain**, or `refresh_coverage.test.ts` fails. A new script dropped into
>   the generator directory must either join that list or carry the `--write` gate; it cannot
>   land outside.
> - **Position AFTER `db:load:interreg:pg`** — the chain's _last_ loader. `db:gen-hub-stats` and
>   `db:gen-sector-stats` sit right after `db:load:ngo-funding:pg`, roughly forty steps earlier;
>   putting the culture blob beside them regenerates its Interreg and graph-dependent arms from
>   the **previous** vintage and commits it. That is precisely the drift CLAUDE.md records the
>   existing slot was chosen to end.
> - **Skip-and-warn, exit 0, never a partial write** — a half-written blob overwrites a good
>   served file with a worse one and reconciles against nothing.
> - **No `:cloud` half.** It is a committed FILE. `data/culture/` is not in the `bucket:sync`
>   exclusion regex, so it ships automatically on a sync — which also means a local
>   `db:refresh` is the only thing that makes it current, and a cloud reload does not touch it.
> - **`--upload` is a different mechanism** (the per-ingest `uploadTextTree`) and is not what
>   ships this file. Do not wire it there.

## 1.8 The finder — four subjects on `HubSearch`

Built on `src/ux/search/HubSearch.tsx` + `hubSearchSources.ts`. **Do not build a new box.**
Declared in `src/screens/culture/cultureSearch.ts` beside the tile registry.

> ⚠️ **ⓐ „Do not build a new box" is ambiguous here, because `/culture` already HAS one — a
> different one.** `src/screens/culture/CultureSearchBox.tsx` runs on `SectorEntitySearch` +
> `buildMembersIndex` (`src/screens/sector/membersIndex.ts`), which is the shared mechanism
> behind **every** sector dashboard via `SectorDashboardConfig.SearchBox`. `HubSearch` +
> `scopedSources()` is the _other_ shared mechanism, used by the parliament and declarations
> hubs. Both are house patterns; they are not the same one.
>
> So this section is a **fork decision**, and it needs to be made explicitly:
> does `CultureSearchBox` die when `/culture` becomes a hub (and if so, does `SectorEntitySearch`
> stay the pattern for the other ~18 sector dashboards, leaving culture the odd one out), or
> does the finder wrap it? It matters beyond this page — **Part 3 is the skill whose job is to
> unify the sector layer**, and shipping a second search mechanism on the flagship sector
> surface is the divergence that skill would have to document rather than fix.
>
> Recommended: `HubSearch` for the hub (four subjects is past what an entity index does), and
> **keep the culture roster as an `IndexSource` inside it** — that is subject 3's client index
> below, and it is the same `buildMembersIndex` data, so nothing is thrown away. `/culture`
> ceases to have a `SectorEntitySearch`; the sub-pages do not gain one.

**The scope axis here is the SECTOR, not the year.** `/culture`'s `?pscope` is a year picker,
but a reader searching „Динакорд" wants culture hits first and everything else below — not
2024 hits above 2023. The split maps exactly onto the new `?sector=culture` predicate, so one
mechanism serves both the finder and the browsers.

| #   | Subject                              | Kind                                                                      | In-scope group                        | Out-of-scope group              | See-all (in-scope only)                                                                     |
| --- | ------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------- |
| 1   | Procurement (contracts + tenders)    | server, `/api/db/procurement-search` + `?sector`                          | „Поръчки в културата" (5)             | „Поръчки в други сектори" (3)   | `/procurement/contracts?sector=culture&q=`                                                  |
| 2   | Public money — ИСУН + Interreg + ДФЗ | server, `search_fund_projects` (086) + `search_interreg_operations` (138) | „Проекти на културни организации" (5) | „Проекти в други сектори" (3)   | verify a page reads `?q` first — **no see-all if none does**                                |
| 3   | Awarders + companies                 | **index** (culture roster, instant) + server `/api/db/company-search`     | „Културни институции" (6)             | „Други фирми и възложители" (3) | ⓐ `/culture/procurement#contractors` — **not** `/procurement/contractors?sector=…` (§1.3-B) |
| 4   | Persons                              | server, `/api/db/person-search`                                           | —                                     | —                               | `/persons?q=`                                                                               |

Three things this design commits to, each because the skill records the failure:

- **`scopedSources()` mints each pair as TWO INDEPENDENT SOURCES**, own corpus, own cap. A
  partition over one ranked result set silently becomes a filter.
- **Subject 4 ships as ONE group with `outSource: null`** until T2.2 lands. There is no
  "culture person" subset before the employer bridge exists, and inventing one would make the
  in-scope group empty and the split meaningless. When T2.2 lands it becomes a pair.
- **Subject 2 ships without a see-all unless a funds page reads `?q`.** A link advertising a
  filtered destination and delivering an unfiltered one is the declarations-hub defect.
  ⓐ **The draft's evidence for this is wrong in both directions, though its conclusion
  survives.** `/funds/calls` **does** read `?q` — `OpenCallsScreen.tsx:291`,
  `initialSearch={params.get("q") ?? undefined}` — but it is the OPEN-calls register, so it is
  the wrong destination for an _awarded_-projects search regardless. The page that should be
  subject 2's see-all is **`/funds/beneficiaries` (`FundsBeneficiariesScreen`), which reads
  neither `?q` nor `?sector`** and is not mentioned anywhere in this plan. So the real item is
  not „grep before linking" but a work item: **wire `?q` + `?sector` into
  `/funds/beneficiaries`**, then the see-all exists. Until then, no see-all.
- **Subject 2 is ONE group, not three.** ИСУН, Interreg and ДФЗ are three corpora answering
  one reader question („кой е взел публични пари"), and three groups of two rows each is a
  dropdown nobody scans. Union them server-side, ordered by amount, and put the corpus in each
  row's `sub` line — the label is „Проекти", the provenance is per row. **ДФЗ enters only via
  the читалища arm** and only behind the `култури` guard; a subsidy search returning „Институт
  по полски култури" on the culture hub is the false positive rendered as a feature.

The culture roster stays a **client index** (~40 rows, already static) so the box answers on
the first keystroke even while every server source is in flight, and works when they fail.
Shliokavitsa comes free via `shlyo_query_fold` on the server sources; the client index goes
through `translitSearch.ts`.

## 1.9 Best-in-class UI — what would make this the reference implementation

Grounded in what the corpus can actually support. Ordered by how much each changes what a
journalist can do.

**1. The money spine as a first-class object, not a chart.**
A horizontal flow — `EU грант / бюджет → институция → процедура → договор → изпълнител →
собственик` — where every node is a link, every edge carries a number **and its basis**, and
the whole strip has a permalink. This is the investigative object; nothing on the Bulgarian
web renders it end to end. Built once in `src/ux/`, it serves `/culture/funds`,
`/funds/contract/:key`, `/awarder/:eik` and every future sector. The Lovech theatre is a
complete worked example today (§1.6).

**2. No terminal numbers.** Every figure drills to the rows behind it. A number that cannot be
opened is an assertion; a number that opens is evidence. This is the single discipline that
separates a dashboard from a source.

**3. A receipts footer on every tile**, as a shared component rather than prose: _basis ·
source · corpus vintage · what is excluded_. The repo already writes these by hand in
comments and captions; promote it to a component so it cannot be forgotten, and so "as of"
dating is uniform.

**4. Journalist affordances, explicitly.**

- **Permalink reproduces the view** — scope and filters already live in the URL; extend
  that to the new sub-pages so a link in an article renders what the author saw.
- **Export** — CSV/JSON per table, stamped with the corpus vintage and the query.
- **Cite this** — one line: figure, basis, source, retrieved-on. Removes the commonest
  misquote (a scoped figure reported as a total).

**5. Entry by suspicion, not by browsing.** A „Сигнали" strip above the bands: single-bid
above the national baseline, near-ceiling awards, annex uplift, repeat cross-buyer suppliers,
cancelled-and-relaunched procedures. Each is **a filter into the browser, never a verdict** —
the wording is „за проверка", and each carries its own base rate so a reader can see whether
the signal is unusual.

**6. Two new risk checks the ACF story exposed**, both general and both currently absent from
the 13 in `contract_risk_cache`:

- **`nearCeilingAward`** — contracted ÷ estimated ≥ ~0.99. Measured: the НУКК façade
  contract came in **€0.29 under a €454,611.59 ceiling**. Needs a base rate before it ships
  as a signal — six of the eight ACF procedures sit between 98.8% and 100%, which suggests
  it is common for small buyers and must be scored against a peer group, not absolutely.
- **`cancelledAndRelaunched`** — same buyer, same folded subject, estimate within ε,
  relaunched within N days. Measured: `06257-2024-0002` cancelled 2024-10-21,
  `06257-2024-0003` published 2024-10-29 with an identical subject and an identical €35,535
  estimate.

⚠️ 112's bit order is **a contract — append only, never renumber**, or historic masks
silently re-map. These become bits 13 and 14. ⓐ **Verified** — `112` currently ends at
`a_nkid << 12` / `f_nkid << 12`, so 13 and 14 are the next free positions.

**7. Compare two institutions side by side.** Culture is 129 buyers of wildly different size;
a figure means nothing without a peer. Pin two, diff every KPI.

**8. A sector wire — „какво се промени".** New contracts, new annexes, new appeals, new
grants for the sector since a date. `funds_wire()` (144) is the existing pattern and
`ingest_first_seen` the existing basis. This is what brings a journalist back.

**9. Scenes that draw the real structure** (hub skill §2): a spine for the money tile, a
bipartite supplier↔buyer graph for the network tile, a ceiling-ratio dot strip for
competition. Generic bars are not worth the file.

**10. Honest thin-corpus states.** Culture procurement is lumpy — most institutes have single
digits of contracts, and a year filter empties tiles. Named empty states („няма договори в
този период"), never a grid of zeroes, and never a percentage over a denominator below a
floor.

## 1.10 Tier 3 — culture-specific ingests

- **T3.1 — МК's ДКИ register (~74 institutes).** Closes T0.2/T0.3 permanently, turns the
  frozen allowlist into a maintained one. Watcher + a gate failing when register and file
  disagree.
- **T3.2 — читалища subsidy per unit.** €88.3m/yr, currently one line on a scale tile.
  `Единен разходен стандарт × subsidised units` per община joins it to the 86 читалища buyers,
  the 1,196 EU beneficiaries and the governance dashboards.
- **T3.3 — Commission ↔ recipient overlap** (the deferred 9b). Name-match join between the
  commissions artifact and the person layer. Ship **only** as "flagged for review"; the
  original defamation policy gate stands.

---

# Part 2 — new procurement datasets (all approved for ingest)

Ranked value × ease. "Ease" accounts for a crawl being an operator action, not a pipeline step.

### P1 — Finish the ЦАИС ЕОП dossier crawl. **A decision, not a project.**

`tender_dossier` + six siblings (migration 146) and the crawler exist and are probe-verified.
Run on **1,861 of 237,321 procedures (0.78%)**.

⚠️ **The cost of this is ~26 HOURS, not the ~1.4 h an earlier draft of this paragraph
claimed.** That draft read the wrong column of `tender-dossier-ingest-v1.md` §5's table:
**~1.4 h @100 Mbit is TIER B's transfer time** — 57 GB of техническа спецификация files
over the wire — while **tier A, the JSON crawl this step actually runs, is ~830,000 API
calls at ~26 h**. The export-ZIP bulk route (§9.1) removes ~394k signed-URL calls from
tier B; it does not touch tier A's per-tender method calls, which are the wall clock.

Re-probed 2026-08-19, two dry runs, 3,240 calls, **0 failures / 0 empty / 0 denied and no
throttling**: sustained **13.2 req/s** at concurrency 6, above the 8.97 the crawler's own
header records as measured-safe. Both ends of the corpus serve — the 2026-08-17 newest and
the 2020-01-02 floor. Remaining work set **130,144 of 132,141** ЦАИС-era tenders (the store
holds 1,997, i.e. 1.5%), ≈1.06M calls, so **22 h at the observed rate and 33 h at the
conservative one**. The ~26 h figure is sound; the 1.4 h one was never about this step.

Unlocks, measured against the claims we could not answer: `contact_name`/`contact_email`/
`contact_phone` per procedure; `tender_document` + `tender_document_text` (documentation,
specifications, and per §10 the протоколи — the committee trail); the award-stage
announcements. Note document search is **already live** and answering from 0.78% of the corpus.

### P2 — ЦПРС (Централен професионален регистър на строителя). **Zero references in the repo.**

Which companies are licensed for which construction category and group, since when, with what
declared staff and turnover. It is the **eligibility check on every works contract**: "did this
contractor hold the required licence class on the award date?" — answerable nowhere on the
Bulgarian web today. Small (tens of thousands of rows), joins on `contractor_eik`.

### P3 — ГФО financial statements from ТР. **Mechanism already proven.**

`reference_tr_gfo_documents` records the route (`/CR/api/Documents/{ActID}` → PDF, код 18000 =
revenue); `scripts/nzok/write_hospital_revenue.ts` uses it for private hospitals and it has
never been generalised. Per-EIK per-year turnover / equity / employees gives the
financial-capacity test, the shell-winner detector ("won €X against €Y of turnover"), and a
real denominator for `company_public_money`. Restrict to EIKs with contracts to keep it finite.

### P4 — АОП register of external experts (чл. 229, ал. 1, т. 17 ЗОП).

The state's public list of experts available to run procedures. Zero references in the repo.
Small, exact; joined to T2.4's procurement officers it makes "the same expert wrote the
documentation and sat on the committee" a query rather than an investigation.

### P5 — BULSTAT ДЗЗД / consortium registry.

We infer composition from contract rows (migration 087) and it works — the Зад канала winner is
correctly a two-member Д&Д + Мулти Строй Комерс consortium. What we cannot do is **name** it
(„Театрал" and „Примо Град" do not exist in our data) or say who filed it. BULSTAT carries the
name, the filer and the members, turning a repeated anonymous "Обединение: A, B" into a named
recurring vehicle.

### P6 — Действителни собственици (beneficial owners, ЗМИП).

`tr_person_roles` carries officers and shareholders of record; the ЗМИП filings are separate
and we hold none. This is the layer under `person_role` that `/connections` is missing.

### P7 — АДФИ inspections + Сметна палата audit reports.

Both publish findings on procurement legality. We already crawl `bulnao.government.bg`
(`smetna_palata` watcher), so the access pattern is familiar; audit reports are a separate
register. АДФИ is the body ACF says it will refer this case to — "has this buyer ever been
inspected, with what finding" is a cheap, strong column on `/awarder/:eik`.

### P8 — Subcontractors (подизпълнители).

Declared in ЦАИС ЕОП, partially surfaced in `ProjectFileScreen`, not a corpus-wide table. The
money on a contract is not the money that reaches the work.

### P9 — ИСУН нередности / financial corrections.

Which EU-funded contracts were later corrected or recovered. Joins to `fund_projects` and
`contracts` and is the **only outcome signal in the whole funds corpus** — it pairs directly
with the §1.6 spine: grant → contract → _and whether it was clawed back_.

### P10 — TED (Tenders Electronic Daily).

Identified in `tender-dossier-ingest-v1.md` §9.4 as an open bulk alternative for the
EU-threshold subset. Cross-check for above-threshold completeness plus EU comparators.

**Cross-cutting requirement for every one of P1–P10:** a watcher in `state/watch/`, a
`db:load:<x>:pg:cloud` command, a `recent_updates` changelog row, an entry in the Data Map, and
a line in the relevant watch skill — per `reference_migrated_family_watch_reload`, a migrated
family without a cloud loader goes stale on prod with every row count reconciling.

---

## 3. Sequencing

ⓐ Re-scoped by the audit: **step 0 is new** (nothing can be built against undeclared sets),
**step 2 shrank** (the filter exists — §1.3), and **step 2b is new** (the contractors
destination has to be decided before Band 2 can be drawn).

| Step     | Contents                                                                                                                                                                                              | Depends on  |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| **ⓐ 0**  | **T0.0** — publish the four matching definitions, re-derive §0, pin each number in a test                                                                                                             | —           |
| **ⓐ 1**  | **T0.6** (what the universe IS) → T0.1–T0.5 (register, seat, gate)                                                                                                                                    | 0           |
| **ⓐ 2**  | A `culture` entry in `SECTOR_BROWSE_PACKS` + the `role` split + the data/component split of that module + `?sector` on the funds/subsidies browsers. **Not** a new registry, **not** a new URL param. | 1           |
| **ⓐ 2b** | Decide `/procurement/contractors?sector=` (§1.3-B) — recommended: re-point to `/culture/procurement#contractors`                                                                                      | 1           |
| **3**    | T2.1–T2.2 (`declaration.employer` + resolution) — parallel, no external source                                                                                                                        | —           |
| **4**    | T1.6a–c (grant→contract lineage + coverage route)                                                                                                                                                     | —           |
| **ⓐ 5**  | The hub: routes, registry, scenes, finder (§1.7–1.8) + the **prerender/sitemap/llms five-file move** + the per-sub-page `ScopeSupport` + the `CultureSearchBox` fork decision                         | 1, 2, 2b, 4 |
| **ⓐ 5b** | The hub blob as a `db:gen-*` generator: `REFRESH_GENERATORS` + a chain slot **after `db:load:interreg:pg`**                                                                                           | 5           |
| **6**    | `/culture/procurement` + `/culture/funds` + `/culture/institutions` bodies                                                                                                                            | 5           |
| **7**    | T2.3–T2.4 (directors, procurement officers)                                                                                                                                                           | 3, 6        |
| **8**    | P1 (full dossier crawl) — operator decision                                                                                                                                                           | —           |
| **9**    | T3.1 ДКИ register, re-run step 1's gate                                                                                                                                                               | 8 optional  |
| **10**   | P2, P3 — the two that change what procurement can assert                                                                                                                                              | —           |
| **11**   | P4–P10, each with its watcher + cloud loader                                                                                                                                                          | —           |
| **12**   | **Write the `sector-dashboard` skill** (Part 3)                                                                                                                                                       | 0–7 shipped |

Steps 0–7 need **no new external source**. Everything is already on disk or in Postgres.

---

# Part 3 — LAST STEP: write the `sector-dashboard` skill

**Do this after steps 1–7 have shipped, not before.** The skill's value is the defect list,
and a defect list written from a plan rather than from what actually broke is advice. The
`dashboard-hub` skill says this about itself: every section exists because something shipped
wrong once, and the value is in the reason being concrete.

## 3.1 Why it needs to exist

There are **~20 sector surfaces** and they were each built by hand:

- 14 generic `/sector/<key>` dashboards (`sectorDashboards.ts`): tourism, health, roads,
  transport, regional, social, revenue, customs, administration, edu, agri, energy, security,
  environment
- 6 bespoke views: `/culture`, `/judiciary`, `/defense`, `/pensions`, water, `/subsidies`
- **ⓐ 18** browse packs in `SECTOR_BROWSE_PACKS` (`sectorPacks.tsx`): water, roads, noi, nzok,
  agri, judiciary, defense, security, revenue, customs, edu, transport, social, environment,
  regional, administration, energy, tourism — ⓐ the draft said "6" and then listed 9, and
  named `Kultura`, **which is not among them**. Culture having no browse pack is the whole of
  §1.3's remaining contracts/tenders work.

`dashboard-hub` covers the tile grid and `docs/testing-standards.md` the tests. **Nothing
covers the sector layer**: the EIK register, the four-corpus union, the coverage declarations,
the risk/competition baselines, the buyer↔beneficiary role split. This plan had to rediscover
every one of them, and three were found only by measuring.

⚠️ **ⓐ And the strongest argument for the skill is that this plan got the inventory wrong.**
The draft proposed building a sector-EIK registry and a `?sector` param that already existed
across 18 sectors, and mis-stated the pack count by 3× — while being the document arguing that
the sector layer is undocumented. That is the finding: **the layer is not merely undocumented,
it is undiscoverable enough that a careful plan re-specified it from scratch.** §3.2 gains a
rule from it — see K.

## 3.2 What it must carry — the findings, with their evidence

Each of these is a rule _plus_ the measurement that produced it. That pairing is the skill's
whole value.

**A. The EIK register is the foundation, and it silently under-covers.**
Culture's frozen 21-EIK allowlist covered **66% of its own sector's money** (€146m of €219.7m)
and omitted its largest single buyer. Rule: three explicit lists (in / verify / excluded), a
gate enumerating candidates by regex and failing on any unclassified buyer above a money
floor, and a `role` column because the same EIK is a buyer in one corpus and a beneficiary in
another.

**B. Name regexes produce sector-scale false positives.** „култур" over `agri_subsidies`
returns €166.3m; the truth is €18.3m — the rest is „полски **култури**". **ⓑ** „**опера**"
pulls ЕСО, ДАТО and жандармерия into a culture query — the stem is `опера`, not „операц", and
the distinction is the point: „операц" would be an EXCLUSION term, while `опера` is the
INCLUDE term that needs one. **A rule stated with the wrong stem cannot be applied.** Rule: every regex ships with its exclusion list and
a test asserting the exclusion **changes the number**; `EXCLUDED_EIKS` documents each
false match so a later sweep cannot re-admit it.

**C. Every headline needs its baseline, or it asserts something false.** Culture single-bid is
**ⓐ 40.0%** against a national **40.9%** — typical. Shown alone it reads as an indictment. Rule:
a sector rate renders beside the national rate from the same query, and the skill names this
as the sector-dashboard instance of the hub skill's "arithmetically right, false as a
sentence" class.

**D. One question, several corpora, several bases.** Culture money is ⓐ **seven** streams on
five bases spanning €11.0m to ⓑ €269.1m — the plan says „six" in two places and lists seven in
the table; the count is seven. Rule: follow migration 127's canonical four-arm union, put
the basis in the label not the footnote, and never sum across bases.

**E. Coverage is a first-class field.** Only **ⓑ 18%** (37 of 202) of Bulgarian partner rows on
culture-themed Interreg operations carry an EIK, so an EIK-keyed filter answers under a fifth
of the question at a 200. `tender_search_text` is the precedent: **0.78%** coverage behind a live search. Rule: a
corpus arm returns its own coverage and the surface states it — the pattern is
`/api/db/tender-search-coverage`.

**F. Two questions that look like one.** "Culture bodies doing Interreg" (€11.0m) vs "Interreg
culture money reaching Bulgaria" (ⓑ €48.8m): ~4.4x apart, different join, different partner
population. Rule: a thematic arm joins through the operation, an institutional arm through the
beneficiary set, and a surface picks one and labels it.

**ⓐ F2. A flow and a stock are not comparable, and RANKING them is the tell.** Culture's seven
streams span a **per-year** budget line (€269.1m/yr) and **cumulative** corpora spanning 12–15
years — plus two (ИСУН, Interreg) that carry no usable date at all. Sorted by magnitude the list
says „EU money is 1.8× the national culture budget"; on a common window it is roughly the
inverse. Rule: **normalise to a window or drop the ranking.** A basis in `metricSecondary` does
not repair an order, because the order is read first. Corollary: before a sector list is sorted,
each row declares its window, and any row that cannot be windowed leaves the sorted set.

**G. The people layer is where sector dashboards stop.** Every sector has directors who file
declarations and procurement officers who run its tenders, and none of them are linked to
their institution because `declaration.institution` is a group label. Rule: use
`declaration.employer` (T2.1) and the confidence bar; never assert a name match as identity.

**H. The money spine generalises.** Grant → institution → procedure → contract → contractor →
owner, at **98.9%** ПИИ-code join coverage. Rule: it is a shared `src/ux/` object, not a
per-sector chart.

**I. Sector-specific risk needs a peer group.** `nearCeilingAward` looks damning at €0.29 under
a €454,611.59 ceiling and turns out to be _common_ for small buyers — six of eight ACF
procedures sat at 98.8–100%. Rule: score against a sector/size peer group, publish the base
rate beside the flag, and word every signal „за проверка".

**J. Deployment.** Every sector table needs a `db:load:*:pg:cloud`, a watcher, a
`recent_updates` row and a Data Map entry, per `reference_migrated_family_watch_reload`.
`REFRESH_GENERATORS`/`ORDER_PAIRS` membership for anything derived. **ⓐ And a sector's hub blob
is a `db:gen-*` artifact whose chain slot must sit after its LAST input** — the culture blob's
inputs end at `db:load:interreg:pg`, forty steps past where the existing two generators sit.
Membership alone cannot catch a wrong slot; only an `ORDER_PAIRS` entry can.

**ⓐ K. Inventory the layer before extending it — the layer is undiscoverable.** This plan
proposed building a `SECTOR_EIKS` registry and a `?sector=` URL param that **already existed
across 18 sectors**, and mis-counted the browse packs 6-vs-18. Not from carelessness: the
registry lives in a `.tsx` under `screens/components/procurement/`, the param is read in two
`screens/dev/*` browsers, the config that ties them together is in `screens/sector/`, and
nothing names the mechanism in one place. Rule: **the skill opens with the inventory** — where
the EIK registry lives, which params exist, which browsers read them, which surfaces are packs
vs bespoke — and a retrofit starts by reading it, not by grepping. A sector layer whose own
plan re-specifies it from scratch is the strongest evidence the skill is needed at all.

**ⓑ M. A name matcher fails in TWO directions, and only one of them is visible.**
Too WIDE inflates a figure: `опера`→оператор put the national grid operator's €189m into
"EU money to culture", and a base rate that looks absurd eventually catches it. Too NARROW
deflates it and is caught by **nothing** — `театр` cannot match „театър" (Bulgarian drops the
`ъ` only in the plural and the adjective), so 24 theatres and €14.6m vanished while nine
adjectival rows kept every count non-zero and every test green. The deflated number is the one
that reads as careful. Rule: **for each stem, run both checks — what else does it match, and
does it survive the singular** — and pin the answer with an AGREEMENT assertion against an
independent register (here: every curated `STATE_CULTURE_INSTITUTE_EIKS` member with a row in
the matched corpus must be admitted). No count-based or base-rate assertion can substitute:
both defects above left every count plausible.

Corollary for the whole family of Slavic-language matchers this repo runs: a stem lifted from
an adjective is a false-negative generator wherever a fugitive vowel exists (театър/театри,
ансамбъл/ансамбли, кинотеатър/кинотеатри). Write the stem short enough to survive the vowel,
then check what else it catches.

**ⓐ L. Not every surface can take the filter — check the precompute's dimensions first.**
`?sector` is a predicate on the BUYER; `contractor_rank` (122) aggregates CONTRACTORS and has no
buyer dimension, so `/procurement/contractors?sector=` has nothing to filter on and adding a
dimension re-opens the resource's existing rollup-bucket double-count. Rule: before a hub links
a filtered destination, confirm the destination's **base relation carries the filtered
dimension** — a precomputed leaderboard usually does not, and the failure is a tile whose link
quietly ignores its own filter.

## 3.3 Shape

`.claude/skills/sector-dashboard/SKILL.md`, sibling to `dashboard-hub` and **explicitly
deferring to it** for the tile grid, bands, scenes, accents, search and gates — this skill owns
the _data layer under_ a sector surface, not the layout. Sections mirroring the house style:
§0 measure the register first · §1 the EIK register and its gate · §2 the four-corpus union ·
§3 baselines and bases · §4 coverage declarations · §5 the people layer · §6 the money spine ·
§7 sector risk · §8 deploy · §9 gates · §10 keeping it current.

It should carry a **retrofit checklist** so it can be run against an existing dashboard, and
the first three retrofits are the test of whether it is any good: `/judiciary`, `/defense`,
`/sector/energy`. If running the checklist on those three surfaces produces no findings, the
skill is a description rather than a tool and should be cut back to the parts that did.

**Open:** whether the 14 generic `/sector/<key>` dashboards should converge on the hub pattern
too, or stay a distinct, lighter shape. Decide from the retrofits, not in advance.

## 4. Gates to write (hub skill §8)

- Every culture buyer above a money floor is in exactly one declared list — ⓐ **four** lists
  (`CULTURE_GROUP_EIKS`, `VERIFY_PRINCIPAL_EIKS`, `EXCLUDED_EIKS`, читалища), not three.
- Every tile id has a scene; every `to` is absolute and in the routed list; every sub-page is a
  hub destination; no accent repeats.
- **ⓐ Every `#anchor` a tile emits exists as a section id on its destination page.** Seven are
  emitted; none is currently checked, and a dead anchor is a silent 200.
- **ⓐ The hub blob is in `REFRESH_GENERATORS` and its `db:refresh` slot is after every table it
  reads** (an `ORDER_PAIRS` entry, at minimum vs `db:load:interreg:pg`). It is under its byte
  budget. It writes nothing on a missing input rather than writing a partial.
- The single-bid tile renders the national baseline, both numbers from one query, baseline not
  hard-coded.
- Every figure recomputed from its declared basis, with the **rejected** bases asserted as
  `notEqual` (ⓐ 179/677 = 26.4% is one word away from 179/447 = 40.0%).
- **ⓐ Every §0 figure is derived by calling T0.0's exported matchers** — no figure in the plan,
  a tile or a caption may come from a query that exists only in someone's shell history. The
  four that had none: ИСУН €474.3m, ДФЗ €18.3m, Interreg thematic, Tier A. **ⓑ Shipped** as
  `src/lib/cultureMatch.ts` + `scripts/db/tests/culture_match.data.test.ts` (9 tests).
- Every `?sector` value a tile emits is read by its destination; every see-all param likewise.
  ⓐ Assert it against the **actual reader** (`getSectorBrowsePack` + the browser screens), and
  include `/culture/procurement#contractors` once §1.3-B is settled.
- The `култури` exclusion **changes** the agri number (€166.3m → €18.3m) — a guard that does
  not move the figure it guards is a guard nobody will keep.
- **ⓐ The same, for the Interreg thematic regex**: the anchored form must differ from the
  unanchored one (**ⓑ** 302 → 202 rows, €67.0m → €48.8m), **and so must its own exclusion
  list** (227 → 202 rows, €52.8m → €48.8m — the `-culture` agronomy compounds). Every free-text
  sector matcher ships with both tests, not just the agri one. **ⓑ Shipped** — 16 tests, and
  four mutations verified to fire: neutering `CULTURE_NAME_EXCLUDE` fails 4, dropping the
  Interreg exclusions fails 4, reverting `теат`→`театр` fails 4, un-anchoring `art` fails 3.
- **ⓑ A tolerance band must be NARROWER than the guard it sits over.** The first cut used ±25%
  while the ИСУН guard moves the figure 15.9%, so the figure test could not have seen that
  guard removed — the number would have moved inside its own band. The band is now 5%, derived
  from the smallest guard effect (Interreg, 7.6%), and a test asserts that relationship so
  widening the band fails instead of silently weakening every figure assertion.
- **ⓑ A name matcher must AGREE with the curated register.** Every `STATE_CULTURE_INSTITUTE_EIKS`
  member with a row in a name-matched corpus must be admitted by the matcher. This is the only
  assertion in the file that can catch a FALSE NEGATIVE — see rule M.
- Every corpus arm returns its own coverage, and no surface renders an EIK-keyed Interreg
  figure without it (ⓑ 18%).
- **ⓐ No sorted money list mixes a per-year flow with a cumulative stock** — each row declares
  its window, and a row without one is out of the sorted set (§3.2-F2).
- `sector_eik.role` is honoured: no buyer set is joined to a beneficiary corpus.
- **ⓐ The `awarder-group-model` call site asserts its EIK set is ≤ 300** — the route
  `slice(0,300)`s silently, and the culture universe plus Tier E plus T3.1's ДКИ is ~289.
- A scoped search source returns out-of-scope rows for a query that has them — the test that
  catches scope silently filtering.
- Each search group's cap is independent.
- `declaration.employer`: distinct-value count and unresolved share reported; the loader
  refuses to publish a resolution below its confidence bar.
- `grant_contract_link`: coverage published, and no link presented above its stored confidence.
- **Then break each gate's clauses and watch them fire** (hub skill §8).

## 5. Open questions

ⓐ Q8–Q11 are new, and **Q8 blocks step 1 while Q9 blocks Band 2** — neither can be deferred to
implementation the way the rest can.

1. **SEO** (§1.7) — moving the film dashboard off `/culture` to `/culture/subsidies`. Needs a
   redirect decision if anything links the old anchors, and prerender entries for four new
   sub-pages. ⓐ Plus the five-file move listed in §1.7 — the `cultureFacts` build-time read is
   the one that fails quietly.
2. **T0.5** — читалища in or out. Recommend a labelled sub-group.
3. **P1** — authorisation to run the full dossier crawl (**~26 h**, not the ~1.4 h this line
   used to carry — see P1 — against a shared public register). Probe re-run 2026-08-19: the
   surface is fully open, 0 failures in 3,240 calls, no throttling.
4. **§1.9-6** — `nearCeilingAward` needs a measured base rate before it can be called a signal.
5. **T3.3** — the 9b conflict-flag policy sign-off is still outstanding from the v1 plan.
6. **ⓓ §1.3 — ANSWERED by measurement, 2026-08-18: ДФЗ does NOT enter the sector EIK registry.**
   `agri_subsidies ∩ CULTURE_GROUP_EIKS` is **0 rows** — no state cultural institution has ever
   received a farm subsidy — while ИСУН is 40 rows / €94.1m. So an EIK-keyed `?sector=culture`
   on `/subsidies` would render an EMPTY table, which reads as „culture received no subsidies"
   against a truth of €18.3m paid to народни читалища. The ДФЗ arm stays a NAME rule
   (`chitalishteNameSql`), and `sector_beneficiary_reach.data.test.ts` fails if that inverts.
7. **Part 3** — whether the 14 generic `/sector/<key>` dashboards converge on the hub pattern.
   Decide from the three retrofits, not in advance.
8. **ⓐ T0.6 — what "the culture universe" IS**: principal = МК (~€188m, Tier D stays out, the
   register's own design honoured), or everything a reader calls culture (~€220m, Tier D and
   the МО museums in, `EXCLUDED_EIKS.principal` demoted to a label). **Blocks step 1** — the
   register gate, the headline and §3.2-A all read the answer.
9. **ⓐ §1.3-B — the contractors destination**: new precompute dimension on 122, live aggregate
   for the sector case, or re-point to `/culture/procurement#contractors` (recommended).
   **Blocks the Band 2 headline tile and finder subject 3.**
10. **ⓐ §1.8 — the search fork**: does `CultureSearchBox` / `SectorEntitySearch` die on this
    page in favour of `HubSearch`, and does that make culture the only sector surface on the
    other mechanism? This is a Part-3 question arriving early.
11. **ⓐ §1.7 — which culture headline is canonical.** `sector_stats.json` publishes
    `culture: basis "budget", €269,051,700` for `/governance/sectors`. The hub will publish a
    different number. Decide which one is the sector's figure, and make the other cite it.
