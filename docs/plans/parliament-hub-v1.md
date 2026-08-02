# Народно събрание — the /parliament dashboard hub, v1

Status: **final, ready to implement.** Drafted 2026-08-02; decisions D1–D4 taken.
Applies the module front-page template from [module-front-pages-v1.md](module-front-pages-v1.md)
to its first module, and the hub conventions the repo already enforces
(`TileHubGrid` + a pure registry + a scene map + a commit-time gate).

**Scope of v1: the dashboard hub only.** No new top-level nav — `/parliament` keeps its
existing entry points (the Управление hub tile and the Управление menu), both relabelled.

---

## 1. Decisions

| # | Decision | Resolution |
|---|---|---|
| **D1** | The name | **„Народно събрание".** Resolves the collision in §2.2 — the place-view pill keeps "Парламент" (a place's election results), the institution gets its own name. Implementation is two lines: `gov_hub_parliament_title` is a KEY used in **9 places** (6 breadcrumbs, the menu, two crumb arrays, the governance registry), so changing its bg/en *value* propagates everywhere at once. The key name stays as-is — renaming it would churn 9 files for no behavioural gain. |
| **D2** | Top-level menu | **No.** Reached from the Управление hub tile + the Управление menu entry, as today. Revisit once the hub earns traffic. |
| **D3** | Governance tile | **Keep — and it is now the ONLY hub entry point**, which raises the stakes on the cross-hub gate in §6. Same shape as `/procurement`: both a governance tile and its own module. |
| **D4** | MP declarations / companies / cars | Stay under **Декларации** (their register is the Сметна палата, not the NS). Cross-linked from a dedicated band — promote the link, not the ownership. Same resolution as `/connections` last week. |

---

## 2. What exists today — measured

`/parliament` is `ParliamentHubScreen.tsx`: **49 lines of hardcoded JSX**, seven preview tiles,
no registry, no scene map, no test. It is the last hub in the app not built on the tile-hub kit.

The data is genuinely fresh — 52nd NS, **613 sessions, last 2026-07-31**, per-day files with item
titles, an 8-value topic taxonomy (`budget · tax · personnel · electoral · constitution ·
ratification · confidence_vote · other`), tallies and per-MP votes.

### 2.1 The payload problem — the biggest engineering finding

Each mini-tile fetches a full derived artifact to render three rows:

| Tile | Fetches | Size |
|---|---|---|
| `ParliamentSessionsTile` | `votes/index.json` | 304 KB |
| `ParliamentCohesionMiniTile` | `derived/cohesion.json` | 640 KB |
| `ParliamentMostPresent/AbsentMiniTile` | `derived/attendance.json` | 504 KB |
| `ParliamentEmbeddingMiniTile` | `derived/embedding.json` | 212 KB |
| `ParliamentVotingTile` | `derived/party_correlation.json` | 20 KB |
| `ParliamentSimilarityMiniTile` | `derived/similarity_headline.json` | 8 KB |
| | **total** | **~1.6 MB** |

`similarity_headline.json` (8 KB) is the pattern already proven *in this same directory* and
ignored by everything else: a precomputed headline slice instead of the 12 MB `similarity.json`
it summarises.

For a page meant to be opened daily, 1.6 MB of JSON to draw a tile grid is the defect. Every
other hub reads ONE small blob (`hub_stats.json`, `sector_stats.json`).
**Non-negotiable budget: ≤ 40 KB for the whole hub, enforced by a test.**

The artifacts a rail would otherwise want are far worse — `dissents.json` **31 MB**,
`similarity.json` **12 MB**, `topic_index.json` **8 MB**. None may be fetched by the hub, ever.

### 2.2 The naming collision (why D1 exists)

`PLACE_VIEW_META.parliamentary` uses `cross_to_parliamentary` = **"Парламент"** for the
place-view switcher — a place's *parliamentary-election results* (`/`, `/municipality/:id`).
The governance tile to `/parliament` was **"Парламент"** too. Same word, two unrelated things.
D1 gives the institution its own name and leaves the switcher on ~40k place pages untouched.

### 2.3 The hub is already NS-scoped — via the global election selector

This was the draft's open question; the code answers it. `useRollcallIndex` derives the
parliament from the **header's election picker** — `electionToNsFolder(selected)` in
`src/data/parliament/nsFolders.ts` — and filters sessions by `ns`. **Ten hooks** under
`src/data/parliament/votes/` already consult `useElectionContext`.

So there is no new `?ns=` param to design. Two consequences, both binding:

