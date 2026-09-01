# Home KPI destinations — where a clicked figure should land

**Status:** A + C1/C2 + C3 IMPLEMENTED 2026-09-01 · **Date:** 2026-09-01
**Trigger:** the four `/` head KPIs all land at the TOP of a long indicators page.
**Relates to:** [`home-dashboard-implementation-v1.md`](home-dashboard-implementation-v1.md) §5.2

---

## 1. What is actually wrong

The observed symptom is „the KPI doesn't scroll to its number". Investigation found three
separate defects underneath it, and only the first is the one that was noticed.

### 1a. The destination has no anchor — and three of four KPIs point at a page with none at all

| KPI | destination today | target section | anchored? |
| --- | --- | --- | --- |
| Растеж на БВП | `/indicators/economy` | `governments_chart_economy` (`h2`) | ❌ |
| Инфлация (ХИПЦ) | `/indicators/economy` | `governments_chart_inflation_breakdown` (`h2`) | ❌ |
| Безработица | `/indicators/economy` | `governments_chart_labour_unemployment` (`h3`) | ❌ |
| Държавен дълг | `/indicators/fiscal` | `governments_chart_fiscal` (`h2`) | ❌ |

`IndicatorsEconomyScreen` (528 lines, 5 `h2` + 4 `h3` sections) has **zero** `id` attributes and
does not call `useHashScroll`. `IndicatorsFiscalScreen` (474 lines, 11 sections) **already** calls
`useHashScroll([macro, governments])` and anchors four sections — but not the one the debt KPI
needs, so the debt KPI lands above a cabinet-budgets table.

⚠️ **This table's debt row said `…_fiscal_nominal_stock` in the first draft, and that was wrong.**
That section plots `govDebtNominal` in EUR billions; the head's figure is debt as a SHARE OF GDP,
which is `governments_chart_fiscal`. Anchoring there would have landed a „28,5%" click on a chart
whose axis reads „€45B" — a plausible-looking destination that answers a different question. Found
by reading the `indicatorKeys` on each chart rather than the heading names.

### 1b. ⚠️ The convention already exists and the home dashboard bypassed it

This is not a missing feature. `src/screens/indicators/indicatorsRegistry.ts` already carries:

```ts
export const DOMAIN_PATHS: Record<IndicatorDomain, string> = { economy: "/indicators/economy", … };
export type KpiEntry = { …; /** Optional hash on the destination domain page. */ anchor?: string };
```

…and `IndicatorsLandingScreen` builds `to: DOMAIN_PATHS[entry.domain] + search + #anchor`, under a
comment that says in as many words: *„THROUGH `DOMAIN_PATHS` AND THE REGISTRY'S OWN `anchor`, never
re-derived. A template of `/indicators/${entry.domain}` restates the map and silently drops the
per-indicator anchor."*

`scripts/db/gen_home/hub_stats.ts`'s `FIGURE_SPECS` does exactly what that comment forbids —
hardcodes `to: "/indicators/economy"` — which is a **fourth restatement** of the domain map and
carries no anchor. And the registry's anchor field is near-dead: **2 of 18 entries set it**
(`euFunds`, `municipalCommitments`), and the landing screen's own comment records that the arm is
currently unreachable and untested.

### 1c. ⚠️⚠️ THE DESTINATION CONTRADICTS THE FIGURE, and anchoring alone would make it worse

The head says **Инфлация (ХИПЦ) +4,4% · спрямо година по-рано · несезонно изгладено · юли 2026**.
That is `latestMonthly.inflation` — the MONTHLY `prc_hicp_minr` print. The economy page's inflation
series is the QUARTERLY one, whose latest point is:

```
series.inflation      last: { period: "2026-Q2", value: 5.83 }
latestMonthly.inflation:    { period: "2026-07", value: 4.4 }
```

**Both are true and they are 1.4 points apart.** Today the reader never sees them side by side
because they land at the top of the page and mostly leave. Scroll them precisely to the inflation
section and the first thing they see is a number that is not the one they clicked, with nothing on
either side explaining the frequency.

So „add an anchor" is necessary and **not sufficient**: it converts an invisible discontinuity into
a visible contradiction. Any plan that stops at 1a ships a worse page than today's.

---

## 2. The options, weighed

### Option A — anchor the destination *(the repo's own answer)*

Add `id` + `scroll-mt-20` to the four target sections, `useHashScroll` to the economy screen, fill
the registry's `anchor` for the four indicators, and route the home KPI href through the registry
instead of a hardcoded string.

- ✅ The pattern exists, is documented, and is used on ten screens including one of the two targets.
- ✅ **Zero SEO surface change.** A hash is not part of a canonical URL, so no new `<loc>`, no
  prerender entry, no OG card, no hreflang, no `dist/` file-count pressure.
- ✅ `useHeadHref` already parses and re-emits the hash correctly — there is a documented incident
  (`…#procurement-entities?pscope=all`) and the fix is in place, so hashes survive the KPI link.
- ❌ Does not close 1c on its own.
- ❌ The reader still downloads a 528-line page to read one section.

