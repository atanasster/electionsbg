# EU-funds dashboard as a modular magazine front page — v1

Status: **research + proposal**, not an implementation plan. Drafted 2026-08-05.

Two inputs:
1. A crawl of the Facebook group **„Европейски програми и проекти"** (113.2K members,
   public) for 2026, systematising what its users actually ask.
2. [module-front-pages-v1.md](module-front-pages-v1.md) — the five-band module template
   ("view → module → sub-module → record", stock/flow/change tiles, look-up beats read).

Companions: [funds-seo-geo-v1.md](funds-seo-geo-v1.md) (the procedure grain, already
shipped), [governance-hub-v1.md](governance-hub-v1.md) (the tile kit).

---

## 1. The crawl — method and its limits

**Read this before trusting any number below.**

`facebook.com/groups/1129398573897982` is public but the **discussion feed will not
paginate for a non-member** — Facebook renders 1–2 posts, then serves skeleton
placeholders that never resolve, on both `?sorting_setting=CHRONOLOGICAL` and the default
sort, with every GraphQL call returning 200. So a chronological census of 2026 was not
obtainable.

What worked: **in-group search with `Date posted = 2026`**, which is exposed as a URL
filter and renders fine. 16 queries were run across the vocabulary of the domain
(`финансиране`, `млад фермер`, `саниране`, `одобрен`, `отказ`, `къща за гости`,
`стартиращ бизнес`, `дигитализация`, `ИСУН`, `община проект`, `предстоящи приеми`,
`кой е получил`, `класиране`, `консултант`, `иновации`, `усвоени средства`, `МИГ`,
`ТЕЛК`, `измама`).

Yield: **~56 distinct 2026 posts — ~47 questions and ~9 supply-side posts.**

Three limits, stated so nobody over-reads the percentages:

- **Facebook caps group search at ~5 results per query.** The counts below are of *distinct
  posts surfaced*, not of group volume.
- **Ranking is recency-biased.** Most decoded timestamps were hours or days old, so this is
  effectively a snapshot of *recent* 2026, not of January–August evenly.
- **Query-set bias is real but bounded.** The vocabulary was chosen to span both demand
  ("is there a programme for X") and accountability ("who got the money"), precisely so the
  §3 negative finding could not be an artefact of what I searched for.

Treated as a **qualitative taxonomy with indicative weights**, it is sound. Treated as a
census, it is not.

---

## 2. The taxonomy of what users ask

Categories overlap (one post can be A + C). Percentages are of the ~47 question posts.

| # | Category | n | share | Can our data answer it? |
|---|---|---|---|---|
| **A** | **"Има ли програма за X?"** — discovery by activity/sector | **32** | **~68%** | **Not as asked. Adjacently, yes — and uniquely.** |
| **C** | "Кой може да ми помогне / препоръчайте консултант" | 10 | ~21% | Partly, and carefully |
| **B** | Eligibility mechanics (org form, timing, bars) | 7 | ~15% | As an empirical proxy, yes |
| **E** | "Има ли одобрени?" — base rates / social proof | 4 | ~9% | **Yes, fully. Nobody publishes this.** |
| **F** | "Има ли въобще списък?" — navigation failure | 3 | ~6% | Yes for awarded; no for open calls |
| **D** | "Реални ли са тези цифри?" — price/trust | 1–2 | ~3% | Convertible to arithmetic |
| **G** | **"Кой получи парите?"** — accountability | **0** | **0%** | Yes — and nobody asked |

### A — "Има ли програма за X?" (the overwhelming majority)

The long tail is the point. Verbatim subjects, 2026:

> туристическа агенция (дигитализация, маркетинг, техника, обучение, разширяване) ·
> къща за гости (×3, incl. довършителни на груб строеж: саниране, термопомпа, солари) ·
> саниране на еднофамилна къща / Декарбонизация (×4) · енергийна ефективност на
> еднофамилни къщи, София · дигитализация на строителна фирма (наемане на ИТ
> подизпълнител) · „нещо като Индустрия 4.0 през 2026" — CNC, лазери · внедряване на AI ·
> млад фермер (×3, incl. „за цветя") · новосъздадени/„новоизлюпени" земеделски
> производители (×2) · 700–800 m² трева, дипломиран агроном · фотоволтаици за продажба на
> ел. енергия (микро фирма, собствени парцели, Ст. Загора) · изкопна извозваща дейност,
> Ямбол (багер, самосвал) · кредитно посредничество (наем, ток, интернет, оборудване) ·
> хранителни продукти, оборот 15 000 €/мес., собствено хале 300–500 m² · микро предприятие
> в Западна България (Перник/Кюстендил/Благоевград), райони в преход · смесен магазин —
> наемане на работници над 55 г. · младежка заетост (×2) · специализирано почистване и
> пожаробезопасност · млади дизайнери с рециклирани материали · частна галерия/арт център в
> малък областен град · ремонт на читалище в малко населено място · детски
> културно-развлекателни центрове извън урбанизирани места · хора с ТЕЛK (×4, АХУ) ·
> „Избирам България" Компонент 1 · автосервиз, В. Търновска област

Every one is **(activity or asset) × (place) × (org form)** — and every one is answered
today by a human in the comments, or not at all.

### E — the base-rate questions, verbatim

> „Някой кандидаствал ли е? Удобрен ли е бил?" ·
> „Има ли одобрени по тази програма в групата?" ·
> „Има ли някой кандидатствал по Избирам България — Компонент 1 и да е бил одобрен?" ·
> „Срещал съм познати, които са печелили такъв проект, но нямам идея какъв точно е процеса"

These are **statistical questions asked socially**, because no statistical answer exists
anywhere. This is the single cleanest fit to a corpus of 81,910 awarded contracts.

### F — the navigation failure, verbatim

> „**Има ли въобще списък какви програми се предлагат?** — Защото тук чета от бизнес с
> чушкопеци до баничарници на Луната?"

> „Къде да отида да попитам? Кои са фирмите, които могат да ми съдействат? Какви са
> правилата? **Къде мога да намеря точна информация и разяснение по този казус?**
> Никога не съм ползвал такива програми и съм много невеж."

> „…от ИСУН не ми пратиха повече информация за развитие на райони в преход."

A 113K-member group exists because the official registers are unnavigable. That is the
demand-side statement of our own opportunity.

### D — the trust question, verbatim

> „Обърнах се към фирма, която ще ми съдейства. **Поискаха ми първоначално 4000 €,
> платими на два пъти, и ако бъда одобрен — 5% от сумата. Това реални цифри ли са?**"

Note the supply side answering it in the same group: „Цената се заплаща **преди**
спечелването на проекта, а не след това." An information asymmetry with no reference price.

### G — the finding that reframes the whole dashboard

**Not one post in the 2026 sample asks who received EU money, how much a municipality
absorbed, whether an MP's company was a beneficiary, or whether anything was misspent.**
`усвоени средства` returned no exact-match post at all. `измама` returned one — a
consultant's own ad.

### The supply side (~9 posts) — competitive context

- The **group admin** (Галя Менова) launched **Konsultiram.eu**, an AI pre-eligibility
  scorer, pitched on exactly the three questions above: *„Допустим ли е кандидатът? Какъв
  резултат би могла да постигне фирмата при оценяването? Има ли реален шанс проектът да
  бъде финансиран?"* The group's own owner has already productised category A+B.
- Consultancies post scheme announcements as marketing (HumanConsulting on the
  Стратегически план 2023–2027 preprocessing measure; Astra Solutions on МИГ innovation,
  „до 102 500 евро… до 75%").
- A lawyer posts ЗОП/ЗУСЕСФУ explainers (методика за оценка, „професионална
  компетентност", финансова корекция).
- **A member built a free monitor of „13+ официални сайта за EU програми и обществени
  поръчки — ИСУН, ЦАИС ЕОП, ДФЗ"** (`tools.gdprcheck.bg`) with e-mail alerts. Somebody is
  already building the alerting layer adjacent to us.

---

## 3. The mismatch, and the honest boundary

**Their demand is forward-looking and personal — „can *I* get money?"
Our `/funds` dashboard is backward-looking and institutional — „who *got* money."**

And the boundary is hard, not a matter of effort:

> **We ingest ИСУН's *awarded* registers only.** `scripts/watch/sources/isun_eu_funds*.ts`
> fingerprints the Beneficiary rollup and the Project register — one row per organisation,
> one row per **signed contract**. There is **no open-calls feed anywhere in the repo**
> (`grep` for open-call/otvoreni/opportunities across `scripts/funds/` and
> `src/data/funds/` returns nothing).

So we cannot answer „отворена ли е програмата" or „кога е следващият прием", which is the
literal form of ~68% of the questions. Two responses, and only one of them is honest:

- ❌ Build a calls calendar off a source we don't ingest, or infer „open" from contract
  dates. That manufactures a deadline, which is the worst possible error class on this page.
- ✅ **Answer the question behind the question.** Nobody asking „има ли програма за къща за
  гости" wants a legal citation. They want to know *whether this kind of thing gets funded,
  by whom, for how much, and what the odds are.* That is a query over 81,910 awarded
  contracts — and we are the only ones holding it in structured form.

Then say plainly, on the page, that ИСУН is a register of **signed contracts, not of open
calls**, and link out to the official call registers. That sentence is a feature: it is the
thing the group cannot supply and consultancies have no incentive to say.

### Six answerable reframings

| They ask | We answer, from data we hold |
|---|---|
| „Има ли програма за X?" (A) | „**Финансирано ли е нещо като X** — N договора, кои процедури, кои фирми, какви суми" — full-text over contract titles × org form × place |
| „Има ли одобрени?" (E) | **Base rates per procedure**: beneficiaries, median grant, status mix (приключен / прекратен), disbursement rate |
| „Трябва ли ми фирма?" (B) | **Org-form mix of actual winners** per procedure — „96% ЕООД/ООД, 3% ЕТ, 0 физически лица". An empirical eligibility proxy, labelled as such |
| „4000 € + 5% реални ли са?" (D) | **Median grant per procedure** → „5% от медианния грант тук = €X". Turns an unanswerable trust question into arithmetic |
| „Кой може да ми помогне?" (C) | **Peers, not consultants**: who in *my* obshtina already won under this procedure. Named organisations only — see §6 |
| Place-bound asks: Ямбол, Бургас, В. Търново, Перник/Кюстендил/Благоевград, „малко населено място" | Per-muni and per-EKATTE attribution + per-capita rank, already in `muni-map.json` |

---

## 4. What `/funds` is today, against the template

`src/screens/FundsScreen.tsx` is the exact object [module-front-pages-v1.md](module-front-pages-v1.md)
§1 diagnoses, with one extra problem.

| Template band | `/funds` today |
|---|---|
| 0 Wire | **absent** |
| 1 Lead | 4 KPI cards — *an aggregate, i.e. analysis-first* |
| 2 News rail | **absent** |
| 3 Explore — core | **absent as a band.** No search box anywhere on the page |
| 4 Explore — more | 7 `DashboardSection`s in array order: Spending → RRF → Red flags → Focus → Dual-corpus → Leaderboards → Details |
| 5 For you | **absent** |
| 6 Data & method | one-line `SourceFooter` ✅ |

Three specific failures:

1. **Look-up is impossible.** The ranking rule is *search a record > my thing > ranked list
   > risk view > analytical dashboard*. `/funds` opens with the dashboard and never offers
   the search. A visitor arriving from any category-A question has nothing to type into.
2. **The order is arbitrary.** „Red flags" and „Focus stories" outrank the leaderboards and
   the place split — i.e. the accountability framing nobody asked for outranks the look-up
   everybody asked for. Note this is *not* an argument to delete the accountability tiles
   (§6); it is an argument about which band they sit in.
3. **Every number is all-time and static.** `absorption`, `eikPct` and the four KPIs are
   the same today as last month. There is no reason to return.

---

## 5. Proposal — the `/funds` front page, in bands

Same five-band template, so the layout is learnable once and reused across modules. New
work is bands 0–2, 5, and the **core** half of 3.

### Band 0 — Wire (one line, no heading)

`обновено 31 юли · N нови договора · €X новоподписани · последен прием: <programme>` →
`/data/updates`.

Cheap and honest: `fund_payloads` already carries the ingest stamp, and
`isun_eu_funds_projects` already fingerprints contract count + summed amounts, so the delta
is a subtraction, not a new pipeline. **Reuse `recent_updates`' backfill-suppression rule**
(module-front-pages §2.2) — an ИСУН re-pack must not read as 40,000 new contracts.

### Band 1 — Lead: **„Финансирано ли е нещо като моето?"**

One full-width search, three inputs, one answer. This *is* the deliverable.

```
┌─────────────────────────────────────────────────────────────────┐
│  Финансирано ли е нещо като моето?                              │
│  [ дейност или актив: „къща за гости"        ] [община ▾] [форма ▾]│
│                                                                  │
│  → 412 договора · €38,4 млн. · медиана €62 100                    │
│    водещи процедури: BG16RFOP002-2.010 (188) · BG06RDNP001-6.4 (91)│
│    в община Бургас: 7 договора · €1,1 млн.                        │
│    форма на печелившите: 91% ЕООД/ООД · 6% ЕТ · 0 физически лица  │
│    статус: 74% приключени · 19% в изпълнение · 7% прекратени       │
│                                                                  │
│  ⚠ ИСУН е регистър на подписани договори, не на отворени приеми.  │
└─────────────────────────────────────────────────────────────────┘
```

Every figure comes from fields we already hold: `title`, `orgForm`, `status`, `totalEur`,
`grantEur`, `location.{ekatte,munis}` on `FundsProjectsContractFile`, aggregated at the
procedure grain that `funds-seo-geo-v1.md` T1 already shipped.

**This single module answers categories A, B, E and F at once**, and it is the module the
group's own admin has productised as a paid AI service.

### Band 2 — News rail (3–4 `NewsCard`s)

| Card | Source | Feasibility |
|---|---|---|
| Най-големи нови договори | `contracts` by `first_seen`, event date shown | A |
| Процедури, приключили наскоро | status transitions per procedure | B |
| Къде отидоха парите този месец | top obshtinas by newly-signed | B |
| Най-нисък процент изплатени | `paidEur/contractedEur` per programme | A |

Carry module-front-pages §2.1 verbatim: **the card shows the event date, the kicker shows
the publication week.** They are different facts and both are true.

### Band 3 — Explore, core (look-up first)

`Търси договори` · `Бенефициенти` · `По процедура` · `По място`

`/funds/procedure/:code` exists but is reachable only by guessing a code. Promote it: it is
the grain the whole taxonomy lives at.

### Band 4 — Explore, more (today's page, demoted intact)

`Обзор и абсорбция` · `Свързани лица` · `Интегритет` · `Възстановяване (RRF)` ·
`Договори и грантове` · `Фокус` · `Детайли`

### Band 5 — За теб

`Моята община` (reuse the My-Area place resolution) · `Моят сектор` · `Следя тази процедура`

### Band 6 — Данни и метод

Expand the one-liner: what ИСУН covers, what it does **not** (open calls), the
`muni-share-even-split` attribution caveat already in `FundsProjectsMuniMapFile.basis`, and
the ingest date.

### Tile grammar — stock · flow · change

Apply module-front-pages §4 to the funds tiles. Each is one extra field in the existing
offline generator; no live query.

| Tile | stock | flow | change |
|---|---|---|---|
| Договори | 81 910 | €43 млрд. · медиана €X | +N нови този месец |
| Бенефициенти | ~30 000 | €X към топ 10 (=Y%) | +N нови |
| Процедури | 2 137 | €X по 10-те най-големи | N приключили |
| По място | 265 общини | €X на жител, медиана | — |
| Свързани лица | `cr.mpCount` | €X договорени | +N нови връзки |
| Интегритет | N сигнала | €X засегната стойност | +N нови |

---

## 6. Editorial rules (non-negotiable)

Four rules, three inherited from module-front-pages §7 and one specific to this corpus.

1. **„Сигнал" ≠ „нарушение."** Inherited. Every integrity item says *сигнал* and links to
   methodology. `reference_risk_score_circularity` is the scar tissue.
2. **Event date, not ingest date.** Inherited.
3. **Backfill suppression.** Inherited — reuse `recent_updates`' rule, never re-derive it.
4. **A beneficiary is not a suspect, and „peers" must not become a directory.** Category C
   („препоръчайте консултант") is the one reframing that can go wrong. Showing *„7 фирми в
   община Бургас са получили по тази процедура"* with names is publishing a fact from a
   public register. Framing the same list as *„обърнете се към тях"* is building a lead-gen
   product on named private companies without consent. Ship the fact; do not ship the
   solicitation.

Note also that categories D and G together are a strategic point about **tone**: the
audience arrives wanting *help*, not exposure. Demoting the accountability tiles to band 4
is right. Deleting them is not — they are the reason the corpus is trustworthy, and the
`/funds/political` + `/funds/integrity` pages are what distinguish us from a consultancy
blog. The insight is about *ordering*, not about content.

---

## 7. Phasing

| Phase | Scope | New data? | Why here |
|---|---|---|---|
| **0** | Band 3 core (`Търси договори` + promote `/funds/procedure/:code`); reorder bands 3/4; `blurb` + `stats` + `delta` on the funds tiles | none | Highest gain per line changed; makes look-up possible at all |
| **1** | **Band 1 — the „Финансирано ли е нещо като моето?" resolver** | one `fund_payloads` kind: activity × place × org-form rollup at procedure grain | The module that answers 4 of 7 categories. Deserves its own phase |
| **2** | Band 0 wire + Band 2 rail | 2 feed kinds | Gives the page a reason to be reopened |
| **3** | Band 5 За теб (моята община / следя процедура) | reuse My-Area | Personalisation only pays once 1–2 exist |
| **4** | Base-rate card on every `/funds/procedure/:code` + median-grant reference price | derived from phase 1 | Also the strongest AIO/GEO asset — `funds-seo-geo-v1.md` F4 is unresolved |

Phase 1 must follow the **123/124 serving pattern** in `CLAUDE.md`: precompute into
`fund_payloads`, one PK seek per request, degrade to an empty module on `55000`, and **not**
on `57014`. A free-text aggregate over 81,910 contracts computed live on a `db-g1-small` is
the exact shape that produced the `procurement-overview` and `procurement-flow` 500s.

---

## 8. Open questions

1. **Do we ingest open calls after all?** Everything in §3 follows from the fact that we do
   not. `2020.eufunds.bg` publishes an opportunities register; ЦАИС ЕОП and ДФЗ publish
   theirs; a group member has already built a monitor over 13 such sites. Ingesting calls
   would let `/funds` answer ~68% of the questions *literally* rather than adjacently — a
   materially bigger product, and a materially bigger commitment (a wrong deadline is worse
   than no deadline). Out of scope for this plan; it is the obvious v2 question.
2. **Does the resolver key on free text or on a curated activity taxonomy?** `themes.json`
   and `taxonomy.json` already exist in `data/funds/`. Free text ships sooner; a taxonomy
   gives stable URLs — and stable URLs are what earn the long-tail impressions
   `funds-seo-geo-v1.md` is chasing.
3. **Is the reference price defensible?** „5% от медианния грант" is arithmetic on our own
   data, but publishing it positions us against the consultancies who are the group's
   loudest voices. Worth deciding deliberately rather than discovering.
4. **`/funds` or a new route?** The resolver is a different intent from the dashboard.
   Band 1 on `/funds` keeps one page; `/funds/подходящо` would earn its own impressions.