- **`hub_stats.json` must be keyed by NS**, exactly as procurement's is keyed by scope.
- **Coverage must be resolved.** `ELECTION_TO_NS` maps **13** elections to NS 40–52, but
  roll-call data exists for **NS 44–52 only** (measured: `important_votes/` and `per-mp/` both
  hold 44…52). The four oldest elections — 2005, 2009, 2013, 2014 → NS 40–43 — have **no
  roll-call data at all**, and `?elections=` is in the `usePreserveParams` allowlist, so a
  visitor arriving from a 2009 page lands here with an empty parliament selected.

  This is the same trap CLAUDE.md documents for `?pscope`: *"A page narrower than the corpus
  MUST resolve the inbound scope."* The hub must NAME the gap — *„Няма поименни гласувания за
  43-то НС (данните започват от 44-то)"* — not silently render zeros, and not silently
  re-anchor to the 52nd while the header still says 2009.

  Session counts also vary wildly per NS (45: **6** sessions; 51: **174**; 52: **39**), so
  "thin but present" is a normal state the tiles must read correctly.

### 2.4 Route sprawl — do not fix by moving

```
/parliament            hub          /parliament/cohesion   /parliament/attendance
/parliament/embedding  /parliament/similarity/:mpId
/votes   /votes/:date  /votes/:date/:slug   /votes/between/:pair
```

`/votes*` is the indexed, prerendered half — **613 live URLs**. Do not relocate it; unify by
breadcrumb and hub. (`SessionScreen` and `PartyPairBreaksScreen` already crumb back to
`/parliament`, so most of this is done.)

### 2.5 There is no MP roster page

`TopMpsScreen` is mounted at `/procurement/mps` — the MP-tied procurement leaderboard, not a
roster. "Депутати" is the most obvious tile on this hub and has nowhere to go. It does not need
building: **`/persons?role=mp`** already serves it (2,122 `mp` roles; `?role` is a validated
filter in `useUrlPersonFilters`).

---

## 3. The hub — five bands

Band order is fixed; bands are individually optional.

### Band 0 — Wire (one line)

`Днес в НС: 5 гласувания · 2 приети закона · 87% присъствие` → `/votes/<latest date>`.

**Recess is a first-class state, not an edge case.** 613 sessions are not evenly spread. When
the newest session for the selected NS is older than ~10 days the wire says so — *„НС не
заседава от 31 юли (12 дни)"* — and bands 1–2 collapse. A stale rail presented as today's news
is the one failure mode that would make the page dishonest.

**Three states, all explicit:** in session · in recess · no data for this NS (§2.3).

### Band 1 — Lead

One item: the most consequential vote of the period. Rule-based — highest `score` in
`important_votes` among **final-adoption** items only, the convention already established for
article vote links (`feedback_article_vote_links`: link second-reading/final votes, never first
readings). Overridable by a committed `leads.json`.

### Band 2 — News rail (3–4 `NewsCard`s)

| Card | Source | Feasibility |
|---|---|---|
| Последни гласувания | `votes/index.json` sessions + the day file | **A** |
| Приети закони | `derived/important_votes/<ns>.json` (15 entries for the 52nd), final-adoption only | **A** |
| Разцепления — кой гласува срещу своите | `dissents.json` **31 MB → precomputed top-N slice** | **B** |
| Отсъствия тази седмица | `attendance.json` → slice | **B** |
| Предстоящи законопроекти | **not ingested** — a new parliament.bg crawl | **C, out of scope** |

### Band 3 — Разгледай (core, 5)

Ordered by the template's rule — **look-up beats read**. Today's hub opens with cohesion and
embedding, the two most analytical things on it.

| Tile | To | stock · flow · change |
|---|---|---|
| Гласувания | `/votes` | `613` сесии · `N` гласувания · `+5` тази седмица |
| Депутати | `/persons?role=mp` | `240` в 52-то НС · `8` групи |
| Присъствие | `/parliament/attendance` | `87%` средно · `−2` пр.п. спрямо предх. НС |
| Единство на групите | `/parliament/cohesion` | `0.94` средна кохезия · най-разединена група |
| Приети закони | `/votes?topic=…` | `N` окончателни · `N` отхвърлени |

### Band 4 — Още (4)

Сходство между депутати (`/parliament/similarity/:mpId`) · Карта на гласуването
(`/parliament/embedding`) · Двама депутати един срещу друг (`/votes/between/:pair`) ·
Разцепления.

### Band 5 — Депутатите извън залата (cross-links, 4)

Декларации (`/governance/declarations`) · Имущество (`/mp-assets`) · Фирми (`/mp/companies`) ·
Свързани лица (`/connections`). This band is what makes the hub a *module* rather than a
vote-analytics silo, and it is pure linking — no new data (D4).

### Band 6 — За теб / Данни и метод

Моят депутат (via `my-area`) · Following · then sources, `lastDate`, methodology.

---

## 4. Data plan — one blob, one generator

New `scripts/parliament/derived/hub_stats.ts`, wired into `rebuildDerived` in
`scripts/parliament/derived/index.ts` — one module per artifact, the pattern is already there.
Writes **`data/parliament/votes/derived/hub_stats.json`**, **keyed by NS** (§2.3):