### Option B — split the indicators pages

- ✅ Genuinely more targeted; smaller payloads; a page per indicator could rank on its own.
- ❌ **It re-splits an already-split family.** `/indicators/{economy,fiscal,governance,society}` IS
  the split of a former single page. Splitting again trends toward a page per chart.
- ❌ **Thin content.** CLAUDE.md's `/council/resolution/**` note is explicit that „one title and a
  table" earns a penalty rather than traffic. A page that is one chart and a caption is that shape.
- ❌ Real cost, all of it load-bearing here: routes × 2 languages, `scripts/prerender/routes.ts`,
  sitemap `<loc>` in BOTH lists, the no-slash canonical/`og:url`/hreflang rule, OG captures, the
  `HUB_HEAD_*` registries if any becomes a hub, and the `usePreserveParams` scope contract.
- ❌ **It does not solve the stated problem.** A dedicated `/indicators/inflation` still has to show
  the figure the KPI named. Splitting RELOCATES the discontinuity of §1c; it does not close it.

**Where splitting IS defensible, on its own merits and not as a KPI fix:** `/indicators/fiscal`
carries eleven sections spanning cabinet budgets, the balance, debt stock, debt flows, the reserve,
government size, FDI, municipal finance, debt emissions and EU funds. „Public debt" and „EU funds"
are not the same subject in any statistical publication. If that page is ever split, the candidate
is a `/indicators/debt` extraction — decided as an information-architecture question, with its own
SEO work, not bundled into this.

### Option C — land *and confirm* the figure  *(superset of A; the one §1c requires)*

The KPI is not a topic, it is an OBSERVATION: value + comparison + adjustment + period. The landing
should let the reader verify they arrived at that observation.

Three sub-options, cheapest first:

- **C1 — the section states its own basis.** The anchored section renders the same
  `comparison · adjustment · period` line the KPI did. Where they differ (inflation), the
  difference becomes visible and explicable instead of silent.
- **C2 — `:target` emphasis on arrival.** A transient ring/background on the anchored section, so
  „this is what you clicked" is answered by the page rather than inferred from scroll position.
  Cheap; `scroll-mt-20` is already the precedent for arrival-aware styling.
- **C3 — align the series, or name the gap.** For inflation specifically, either point the KPI at
  the monthly series the economy page also plots, or have the section carry both frequencies with
  a one-line note. This is a data decision, not a UI one, and it is the only real fix for §1c.

⚠️ **What C must NOT do: pass the figure in the URL.** A „you clicked +4,4%" banner sourced from a
query param is a claim the destination did not compute. If the home artifact is stale, the page
would render a number it contradicts one section lower — the exact failure class this repo's
generators are written against. **The destination states its own number; agreement is then
verifiable rather than asserted.**

---

## 3. Recommendation

**A + C1/C2 now. C3 as a data decision. B deferred and decoupled.**

Ordered, smallest first:

1. **Anchor the four target sections** — `id` + `scroll-mt-20`; add `useHashScroll([macro, …])` to
   `IndicatorsEconomyScreen`. Fiscal already has the hook and needs only the debt-stock `id`.
2. **Fill `anchor` on the registry entries** for the four, and ideally all 18 — the field exists and
   is 2/18 populated, and its consumer is already written.
3. **Route the home KPI href through the registry**, deleting `FIGURE_SPECS.to`'s hardcoded paths.
   ⚠️ **Design choice worth making explicitly:** resolve the href at RENDER time in
   `homeFigures.ts` rather than baking it into `hub_stats.json`. A stored href is a copy that goes
   stale when an anchor is renamed and nothing fails; a rendered one is a function of code. The
   artifact then carries only the figure `id`. (`indicatorsRegistry.ts` imports one TYPE from
   `useMacro`, so a Node generator *could* import it — but it should not need to.)
4. **C1: the section states its basis**, so the reader can see what they arrived at.
5. **C2: `:target` emphasis** on the anchored section.
6. **C3: decide the inflation frequency** — align the KPI to the plotted series, or plot both and
   say why they differ. Until this lands, steps 1–5 make an existing contradiction visible; that is
   an improvement on hiding it, but it is not finished.

**The gate that stops this rotting** (repo style — static, over the sources): every KPI destination
must resolve to a section `id` that exists in the destination screen's source. Today that check
would fail on all four, and would have caught the divergence in §1b when it was introduced.

---

## 3a. What shipped, and the two things implementing it turned up

**A + C1/C2, verified end to end in a browser.** All four KPIs now carry an anchor, land inside
the viewport clear of the sticky nav, and mark their arrival:

| KPI | href | resting scroll | lands on |
| --- | --- | --- | --- |
| Растеж на БВП | `/indicators/economy#gdp-growth` | 422px | „Икономика … Последна точка: 2 тр. 2026" |
| Инфлация (ХИПЦ) | `/indicators/economy#inflation` | 957px | „Последен публикуван месец: юли 2026 г. · **4,4%**" |
| Безработица | `/indicators/economy#unemployment` | 1579px | the monthly unemployment panel |
| Държавен дълг | `/indicators/fiscal#government-debt` | 560px | the debt-to-GDP section |

Each arrives at `top: 80px` — below the nav, which is what `scroll-mt-20` buys.

⚠️ **THE ANCHORS ALONE WOULD NOT HAVE FIXED IT, and that is the finding.** `useHashScroll` was
already broken for these pages before this change: `/indicators/fiscal#debt-emissions` — an anchor
that had shipped and was assumed to work — left the page at `scrollY: 0` with its target at
y=18855. Two causes, both in the hook:

- **One `requestAnimationFrame` was the whole retry budget.** These pages render their sections
  only once `macro` resolves and then keep moving for a second or more while Recharts measures.
  A single frame after the effect either finds no element or measures a box about to change. It
  polls now, re-issuing the scroll while the target's offset moves and stopping when it settles —
  and yielding immediately on wheel/touch/key, because a poll that keeps yanking the viewport back
  is worse than no scroll.
- ⚠️ **rAF DOES NOT FIRE IN A HIDDEN TAB, AND NEITHER DOES SMOOTH SCROLLING.** Measured with the
  tab backgrounded: the effect ran 3 times and the rAF callback fired **0** times; and once moved
  to timers, `scrollIntoView({ behavior: "smooth" })` moved the page **0px** while `"auto"` moved
  it 957px. That is a real reader path — a deep link opened in a background tab and read later —
  so the hook is on timers and jumps rather than animates while `document.hidden`.

⚠️ **There are TWO hash-scroll implementations and consolidating them is still open.**
`ScrollToTop` in `src/routes.tsx` handles the same hashes app-wide with a MutationObserver and its
own nav-height offset; `useHashScroll` is the per-screen one, on ten screens. They have coexisted
for a while, and the duplication is very likely why nobody noticed the per-screen one was not
working. Merging them changes behaviour on every route, so it is deliberately NOT bundled here.

**And the structural half of A landed:** `HomeFigure` no longer carries a `to`. The generator's
hardcoded `/indicators/economy` — a fourth copy of `DOMAIN_PATHS`, carrying no anchor — is gone,
and `homeFigureHref` resolves the destination from the registry at render time, so a renamed
anchor is a red test (`indicatorsAnchors.test.ts`) rather than a link that silently scrolls
nowhere.

## 3b. C3 — the frequency gap, closed by giving inflation the series it never had

⚠️ **THE FIX WAS AN ASYMMETRY, NOT A JUDGEMENT CALL, and the repo had already written it down for
the other indicator.** `macro.json` carried `unemploymentMonthly` as a full 258-point monthly
SERIES — and the economy page plots it as the labour panel's main line with the quarterly as a
faint reference, so the home head's monthly unemployment figure is the last point of a line the
page actually draws. Its spec says why in as many words: a monthly series „surfaces the freshest
reading as the last point rather than as a separate callout".

Inflation had no such series. It had the quarterly mean plus a single `latestMonthly`
OBSERVATION, which the page could only mention in a callout — so the head quoted a number the
page's line could not reach, and the two sat 1.4 points apart.

**So `inflationMonthly` now exists** (`prc_hicp_minr`, RCH_A, all-items, monthly — the identical
query the `latestMonthly` spec already used, so the two cannot disagree), 260 points, and the
inflation section plots it as the headline line with the quarterly `inflation` as the reference.
The ECOICOP breakdown keeps its own sub-heading beneath it.

Measured after the change, one click apart:

```
head:     +5,1% Инфлация (ХИПЦ) · спрямо година по-рано · несезонно изгладено · август 2026 г.
landing:  „Обща инфлация (месечна)" · Последна точка: август 2026 г.
```

⚠️ **The macro refresh that carried the new series also moved two live figures**, and that is a
normal `update-macro` outcome rather than a side effect of this change: unemployment 2026-06 3,0%
→ 2026-07 3,6%, inflation 2026-07 4,4% → 2026-08 5,1%. Nothing quarterly moved. The earlier
sections of this document quote the pre-refresh figures because that is what they were measured
against; they are not restated.

⚠️ **And it turned up a third period formatter.** `SectionAsOf` rendered „Последна точка: 2026-08"
under a head that had just said „август 2026 г." — the same period, two spellings, one click
apart — because `components/macro/formatPeriod` handled quarters and passed months through raw,
while `homeFigures` carried its own month formatter. That file's own header says „IT MUST STAY THE
ONLY ONE", so months went in there and `homeFigures.formatPeriod` now delegates. It keeps exactly
one thing of its own: the head writes „Q2 2026" where the indicators tiles write „2026 Q2", which
is a copy decision rather than a formatting one.

## 4. What NOT to do

- Do not re-derive `/indicators/${domain}`. There are already four copies of that map and the
  newest one is the one that dropped the anchor.
- Do not add per-indicator routes as a fix for link precision. That is Option B's cost with none of
  Option B's benefit.
- Do not render a figure the destination did not compute.
- Do not smooth-scroll past sections the reader did not ask for without marking the arrival — an
  unmarked auto-scroll on a long page reads as a bug.