```jsonc
{
  "computedAt": "…",
  "byNs": {
    "52": {
      "lastDate": "2026-07-31", "sessions": 39, "inRecessDays": 2,
      "tiles": { "votes": {...}, "mps": {...}, "attendance": {...},
                 "cohesion": {...}, "laws": {...} },
      "feed": { "sessions": [/* ≤4 */], "laws": [/* ≤4, final-adoption */],
                "dissents": [/* ≤4, sliced from the 31 MB artifact */],
                "absences": [/* ≤4 */] },
      "lead": { /* one FeedItem */ }
    }
    // … 44–51. NS 40–43 are ABSENT, and the hub renders the no-data state (§2.3).
  }
}
```

Reuses the `FeedItem` shape from the module plan (`id · kind · at · title · subtitle · to ·
badge? · tone?`) so `NewsRail` stays generic across modules.

One hook, `useParliamentHubStats()`, mirroring `useProcurementHubStats` — it reads the selected
election's NS and returns `undefined` for an uncovered one, which is what drives the honest
empty state rather than a zeroed tile.

The six existing mini-tiles keep their own fetches **on their own sub-pages**, where the full
artifact is what the page is for. The hub simply stops using them.

---

## 5. What v1 does NOT include

Stated so scope creep is visible: no bills/законопроекти ingest (§3 band 2, the strongest
future addition — it turns the rail from "what happened" into "what is coming"); no top-level
nav (D2); no `/votes` relocation (§2.4); no new MP roster page (§2.5); no changes to the six
sub-pages beyond breadcrumbs.

---

## 6. Gates

The reports-matrix episode is the direct precedent: a hub fronting one grain per type, a comment
claiming the rest were reachable, and 28 orphan pages. Every gate below exists because something
comparable has already shipped.

| Gate | Asserts | Precedent |
|---|---|---|
| `parliamentHubRegistry.test.ts` | every tile `id` resolves to a scene; ids unique; every `to` absolute | `hubRegistry.test.ts` |
| — accent uniqueness | no accent used twice on one page | added for `/governance` this week |
| — **reachability** | every routed `/parliament/*` and `/votes*` page is linked from the hub, or from a page the hub links | the 31-orphan reports gap |
| — **cross-hub tile** | the Управление tile and the hub agree on `to` + `titleKey` — and since D2 makes that tile the ONLY entry point, losing it orphans the whole module | the `persons` / `connections` gates |
| `parliament_hub_stats.test.ts` | **`hub_stats.json` ≤ 40 KB**; every band-3 tile has a stat entry; `byNs` keys ⊆ the NS that actually have data; `lastDate` matches `index.json` | new — the budget is the point |
| — coverage honesty | an NS with no roll-call data yields `undefined`, never a zeroed tile | §2.3 |
| — recess honesty | `inRecessDays > 10` ⇒ empty feed arrays | §3 band 0 |
| prerender | `/parliament` emits a body linking every sub-page; present in `route_defs.ts` | `project_seo_discovery_gap` |

The payload gate is the one worth stating plainly: **without it the hub silently regrows to
1.6 MB the first time someone adds a tile that reads `cohesion.json` directly.**

---

## 7. Prerender / SEO

`/parliament` already has a prerendered landing (it is in the safe `NAV_HUBS` list). It gains:

- a body linking **every** sub-page, with the band-3/4 blurbs as the crawlable text — these are
  exactly the zero-impression prefixes (`parliament`, `votes`) from `project_seo_discovery_gap`,
  and with D2 there is no nav link doing this job instead;
- bands 3–6 prerendered, **bands 0–2 client-only** — a daily rail baked into static HTML goes
  stale between deploys, and Google should index the durable grid;
- the `/votes` breadcrumb back to `/parliament` extended to `SessionsIndexScreen` so both
  prefixes read as one module.

---

## 8. Phases

| Phase | Scope | Gate before merge |
|---|---|---|
| **0** | D1 rename (2 locale lines → 9 call sites). Registry + scenes + `ParliamentHubScreen` rebuilt on `TileHubGrid`; bands 3–5, no stats, no rail. Deletes the hardcoded JSX. | registry test: scenes, unique ids, absolute `to`, accent uniqueness, reachability, cross-hub tile |
| **1** | `hub_stats.ts` + `useParliamentHubStats` + stock·flow·change on band 3 + the §2.3 coverage state. **Drops all six mini-tile fetches from the hub** — 1.6 MB → ≤40 KB. | payload, coverage-honesty, stats gates; measure before/after in the PR |
| **2** | Bands 0–2: wire, lead, `NewsRail` with sessions + laws (**A**), then dissents + absences (**B** slices). | recess-honesty gate |
| **3** | Prerender body, `SessionsIndexScreen` breadcrumb. | prerender + sitemap gates |

Phase 0 ships on its own and removes the last hardcoded hub. Phase 1 is the user-visible win.

---

## 9. Remaining open question

**Bills (`законопроекти`).** The one genuinely missing dataset. Out of scope for v1, but it is
what would make this page worth opening on a morning when the chamber has not yet voted —
"what is coming" rather than "what happened". Worth its own ingest plan.
