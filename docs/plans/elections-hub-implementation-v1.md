# Elections hub — full implementation plan

**Status:** ready to execute  
**Product brief:** [elections-hub-research-v1.md](./elections-hub-research-v1.md)  
**Scope:** parliamentary and local election results at country, abroad, region, municipality, settlement, and polling-section levels  
**Version:** v1 — shared election surface system with the country entry preserved at `/elections`

> **Integration update — 2026-09-01, revised after audit.** The global-home work in
> [home-dashboard-implementation-v1.md](./home-dashboard-implementation-v1.md) supersedes this
> plan on **two** points, not one.
>
> **1. `/` becomes the global Bulgaria dashboard.** Unchanged from the first version of this
> banner.
>
> **2. ⚠️ `/elections` NO LONGER INHERITS THE COUNTRY RESULT — and this plan's fixed decisions
> 1, 2, 15 and 16 are superseded accordingly.** The former root composition
> (`DashboardScreen` = `PlaceHeader` + `DashboardCards`) is preserved at **`/parliamentary`**,
> the index of the existing route group that already holds `/parliamentary/analysis` and
> `/parliamentary/reports`. Two reasons, both recorded in
> [home-dashboard-plan-audit-2026-09-01.md](../audits/home-dashboard-plan-audit-2026-09-01.md):
> a `/elections` rendering the latest cycle would duplicate the already-prerendered,
> already-sitemapped `/elections/<latest date>`; and this plan then replaces that screen, so
> the home plan's Phase 1 body, JSON-LD, sitemap entry and OG image would have been throwaway.
>
> **What this means here.** `/elections` is a NEW route created by THIS plan, as a cross-kind
> hub (parliamentary + local + chmi). It has no preservation duty, no legacy body to inherit,
> and no parity bridge to build. Its `HubHead`, registry, scenes, scope bar and search are the
> whole page rather than a wrapper around a screen that already existed. Decision 15's
> `?elections` contract still holds and now also applies to `/parliamentary`.
>
> Historical `/elections/:date`, local-election routes, and every deep result URL remain
> unchanged. The home plan's Phase 1 is a prerequisite of this plan's route work, since it is
> what moves the country result off `/` and gives `/elections/:date` its breadcrumb parent.

## 1. Outcome

Ship `/elections` as the single entry into a shared, results-first election experience while preserving the depth and all existing deep/historical public URLs. The former root country result is preserved at `/elections`; `/` is owned by the global home dashboard.

The reader should be able to answer the primary question for the current place in the first screen:

- parliamentary: who led, by how much, with how many votes/seats, and where;
- local: who won the relevant mayoral office, which group leads the council, and whether control is split;
- abroad: which party led and where, using votes cast rather than a false turnout denominator;
- section: what each ballot recorded and how to open the official evidence.

The implementation must simplify hierarchy, not remove maps, mayors, council composition, candidates, histories, flows, or evidence tables. Those remain below the first result surface or behind an existing complete-results destination.

## 2. Fixed v1 decisions

These decisions are implementation constraints, not open design questions.

1. Add a canonical `/elections` entry.
2. Preserve the current parliamentary country experience at `/elections`, and preserve `/elections/:date`, `/local/:cycle`, and every current place/result leaf. `/` becomes the global home and is not redirected. Do not introduce a new `/elections/:kind/:cycle/...` family in v1.
3. Merge the two top-navigation election menus into one Elections menu, but preserve every existing destination.
4. Use one shared page grammar and shared primitives. Keep parliamentary and local outcome contracts as discriminated types; do not normalize mayor and council votes into a single ranking.
5. Create a small, generated `surface` projection **only for the scopes that pass the emission test in §5.0**. It is a display projection of canonical result files, not a new result authority, and it is not emitted for a level whose canonical shard is already inside the budget.
6. Keep geometry, full history, vote-flow matrices, long candidate lists, and evidence tables out of the surface projection and lazy-load them through the existing hooks.
7. On mobile, the ranked result precedes the map in DOM and visual order. On desktop, they appear side by side.
8. A map always has a complete text/list equivalent. Color is never the only winner or state encoding.
9. Local country and region render mayor and council as separate modes/panels. Municipality renders separate mayor and council panels when those ballots exist.
10. Never publish turnout abroad unless a valid eligible/registered-voter denominator exists. The v1 parliamentary-abroad surface uses total votes cast and valid votes.
11. Show at most four outcome facts and three standouts above the deeper analysis.
12. A statistical signal is a review lead, never evidence of fraud. Every signal must expose scope, metric, baseline, sample size, status, and an evidence destination.
13. Generated surface data lands invisibly before each UI migration. Every migrated page retains a legacy fallback until its generated artifact passes data and route tests.
14. Every new canonical page ships with prerender, both sitemap declarations/artifacts, canonical metadata, internal reachability, and a dedicated OG image in the same phase.
15. `/elections` **reads `?elections` and captions the cycle it is showing**; it never silently overrides it. `elections` is in the `usePreserveParams` allowlist (`src/ux/usePreserveParams.tsx`), so every in-app link carries it and a link cannot clear it. The hub falls back to the latest event **only when the param is absent or names an unknown cycle**, and the scope bar always names the cycle whose numbers are on screen. See §3.1a.
16. `/elections` is a hub in the repo's sense and composes `HubHead`. `ElectionScopeBar` and `ElectionOutcomeStrip` belong to the **result pages**, which are not hubs. See §6.0.
17. **A place has four views and a result page shows one fact from each.** `PlaceDigest` (§4.1) renders one figure per reachable view — Управление, Парламент, Местни, Потребление — taken from that view's own producer, linking to that view, and omitted rather than zeroed when the view does not resolve for this place. A reader must not have to find the pill to learn who the mayor is.
18. **Every figure on `/elections` and on every election result page is read from the BUCKET. No `/api/db` call is on the render path.** See §5.1. A fact that only Postgres can answer is either baked into a bucket artifact by a generator at build time, or it is not quoted — it becomes a labelled link and nothing more.
19. **A shared composition that already exists is adopted, not rebuilt.** The four-card outcome strip exists nine times and `PlaceViewNav` is already inside `PlaceHeader`; both get a contract, not a parallel implementation (§6.3, §4).
20. **Publication is part of the phase that generates the artifact, not a later step.** A phase that writes a `data/**` file and does not sync it to the bucket is incomplete, and its browser gates are vacuous — CI fetches from the live bucket. See §9.0.

## 3. Existing contracts to preserve

### Routes

Parliamentary:

- country: current `/elections` and historical `/elections/:date`;
- region and abroad: `/municipality/:id`, where `32` is abroad;
- municipality: `/settlement/:id`;
- settlement: `/sections/:id`;
- section: `/section/:id`.

Local:

- country: `/local/:cycle`;
- region: `/local/:cycle/region/:oblast`;
- municipality: `/local/:cycle/:obshtinaCode`;
- settlement: `/local/:cycle/settlement/:ekatte`;
- section: `/local/:cycle/:obshtinaCode/section/:sectionCode`;
- complete mayor/council/section and leaderboard leaves remain unchanged.

The parliamentary route names are historically one geographic level off. User-facing copy and the new surface types must use the real level; route segments remain untouched in v1.

### 3.1a The `?elections` contract

`elections` is one of the global params `usePreserveParams` carries across every `@/ux/Link`
navigation (`src/ux/usePreserveParams.tsx` — the list is an allowlist, so anything absent is
stripped and anything present survives every hop). Two consequences bind this work:

- **A link into `/elections` cannot clear the selected cycle.** A reader who was on
  `/elections/2013_05_12` arrives carrying `?elections=2013_05_12`. A hub that "defaults to the
  latest election event" therefore renders the latest cycle's outcome canvas while
  `ElectionContext` — and every other reader of that param on the page — resolves 2013. The two
  disagree silently, at a 200.
- **The same param is the reason a scoped figure needs a caption.** This is the documented
  hub-of-hubs rule: a `?pscope` destination can be forced by a link, `?elections` cannot, so the
  honest move is to quote the SELECTED cycle and let the caption name it.

The resolution, fixed by decision 15:

1. `/elections` resolves its cycle as `?elections` → the latest event, in that order, and
   validates the param against `src/data/json/elections.json` and
   `src/data/json/local_elections.json` before using it.
2. The scope bar names the resolved cycle and its status in words. A hub showing 2013 must say
   2013; it may offer "switch to the latest" as an explicit control, never as a silent default.
3. An unknown or malformed `?elections` value falls back to the latest event **and says so**,
   rather than rendering an empty first screen.
4. Selecting a different election from the hub writes `?elections` rather than holding the
   choice in client-only state, so the cycle survives the navigation into
   `/elections/:date` or `/local/:cycle`.

⚠️ **The scope bar's cycle label is the exact position that has shipped two defects, and both are
i18n defects.** It renders a date, in two languages, from an internal identifier:

- **A calendar day is formatted in UTC.** `2026-04-19` through an `Intl.DateTimeFormat` with no
  `timeZone` renders as the 18th for every reader west of Greenwich, so a label and the URL it
  links to disagree by a day. This shipped on 613 pages. Use `formatDate`
  (`src/lib/formatDate.ts`), which pins `timeZone: "UTC"` for a date-only value;
  `src/lib/dateFormatterPin.test.ts` is the repo-wide gate that every formatter makes the choice
  on purpose.
- **Never render the folder id.** `ScopeControl`'s default pill read „Този парламент ·
  2026-04-19" — the election FOLDER ID with underscores swapped for hyphens — on all 31 surfaces
  that mount it. A cycle identifier is a key, not a label; it goes through the date formatter and
  the locale, in both languages.

Gate: a route test that loads `/elections?elections=<older cycle>` and asserts the rendered
outcome canvas, the scope-bar cycle label and `ElectionContext` all name the same cycle; a second
that loads `/elections?elections=not-a-cycle` and asserts the named fallback rather than a blank
canvas; and a third that asserts the rendered cycle label contains no `_`/`YYYY-MM-DD` folder form
and reads correctly under a `TZ` west of UTC in both languages.

### Existing data authorities

- Parliamentary country: `data/<cycle>/national_summary.json` plus canonical election shards.
- Parliamentary subnational summaries: canonical region/municipality/settlement/section shards and their prior-cycle stats; current React hooks compute the summaries client-side.
- Local country: `data/<cycle>/index.json`, `regions_summary.json`, `national_leaders.json`, and `national_municipalities.json`.
- Local region: `data/<cycle>/region/<oblast>.json`.
- Local municipality: `data/<cycle>/municipalities/<obshtinaCode>.json`.
- Local settlement: the parent municipality bundle plus the resolved `kmetstva[]` contest.
- Local section: `data/<cycle>/sections/<obshtina>/<sectionCode>.json`.

The new projection must be reproducible from these files and must not become an independently edited source.

### Components worth retaining

- `PlaceHeader` and its place breadcrumb/switcher behavior;
- current map tiles at every level;
- `PartyResultsTile`, `LocalRankedBar`, mayor runoff, council hemicycle, MPs/candidates, and source/protocol links;
- the deeper `DashboardSection` bodies and their existing complete-result leaves;
- current local place-resolution special cases for Sofia and Plovdiv/Varna districts.

## 4. Target page grammar

Every election result page uses this order:

1. `PlaceHeader` — place identity, the `PlaceViewNav` four-view switcher, and the cycle/status the scope bar contributes;
2. `PlaceDigest` — one fact per reachable view, at most four (§4.1);
3. `ElectionOutcomeStrip` — zero to four non-duplicative facts about THIS election;
4. `ElectionOutcomeCanvas` — ranked result plus map;
5. `ElectionStandouts` — zero to three grounded findings;
6. existing detailed sections in a stable order;
7. `ElectionSourcePanel` — method, downloads, protocols, update state.

⚠️ **`ElectionScopeBar` is not a seventh row of chrome.** `PlaceHeader` **already renders
`PlaceViewNav`** (`src/screens/components/place/PlaceHeaderView.tsx`) — the
Управление / Парламент / Местни / Потребление pills on every place page — so "insert the scope
bar immediately after `PlaceHeader`" stacks a second horizontal control strip directly under an
existing one, and puts two bars between the place name and the first number. The scope bar's
content (cycle, round/contest, result status, source) belongs **inside the header block**, next
to the identity it qualifies; only where a page genuinely needs a contest switcher does it earn
its own row. Budget the combined header the way the hub head is budgeted, and measure it at
390 px first.

Desktop canvas:

```text
┌ map / geography question ───────────┬ ranked result ──────────────┐
│ synchronized selection and legend  │ votes · % · seats/margin   │
└─────────────────────────────────────┴─────────────────────────────┘
```

Mobile DOM order:

```text
scope → facts → ranked result → map → standouts → detail
```

The map remains prominent. CSS grid placement must not use `order` to create a visual order that differs from the DOM.

### 4.0 The shell's document structure

The grammar above is seven regions, and both properties a screen-reader user navigates by —
landmarks and headings — are per-call-site decisions in this codebase rather than defaults.

⚠️ **`DashboardSection.headingLevel` IS OPT-IN, so "logical H2 order" is a prop and not a
property of the composition.** Its own header states the reason: the component has ~186 call
sites at several nesting depths, so a blanket `<h2>` would be wrong somewhere — but _"a page
whose sections ARE the top-level structure under its `<h1>` should pass 2, or its section titles
are invisible to heading navigation and its outline skips a level."_ Phases 4–6 migrate ~15 such
screens, and **every one must pass `headingLevel={2}`**.

The failure is quiet in the worst available way: the `<section>` is named through
`aria-labelledby` whether or not the level is passed, so it stays a **landmark**. The page
remains navigable by region and silently stops being navigable by heading — correct-looking in
review, and broken for exactly the reader who navigates by heading.

**Every one of the seven regions is a named landmark.** `DashboardCards` already wraps its body
in `<section aria-label={t("dashboard")}>` and `DashboardSection` self-names via
`aria-labelledby`; the digest, strip, canvas, standouts and source panel are new and unnamed.
Seven consecutive unlabelled `<section>`s are seven identical "region" rows in a landmark list,
which is worse than none. Name each from the same i18n key its heading uses.

**The header fold must preserve what `PlaceViewNav` already does right.** It labels the control
with `aria-label={t("place_view_nav_label")}` and renders the active view as a non-clickable
`<span>` carrying `aria-current="page"`. Folding the scope bar's cycle/status into that block
(§4) must keep both; a rewrite that turns the active pill back into a `<Link>` to itself, or
drops the group label, is a regression nothing else here would catch.

**A first-screen anchor, since there is no skip link.** The repo has none, and these pages now
open with the header, four view pills, the scope row, the digest and the strip before the
result. Give the outcome canvas a stable `id` so `useHashScroll` and an in-page "to the results"
affordance can reach it; a repo-wide skip link is out of scope for v1.

### 4.1 The place digest — one cell per view

**A place has FOUR views, and this plan covers two of them.** `PlaceViewNav` switches a reader
between Управление (`/governance/:id`), Парламент (`/settlement/:id` and its siblings), Местни
(`/local/:cycle/:obshtinaCode`) and Потребление (`/consumption/:id`) — the same place, four
angles, one `PlaceHeader`. `ElectionSurfaceV1.kind` is `"parliamentary" | "local"`, so the
contract as drafted cannot carry a governance or a consumption fact at all.

The cost is concrete and measurable on any municipality. On `/settlement/PDV22` a reader is
shown the largest gain, the largest fall, turnout and the paper/machine split — and cannot learn
who the mayor is, or that the council is held by the same party, without knowing the Местни pill
exists. **The plan's own validation task 2 — "Who is mayor, which group leads the council, and
are they the same?" — is answerable only by a reader who already found the right tab.**

What each view leads with today:

| view        | route                         | its own headline facts                                                              |
| ----------- | ----------------------------- | ----------------------------------------------------------------------------------- |
| Управление  | `/governance/:id`             | your MPs and their attendance, „Как гласуваха", council, budget, procurement, taxes |
| Парламент   | `/settlement/:id`             | largest gain / largest fall / turnout / paper-vs-machine, then map + top parties    |
| Местни      | `/local/:cycle/:obshtinaCode` | mayor, mayor votes, council seats and party count, whether mayor and council match  |
| Потребление | `/consumption/:id`            | price level vs the country with its rank, basket value, change since the euro       |

**The digest is one cell per reachable view, four at most, rendered on all four views.** It fits
the existing `lg:grid-cols-4` strip and needs no new layout:

| view        | the cell                                           | why this one                                          |
| ----------- | -------------------------------------------------- | ----------------------------------------------------- |
| Управление  | LINK ONLY — „вашите депутати и съветът", no figure | its facts are Postgres-only; see §5.1                 |
| Парламент   | who won here and by how much                       | validation task 1                                     |
| Местни      | mayor, council lead, and whether they match        | validation task 2, the most-asked question in the set |
| Потребление | LINK ONLY — „цените тук", no figure                | the only figure on that view a reader can act on      |

Each cell links to its own view, states its basis and names its cycle or reference date.

Six rules, each of which the surrounding conventions already imply:

- **It is a DIGEST, not a second analysis.** Every figure is taken from the producer that draws
  the destination's own numbers — the same rule that keeps a hub of hubs from disagreeing with
  the page one click away. A mayor name re-derived here from a different resolver than the
  Местни tab uses is the defect this rule exists to prevent, and it is invisible on the page.
- **An unreachable view is OMITTED, never zeroed.** `PlaceViewNav` already models this: the
  local pill self-hides when the place has no data in the active cycle, the whole control hides
  below two reachable views, and governance/consumption resolve at every tier except a polling
  section. A place with no local cycle shows three cells. This is the plan's own "absent ballot
  is not a zero-vote ballot" rule, one layer up.
- **The selection rule is NOT the standout rule.** §7 selects what is _unusual_; the digest
  states what is _true and load-bearing_. Different question, different cap, and no
  suppression-on-weak-signal — a mayor is not omitted for being unsurprising.
- **It is disjoint from the outcome strip.** On an election view the strip already answers that
  election; the digest's own cell for that view is therefore dropped rather than repeated, so
  the two never render the same number. §7.1 binds here.
- ⚠️ **ONLY TWO CELLS CARRY A NUMBER, AND THAT IS THE RULE, NOT A LIMITATION OF v1.** Парламент
  and Местни are bucket-native; Управление and Потребление are answerable only by Cloud SQL, and
  §5.1 forbids an `/api/db` call on the render path of these pages. Those two are therefore
  labelled links — the hub convention's „a missing sibling is a SKIPPED FIGURE, never a zero",
  applied by design. The pair that does carry figures is exactly the pair validation task 2 needs.
- ⚠️ **A digest cell may never introduce a second cadence into a per-cycle artifact.** Even if a
  figure were baked from Postgres by a generator (§5.1's escape hatch), the price index moves
  **daily** and `data/<cycle>/surface/` moves once every few years. „индекс 92 · №11 от 93"
  cannot live in that file at any point in the future, and the reason is the file's refresh
  period rather than today's plumbing.
- **A polling section has no digest.** Three of the four views do not resolve there, so a
  one-cell digest is chrome. Section pages keep the result/evidence composition of §8.

## 5. Shared data contract

Create the browser/script-shared types in `src/data/elections/surfaceTypes.ts` and keep them free of React or Node imports.

```ts
type ElectionKind = "parliamentary" | "local";
type ElectionPlaceLevel =
  | "country"
  | "abroad"
  | "region"
  | "municipality"
  | "settlement"
  | "section";

type ElectionResultStatus =
  | "projection"
  | "provisional"
  | "final"
  | "runoff_pending"
  | "partial_election";

type TurnoutBasis = "registered_voters" | "eligible_population" | "unavailable";

type BallotKind =
  | "parliamentary_list"
  | "municipality_mayor"
  | "district_mayor"
  | "settlement_mayor"
  | "municipal_council";

type ElectionSurfaceV1 = {
  schemaVersion: 1;
  kind: ElectionKind;
  cycle: string;
  place: {
    level: ElectionPlaceLevel;
    id: string;
    parent?: { level: ElectionPlaceLevel; id: string };
  };
  status: {
    result: ElectionResultStatus;
    updatedAt?: string;
    countedPct?: number;
    sourceLabel: ElectionSourceLabel; // see "The source authority is not single-valued"
    sourceUrl?: string;
    downloadUrl?: string;
    // Present only where a second authority has been compared against the first
    // for this scope. Absent means "not reconciled", never "they agree".
    reconciliation?: {
      against: ElectionSourceLabel;
      agrees: boolean;
      to: string; // the destination that shows the comparison
    };
  };
  ballots: ElectionSurfaceBallot[];
  facts: ElectionSurfaceFact[]; // maximum 4 across active ballot
  standouts: ElectionStandout[]; // maximum 3
  destinations: ElectionDestinations;
};
```

### `ElectionDestinations` — where a reader goes next

The draft referenced this type in the payload and **never defined it**: it was the one name in
the contract with no shape anywhere in either document. It is also the field the place digest
(§4.1) needs, so it is defined here rather than left to the implementation to invent.

```ts
type ElectionDestination = {
  to: string; // an app route, resolved by placeViewUrl/localUrl — never a built string
  available: boolean; // false renders an explained absence, never a dead or hidden link
  reason?: string; // enum key, why it is unavailable — "no_local_cycle", "not_at_section", …
};

type ElectionDestinations = {
  // Depth within THIS result — the "see the complete result" leaves §8 requires.
  completeResult: ElectionDestination;
  childPlaces?: ElectionDestination; // regions / municipalities / settlements / sections
  parentPlace?: ElectionDestination;
  officialProtocol?: ElectionDestination; // section level only
  // The other three views of the SAME place. Present at every level except a section.
  views?: {
    governance?: ElectionDestination;
    parliamentary?: ElectionDestination;
    local?: ElectionDestination;
    consumption?: ElectionDestination;
  };
};
```

Three rules on it:

- **Routes come from `placeViewUrl` / `localUrl`, never from a string built in the generator.**
  A generator that concatenates its own paths keeps emitting the old shape after the routing
  rule moves, and both sides stay green. This is the same reason the artifact carries no prose.
- **`available: false` is a rendered state, not an omission.** A local view that does not exist
  for this place and cycle is worth saying — „тук не са провеждани местни избори през 2023" is
  an answer; a silently missing pill is not. The `reason` is an enum key so both locales carry
  it, per §5.2.
- **`views` is a pointer, never a payload.** It carries a route and its availability; the facts
  behind those views come from their own producers (§4.1). Putting a mayor's name in here would
  make this artifact a second authority on the local result.

`ElectionSurfaceBallot` must include:

- `kind`, `round`, and `resultStatus`;
- a ranked preview of no more than eight entries;
- explicit `votes`, `pct`, optional `seats`, and optional `marginPct`;
- totals with `votesCast`, `validVotes`, optional `registeredVoters`, optional `turnoutPct`, and mandatory `turnoutBasis`;
- map metadata only: default question, allowed modes, geography grain, and the existing data/geometry destination;
- a complete-results destination;
- an optional official protocol/video/scan destination at section level.

`ElectionSurfaceFact` is a typed fact code plus values and basis, not generated prose. Renderers map fact codes to Bulgarian/English translations. At minimum support:

- winner/leader and margin;
- seats and majority threshold;
- turnout with basis;
- valid votes or total votes cast;
- runoff state;
- split control;
- wasted vote/threshold where applicable.

`ElectionStandout` must contain:

```ts
type ElectionStandout = {
  id: string;
  category: "outcome" | "participation" | "review";
  signal: string; // closed enum in the actual implementation
  metric: number;
  unit: "votes" | "pct" | "pct_point" | "count" | "seats";
  scope: { level: ElectionPlaceLevel; id: string };
  baseline: { kind: string; labelParams: Record<string, string | number> };
  sampleSize: number;
  resultStatus: ElectionResultStatus;
  evidenceTo: string;
  labelParams: Record<string, string | number>;
};
```

### The source authority is not single-valued

`sourceLabel: "cik"` is a closed literal with one member, and the corpus already contains a
second authority for the local tier. `/sverka` is a routed page whose entire subject is that the
two disagree, and every regular local cycle ships the comparison it renders:
`data/<cycle>/officials_diff.json` plus 288 per-município sidecars under
`officials_diff/`. On the 2023 cycle its own summary reports 288 municipalities checked,
280 mayor matches, 2 replaced, 6 present in the officials roster and absent from CIK, and
4,240 of 4,986 elected councillors matched.

A status contract that can only say "cik" cannot represent that page, and — worse — it makes
"the CEC result" and "the CEC result, which the officials roster contradicts here" render
identically.

The v1 resolution:

```ts
type ElectionSourceLabel = "cik" | "officials_roster";
```

Three rules on it:

- **CIK remains the RESULT authority.** `officials_roster` never supplies votes, seats or a
  winner. It is only ever the `against` side of a `reconciliation`, so widening the literal
  cannot let a second corpus quietly become the source of a number.
- **Absent `reconciliation` means NOT RECONCILED, never "they agree".** This is the same rule as
  `turnoutBasis: "unavailable"` and as the standout-suppression rule: a missing comparison is a
  missing comparison. Only the local tier has one at all, so the field is absent on every
  parliamentary surface by construction, and a UI that renders "confirmed" from its absence is
  the defect this shape exists to prevent.
- **The surface carries the flag and the link, never the diff.** `officials_diff.json` and its
  sidecars stay where they are and are fetched by `/sverka` and the município page as they are
  today; the surface holds one boolean and one destination, per §5's no-evidence-tables rule.

Data gate: for every local município surface, `reconciliation` is present iff a sidecar exists
for that município in that cycle, `agrees` re-derives from the sidecar rather than from a
stored copy, and `to` resolves to a live route. If v1 declines to wire this, say so here as a
decision and keep the literal widened — an unused second member costs nothing, and a
single-valued literal that has to be widened later changes every emitted file.

Do not store translated sentences in generated files. Do not emit a standout when its denominator, baseline, or evidence destination is missing.

### 5.0 Which levels get an artifact

**A surface is emitted only where the canonical shard cannot already serve the first screen.**
The projection exists to remove bytes and fan-out, so a level whose canonical file is already
inside the budget below gets no second file; the shell reads that shard through the same
`surfacePath.ts` indirection and a thin adapter.

Measured against the corpus on 2026-09-01, before any generator work:

| level                         | canonical file today                                                              | measured           | budget | emit?                              |
| ----------------------------- | --------------------------------------------------------------------------------- | ------------------ | ------ | ---------------------------------- |
| parliamentary country         | `data/<cycle>/national_summary.json`                                              | **14.4 KB**        | 24 KiB | no — inside budget                 |
| parliamentary region / abroad | computed client-side across shards                                                | fan-out            | 16 KiB | **yes** — no single canonical file |
| parliamentary municipality    | `municipalities/<code>.json`                                                      | **1.9 KB**         | 16 KiB | no — inside budget                 |
| parliamentary settlement      | `settlements/<ekatte>.json`, mean over 5,658                                      | **8.9 KB**         | 16 KiB | no — inside budget                 |
| parliamentary section         | `sections/by-oblast/<oblast>.json`, 12,721 sections in 32 shards                  | not route-sized    | 8 KiB  | **yes** — sidecar or re-shard      |
| local country                 | `index.json` + `regions_summary` + `national_leaders` + `national_municipalities` | 4-file fan-out     | 24 KiB | **yes**                            |
| local region                  | `region/<oblast>.json`                                                            | measure in Phase 1 | 16 KiB | measure                            |
| local municipality            | `municipalities/<code>.json`, e.g. `BGS01`                                        | **58 KB**          | 16 KiB | **yes** — 3.6x over                |
| local settlement              | parent municipality bundle                                                        | inherits the 58 KB | 16 KiB | **yes**                            |
| local section                 | `sections/<obshtina>/<code>.json`, mean over 12,591                               | **6.1 KB**         | 8 KiB  | no — embed a `surface` key         |

So the projection is worth building for the **local municipality/settlement tree, local country,
parliamentary region/abroad, and parliamentary section** — and for the other four levels a
second artifact would be a second fetch of the same bytes.

**The cost of getting this wrong is not a byte budget, it is an object count.** Emitting
settlement and section surfaces for all 13 parliamentary cycles is
`(5,365 + 12,721 + 306 + 32) x 13`, roughly **240,000 new bucket objects** against the ~761,000
already in `gs://data-electionsbg-com`. `scripts/bucket_sync_paths.ts` records why that is not
free: `bucket:sync` must build both full listings before it diffs anything, and with
`parallel_process_count = 1` (the macOS multiprocessing workaround) that enumeration is
single-process and dominates at **~30 minutes regardless of churn**. A scoped
`bucket:sync:paths` is the mitigation, not a reason to skip the count.

Two rules follow:

- **Cycle coverage is bounded and stated.** v1 generates for the latest parliamentary cycle and
  the latest two regular local cycles. Backfilling earlier cycles is a separate, measured
  decision with its own object-count line; the shell falls back to the legacy composition for
  any cycle with no artifact, which is the same path a missing artifact already takes.
- **Section artifacts are sharded, never flat.** 12,721 files in one directory is a listing and
  filesystem cost with no upside; shard by oblast prefix the way
  `sections/by-oblast/` already does.

Exit criterion for Phase 1 (replaces "tighten if under 70% of a ceiling"): the emit column above
is re-measured against generated output, every `no` row is confirmed still inside its budget, and
every `yes` row shows the reduction that justified it. A level that generates an artifact no
smaller than the file it replaces is dropped from the generator rather than shipped.

### Artifact paths

Artifacts stay inside each existing cycle directory, **for the levels §5.0 emits**:

```text
data/<local-cycle>/surface/country.json
data/<cycle>/surface/region/<oblast>.json                     # parliamentary + local
data/<local-cycle>/surface/municipality/<obshtina>.json
data/<local-cycle>/surface/settlement/<ekatte>.json
data/<cycle>/surface/section/by-oblast/<oblast>/<sectionCode>.json   # parliamentary only
```

Levels §5.0 marks `no` have no path here: the shell reads
`data/<cycle>/national_summary.json`, `municipalities/<code>.json`,
`settlements/<ekatte>.json` and the local `sections/<obshtina>/<code>.json` directly, through
`surfacePath.ts` and a per-level adapter, so the runtime contract is identical either way.

`region/32.json` declares `place.level: "abroad"`. Local generation never emits an abroad artifact.

Avoid duplicating an already route-sized detail file. Local section details are already emitted one station at a time at a measured 6.1 KB mean, so the implementation adds a `surface` key to `data/<local-cycle>/sections/<obshtina>/<sectionCode>.json` and `surfacePath.ts` reads that file. Parliamentary sections live in 32 oblast shards, so they are the one level that genuinely needs new route-sized files; shard them under `by-oblast/` and count them.

Record generated file-count and total-byte deltas alongside the per-file budget, per cycle and per level, and put the numbers in the Phase 1 commit message. A fast page is not sufficient justification for an uncontrolled six-figure file expansion.

### Size and fetch budgets

- country surface: at most 24 KiB uncompressed JSON;
- every subnational surface: at most 16 KiB;
- section surface: at most 8 KiB;
- no geometry, history series, flow matrix, full candidate list, or full section list in a surface;
- one surface request may determine the strip, ranking, status, and standouts;
- the map may issue its current result/geometry requests, but the first result may not fan out across child-place bundles;
- new chart/map libraries remain outside the entry chunk and are loaded only when their panel mounts;
- **the place finder's index is inside the page budget, and it is the largest number in this design.** The fat index behind the global search costs `sections_index.json` **755 KB** + `settlements.json` **963 KB** + `municipalities.json` **42 KB**, about **1.76 MB raw** — roughly 70x the country surface. A finder mounted in `ElectionScopeBar` pays that on every election page at every level, which would make the surface budget above decorative. See §6.2.

These are initial ceilings, and §5.0's emit column is re-measured against them at the end of Phase 1. Tighten a ceiling before merging if the maximum is less than 70% of it; **drop the level from the generator** if the artifact is no smaller than the canonical file it replaces.

### 5.1 Bucket-only: no Postgres on the render path

**The election data layer is bucket-fed today and must stay that way.** Audited 2026-09-01:
`useRegionSummary`, `useMunicipalitySummary`, `useSettlementSummary`, `useSectionSummary` and
`useLocalElectionIndex` issue **zero** `/api/db` calls, and the whole of `src/data/dashboard`,
`regions`, `municipalities`, `settlements`, `sections` and `local` contains exactly one
`/api/db` reference — `usePersonElections`, which belongs to the person page and not to a
result page. The surface artifacts of §5.0 are fetched through `dataUrl`, so they inherit the
same property by construction.

Four reasons this is a rule and not a preference:

- **There is no degrade path.** §12's rollback is "a missing artifact renders the legacy body".
  A Cloud SQL 500, a `57014` pool timeout or an unrefreshed matview has no such fallback; the
  figure is simply wrong or absent, on the most-trafficked page family on the site.
- **CI would depend on production.** The Playwright suite forwards `/api/db` to the DEPLOYED
  function, so every election-page assertion would ride on prod Cloud SQL being up — and the
  §9.0 vacuity problem would acquire a second, unrelated cause.
- **These pages are prerendered.** A PG-backed figure cannot appear in a prerendered body or in
  an og capture without giving the build a database dependency — the `/court/**` trap, which
  fails at exit 0 with quietly worse pages.
- **The direction of travel is the opposite.** Every precompute in this repo exists to take
  aggregates OFF the live path. Adding two round trips to `/`, every region, every municipality,
  every settlement and every section inverts that.

⚠️ **THE PLACE DIGEST IS WHERE THIS RULE GETS BROKEN, AND THE FIRST DRAFT OF §4.1 BROKE IT.**
It sourced two of its four cells from Cloud SQL, and **neither has a bucket fallback to retreat
to**:

| digest cell | source today                                                         | bucket? |
| ----------- | -------------------------------------------------------------------- | ------- |
| Парламент   | election shards / the §5.0 surface, via `dataUrl`                    | yes     |
| Местни      | the local cycle bundle, via `dataUrl`                                | yes     |
| Управление  | `useMps` → `/api/db/mp-roster`; council → `/api/db/council-overview` | **no**  |
| Потребление | `usePrices` → `/api/db/price-payload`                                | **no**  |

Both are closed doors rather than missing wiring. `useMps` was deliberately migrated OFF the
~950 KB static `parliament/index.json` to `/api/db/mp-roster` (migrations 104/111,
persons-pg-retirement-v1 T2.4), so the static file is retired. And `data/prices/` is not merely
unsynced but **REFUSED** by `bucket_sync_paths.isExcluded` — "served from Cloud SQL
(price_payloads, migration 048) — never upload it" — so there is no bucket copy to read and
creating one would be a second serving surface free to go stale.

**So the digest classifies its cells, and only two of them carry a number:**

- **Figure cells — Парламент and Местни.** Both bucket-native. This is the pair validation task 2
  depends on (mayor, council lead, whether they match), so the digest's headline value survives
  the rule intact.
- **Link cells — Управление and Потребление.** A labelled destination and no figure. This is the
  hub convention's "a missing sibling is a SKIPPED FIGURE, never a zero", applied by design
  rather than on failure: „Управление — вашите депутати и съветът" is an honest cell; a number
  fetched from Postgres to fill it is not.

**If a figure is later wanted for those two, it is BAKED, never fetched.** The repo pattern is
`db:gen-*`: a generator with database access writes a committed artifact that the bucket serves,
and the page makes no query. Two conditions on using it here — the fact's cadence must match the
artifact's (a per-parliament MP count qualifies; a **daily** price index does not, and pinning
one into a per-cycle file is the failure §4.1 already names), and the generator must skip-and-warn
without Postgres so a fresh clone still builds.

Gate: a Playwright network assertion that `/elections` and one route per migrated level issue
**no request whose path starts with `/api/db`**. Assert it on the route, not on the hook, so a
new tile added later cannot reintroduce one silently.

### 5.2 Where the election copy lives, and what it costs

The corpus is ONE flat i18next namespace partitioned across files: `src/locales/<lang>/translation.json`
is the core chunk every page downloads before it can paint (**713 KB** raw in Bulgarian), and each
deferred bundle in `LOCALE_BUNDLES` — today `["budget", "methodology"]` — ships only with the routes
tagged `withBundle(...)`. `tests/perf.spec.ts` pins per-language brotli budgets on the core chunk.

**Shared result-page copy stays in CORE unless reachability proves otherwise; hub-exclusive copy is
eligible for an `elections` bundle.** `scripts/i18n/bundles.ts` proves a key may be deferred only when
no route outside the bundle can statically reach the module that names it. After the global-home
migration, `/` no longer names election copy, but parliamentary/local result primitives are still
shared across several route families. Tag the exclusive `/elections` hub modules, run the reachability
analysis, and defer only the keys it proves exclusive. Do not move the shared outcome/status matrix
by assumption.

The matrix is the part to size before writing it, because it multiplies:

- one label per fact code, per level where the code is legal;
- one per ballot kind, and per round where a runoff can occur;
- one per map mode and per result status;
- one per standout signal, plus its baseline phrasing;
- one per absence state — "not held here", "no valid denominator", "not reconciled" — which are the
  strings this design most depends on and the easiest to leave untranslated.

So Phase 2 carries an explicit budget step:

1. enumerate the key set from the descriptor matrix and the fact/standout enums **before** writing
   copy, and record its size;
2. measure the core chunk's brotli delta in both languages;
3. re-ratchet `tests/perf.spec.ts` in the same commit, and split an `elections` bundle for copy the
   analysis proves is exclusive to the `/elections` hub/result route family; re-run
   `scripts/i18n/split_bundles.ts --apply` and keep shared result keys in core.

**Fact codes, status values, turnout bases and standout signals are enum keys, never prose in the
generated file** — a translated sentence in an artifact makes the English page the Bulgarian one
with English headings. And **write Bulgarian, not a translation of the English**: a phrase that
parses but that nobody says is the recurring failure here, and election copy is written next to
its English sibling.

Three more rules, each of which an existing gate either cannot enforce or actively contradicts.

⚠️ **`parity.test.ts` STRUCTURALLY CANNOT CATCH THE FAILURE THIS SECTION IS ABOUT, so the enum
gate is a NEW file.** That test asserts BG and EN carry the _same_ keys, the same interpolation
variables, no empty strings, and one file per key. An enum member with **no key in EITHER corpus**
satisfies every one of those clauses and renders as its own raw identifier at a 200 — the
`votes_outcome_undefined` shape. So "the locale-parity test must assert both corpora carry a key
for every enum member the generator can emit" is a gate that has to be **written**, over the enum
declarations rather than over the two corpora:

```text
src/data/elections/electionCopyCoverage.test.ts
```

It enumerates every member of `ElectionResultStatus`, `TurnoutBasis`, `BallotKind`, the fact-code
union, the standout `signal` union, the map-mode union and `ElectionDestination["reason"]`, and
fails unless BOTH corpora carry the key each one resolves to. §11's command block lists
`src/locales/parity.test.ts`; that is the corpus-symmetry gate and is not a substitute for this one.

⚠️ **The descriptor writes `labelKey` OUT beside each code; it does NOT build the key.** "Renderers
map fact codes to translations" reads naturally as ``t(`election_fact_${code}`)``, and that form
collides with a rule this plan already states for the tile registry (§6.1). `key_usage.ts` handles
a template whose static head is a family prefix, so the dead-key prune survives — but
`scripts/i18n/bundle_reachability.test.ts` is the gate that a single built key defeated on
`/governance`, where one template made all eight deferred `budget.json` `_desc` keys "reachable"
from a route that names none of them. A built key also makes the coverage gate above impossible to
write honestly, because the key set stops being statically enumerable. Write it out.

⚠️ **Almost every figure on these surfaces is a COUNT, so the plural families are the bulk of the
copy.** „12 народни представители", „51 места", „8 партии с места", „6 гласувания", „№11 от 93" —
and Bulgarian's plural rules are not English's. The corpus already carries **111 plural families**
and `src/locales/plurals.test.ts` asserts every plural call site renders a real string at count 1
and 3 in both languages. Enumerate the digest's, the strip's and the ranked result's counts as
plural families in Phase 0's key-set step, not as interpolated singulars discovered later.

No new runtime package is expected. Use the existing React Query, cmdk/search catalogs, map implementations, Tailwind primitives, i18n, Vitest, and Playwright stack. A new dependency requires a measured reason and an entry-chunk comparison.

### 5.3 Identity is a reference; a LABEL is resolved by the renderer

§5.2's "no prose in the artifact" rule is usually read as being about sentences. **It is about
NAMES too, and the corpus makes that concrete rather than theoretical.** Measured 2026-09-01:

| the thing named | what the election corpus stores                                 | where the EN form actually lives                                       |
| --------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| a party         | `name`, `nickName` — **no `name_en`** anywhere in the shards    | `canonical_parties.json`: `displayName` + `displayNameEn`, 183 parties |
| a local party   | `localPartyName: "ПП ГЕРБ"` beside `primaryCanonicalId: "gerb"` | the same file, through that id                                         |
| an oblast       | `oblastName: "PDV-00"` — a CODE, not a name                     | `data/municipalities.json` / `settlements.json` `name_en`              |
| a município     | `obshtinaName: "Пловдив"`                                       | the same two files                                                     |
| a person        | `candidateName: "Костадин Димитров Димитров"`                   | **nowhere** — see below                                                |

So a surface that stores a party's _name_ renders Cyrillic party names on every English ranked
result, at a 200, with the locale gates green — none of them looks at generated data.

**The rule: the artifact carries the ID, the renderer resolves the label.** A ballot entry carries
`nickName` / `primaryCanonicalId`, a place carries its code, and the label comes from the corpus
that owns both languages. That is the same argument as "no URLs in the blob": a generator that
emits a resolved label keeps emitting the old one after the naming rule moves, and both sides stay
green.

⚠️ **PERSON NAMES ARE THE EXCEPTION, AND IT IS A DECISION RATHER THAN AN OVERSIGHT.** MPs carry a
real `name_en` — parliament.bg's English profile, falling back to a Streamlined-System
transliteration — but mayors and local candidates carry **no English form at all**. The v1
position: **render the Bulgarian name in both languages, and do not transliterate.** A reader on
the English page is matching the name against a ballot, a protocol scan or a register, all of
which print Cyrillic; a transliteration is a name that appears in no source document. §8's mayor
and candidate panels inherit this, and the "no Cyrillic in EN" style checks must exempt person
names explicitly rather than by accident.

⚠️ **The EN place name has a BUILD-TIME producer with a silent degrade, and this plan inherits it.**
`scripts/prerender/placeNameEn.ts` resolves every English place name from
`data/municipalities.json` + `data/settlements.json` at build time. A missing or unparseable file
degrades to transliteration — which is valid Latin, so it passes a "no Cyrillic" gate — and **455
places (436 settlements + 19 municipalities whose curated `name_en` differs from the transliterated
form) silently change spelling in indexed titles**, with a stderr warning as the only signal. Phase
3 adds `/en/elections` and Phases 4–6 touch prerendered place pages, so every EN title this plan
produces rides that seam. `placeNameEn.test.ts` already asserts the build-time dictionary and
`place_dim` agree on shared codes; do not add a third producer.

## 6. Descriptor and component architecture

### 6.0 Relationship to the hub system

**`/elections` is a hub and the result pages are not.** That distinction decides which shared
primitives each side composes, and it has to be stated because the two halves of this plan look
alike and obey different written gates.

|                           | `/elections`                                   | result pages (`/elections/:date`, `/municipality/:id`, `/settlement/:id`, `/sections/:id`, `/section/:id`, `/local/**`) |
| ------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| head                      | `HubHead`                                      | `PlaceHeader`, which already carries `PlaceViewNav`; the scope bar's cycle/status sits INSIDE it (§4)                   |
| place digest              | not applicable — a hub is not a place          | `PlaceDigest`, one fact per reachable view (§4.1)                                                                       |
| owns `<h1>` and `<SEO>`   | `HubHead`                                      | the existing screen                                                                                                     |
| first substantive section | `ElectionOutcomeCanvas` for the resolved cycle | `ElectionOutcomeCanvas`                                                                                                 |
| tiles                     | a registry + bands + scenes                    | none — deeper `DashboardSection` bodies                                                                                 |
| finder                    | yes, in the head                               | see §6.2                                                                                                                |

**`/elections` composes `HubHead`.** It is the repo's one hub head (`src/ux/infographic/HubHead.tsx`,
rendered by 20 screens) and it exists because thirteen hubs had each composed their own and no
two agreed. Building a fourteenth bespoke header here is the drift that component was created
to end. Concretely, three written gates apply the moment this screen renders one:

- `src/ux/infographic/hubHead.gates.test.ts` globs `grep -rl HubHead src/screens` and **fails on
  any screen outside its `HUB_SCREENS` list** — add `/elections` in the same commit;
- the same file asserts **no screen renders both `HubHead` and `<Title>`**, because that emits two
  `h1`s. So Phase 3's "dedicated SEO title, description, canonical, H1" is satisfied _through_
  `HubHead`, not beside it;
- `tests/ui.spec.ts` "hub head — the §3.0 height budget" plus "every HubHead screen has a height
  budget" requires an entry in `HUB_HEAD_BUDGETS` carrying `maxPx`, the measured height and the
  `data-kpi-cell` count. The cell count is not decoration: a head that lost its band is
  comfortably inside its own height budget, which is how eight hubs passed a height assertion
  with zero KPI cells.

**The election exception is about ORDER, not about opting out of the head.** `dashboard-hub`
SKILL.md §3.0.1 exempts an election results front from the "no hero visual above the fold" rule
so the outcome canvas can be the first substantive section. It does not exempt the page from
having a hub head. So on `/elections` the order is: `HubHead` (eyebrow + freshness, `h1`, deck,
the cycle control from §3.1a, the KPI band) → `ElectionOutcomeCanvas` → tile bands.

**The KPI band and the outcome strip are not the same component and must not restate each
other.** The band is a corpus-level claim with a declared basis per figure; the strip is this
place's outcome. On `/elections` only one of them appears above the canvas — the band — and the
strip belongs to the result pages. Where both exist on one page, §7.1's disjointness gate binds.

### 6.1 Tile registry, scenes and bands

Phase 3's "curated entry links to analyses, reports, places, and partial local elections" is a
tile band, and it inherits the band gates the sibling hubs already carry. Add these files, and
their gate, in the same phase:

```text
src/screens/elections/electionsRegistry.ts    pure data, no JSX — BANDS with tiles NESTED
src/screens/elections/electionsScenes.tsx     id -> bespoke 300x116 SVG scene
src/screens/elections/electionsHubBands.test.ts
```

Derive `ELECTIONS_TILES = ELECTIONS_BANDS.flatMap(b => b.tiles)` rather than maintaining a
second list, so an orphan or a duplicate is unrepresentable rather than merely detectable. The
gate reads the **registry**, never the screen's source. What it must assert:

- every tile id has a scene — `InfographicTile` renders `<Scene />` unguarded, so a missing one
  is `undefined` as a component type: "Element type is invalid" and a white screen;
- no accent repeats on the **composed page**, across every registry the screen renders;
- every band has a description, and no band heading is an instruction or a container word
  („Разгледай", „Още") — a hub's headings are its table of contents;
- no band leaves a lone tile on the last `xl` row (4 columns; 4/3/4 beats 3/3/5);
- every `to` is absolute and routed, and no tile carries a per-tile CTA;
- the screen does not statically import the registry to read a constant from it
  (`src/entryGraph.test.ts`), and the registry does not build an i18n key by template.

### 6.2 The finder is a `HubSearch` configuration, not a new component

The repo already has both halves and the plan should consume them rather than restate them:

- **the rows** — `src/data/search/placeSearchItems.ts` (`buildPlaceItems`) is the single source
  of truth for how a settlement / município / Sofia район becomes a search row, and
  `SearchIndexType` in `src/data/search/useSearchItems.tsx` already types every level this
  finder needs: `s` settlement, `m` município, `d` район, `r` region, **`c` polling section**;
- **the component** — `src/ux/search/HubSearch.tsx` is the hub adapter and owns the card, the
  combobox/listbox ARIA, keyboard navigation, highlighting and the empty states. Declare sources
  in an `electionsSearch.ts` beside the tile registry.

So `ElectionPlaceFinder` is a thin configuration over `HubSearch`, not a new search surface, and
it drops out of §6's "New files" list as a component.

Two rules from the hub-search convention bind directly on this feature:

- **Scope ranks, it never filters.** Use `scopedSources()` to mint the in-scope / out-of-scope
  pair. This is exactly what the plan's "local-unavailable places" requirement needs: a place
  with no local page is an out-of-scope hit with a named label, never an absent row. „Your
  settlement does not exist" is a far worse answer than „your settlement held no local election
  in this cycle", and the destination scopes itself anyway.
- **The two halves are independent SOURCES, each with its own cap** — never one ranked scan that
  is partitioned afterwards. A partition can only surface an out-of-scope row if the ranked scan
  reached one, so the second group renders empty and the box has silently become a filter.
- **Name the second group for the scope it is outside**, never „други".

**Where the finder mounts is a budget decision, not a layout one.** Per §5's added budget line,
the fat index is ~1.76 MB raw. Options, in order of preference:

1. mount it on `/elections` only, in the `HubHead` search slot, and let result pages keep
   `PlaceHeader`'s existing place switcher;
2. mount it in `ElectionScopeBar` but build the index **lazily on open**, as the global search
   already does, so a reader who never opens it pays nothing;
3. use the slim `useAreaSearchItems` index, accepting that it carries no `c` (section) rows.

Whichever is chosen, the Phase 2 runtime gates must include a network assertion that a result
page which does not open the finder issues no place-catalog request.

Route resolution still goes through `placeViewUrl`/`localUrl`, including Sofia and city-district
special cases.

### 6.3 The outcome strip already exists — nine times

`ElectionOutcomeStrip` is in the New files list below, and the thing it describes is already
built: `PartyChangeCard` (gainer) + `PartyChangeCard` (loser) + `TurnoutCard` +
`PaperMachineCard` in a `lg:grid-cols-4`, composed identically by nine screens —
`DashboardCards`, `MunicipalityDashboardCards`, `RegionDashboardCards`,
`SettlementDashboardCards`, `SectionDashboardCards`, `SofiaDashboardCards`,
`PartyDashboardCards`, `CandidateDashboardCards` and `ProblemSectionDashboardCards`.

So this is the finder situation again: the work is to give an existing composition a contract
and a home, not to build a parallel one. Read the four cards before writing the component, and
keep them as the strip's variants.

**Two things follow, and the second is a behaviour change rather than a refactor.**

- **The strip is the same four facts at every level today.** The country page and the
  municipality page show largest gain, largest fall, turnout and paper-vs-machine alike. That is
  why the four cards can be shared by nine screens at all.
- ⚠️ **The descriptor matrix changes that.** §6's matrix declares "fact priority and maximum
  count" per `kind x level`, which means some levels will stop showing one of the four and start
  showing something else — abroad, per decision 10, loses the turnout card outright. **State
  each level's intended fact set in Phase 0 and diff it against what the nine screens render
  today**, so every removal is a decision recorded in the descriptor rather than a card someone
  notices missing after the migration. A fact that disappears from a level with no descriptor
  entry explaining it is a regression, not a simplification.

### The home dashboard is the composition precedent

`DashboardScreen` -> `DashboardCards` is the shape every place view already copies, and the plan
should extend it rather than describe a new one: a four-card strip, then `DashboardSection`s
carrying `id` / `title` / `icon` / `articleTopic`, with the votes section leading on a
`data-og`-anchored `RegionsMapTile` + `PartyResultsTile` pair. `ElectionOutcomeCanvas` is that
pair with a contract; `DashboardSection` stays exactly as it is for everything below.

⚠️ **The warning that comes with the precedent:** on `/` those four cards are national and on
`/settlement/PDV22` they are place-scoped, from the SAME components. So the scope is carried
entirely by what the screen passes in, and nothing in the component says which it received.
Every digest and strip figure must therefore come from the producer that draws the destination's
own numbers — the rule §4.1 states for the digest, and the reason the §10 matrix asks for it to
be re-derived rather than compared against a stored copy.

### New files

```text
src/data/elections/surfaceTypes.ts
src/data/elections/surfacePath.ts
src/data/elections/useElectionSurface.ts
src/data/elections/electionSurfaceAvailability.ts

src/screens/elections/ElectionsHubScreen.tsx
src/screens/elections/ElectionResultsShell.tsx
src/screens/elections/electionSurfaceDescriptors.ts
src/screens/elections/ElectionScopeBar.tsx
src/screens/elections/electionsSearch.ts          # HubSearch sources — see §6.2, not a new component
src/screens/elections/electionsRegistry.ts        # see §6.1
src/screens/elections/electionsScenes.tsx         # see §6.1
src/screens/elections/ElectionStatusRow.tsx
src/screens/elections/PlaceDigest.tsx               # one fact per reachable view — see §4.1
src/screens/elections/placeDigestFacts.ts           # the per-view selectors, pure
src/screens/elections/ElectionOutcomeStrip.tsx      # ⚠️ nine existing copies — see §6.3
src/screens/elections/ElectionOutcomeCanvas.tsx
src/screens/elections/ElectionRankedResult.tsx
src/screens/elections/ElectionMapPanel.tsx
src/screens/elections/ElectionStandouts.tsx
src/screens/elections/ElectionSourcePanel.tsx
src/screens/elections/ElectionSurfaceBoundary.tsx
```

### Descriptor matrix

`electionSurfaceDescriptors.ts` is a pure-data, exhaustive matrix keyed by `kind × level`. It declares composition, not numbers:

- active ballot(s) and their label;
- default map question and allowed mode labels;
- fact priority and maximum count;
- ranked-result columns;
- deeper section order;
- absence/empty-state copy;
- whether a finder, official protocol, or child-place preview is available.

The matrix must be type-exhaustive. A new election kind or level should fail TypeScript until it has a descriptor.

Do not build a universal component with dozens of optional props. `ElectionResultsShell` owns order and accessibility; descriptor-selected adapters provide parliamentary/local differences.

### Adapters

`ElectionMapPanel` wraps existing map tiles through typed slots rather than reimplementing maps. Initial adapters:

- parliamentary country → `RegionsMapTile`;
- parliamentary region/abroad → `RegionMunicipalitiesMapTile`;
- parliamentary municipality → existing municipality/section map variants;
- parliamentary settlement → `SectionsMapTile`;
- local country → two `LocalRegionsControlMapTile` modes;
- local region → existing local municipality-control map;
- local municipality → mayor/council section maps where data exists;
- local settlement → contest-appropriate parent/section geography;
- a single section → no decorative map.

`ElectionRankedResult` owns accessible list/table semantics. It supports party votes/seats, mayor candidates/margin/round, and council votes/seats as explicit variants.

⚠️ **The map slot has an accessibility contract, and it is TWO props that must travel together.**
`FeatureMap` derives keyboard access as `const keyboard = !!ariaLabel && !!onClick` — and
`tabIndex`, `role="button"`, `aria-label`, `onKeyDown` and the `kbd-focus-ring` class are ALL
gated on that one boolean. So a region wired for selection but missing its `ariaLabel`, or given
selection through some other mechanism, is silently **mouse-only**: nothing renders half-done,
nothing looks wrong, and §10's "map/list selection has keyboard support" quietly becomes an
aspiration.

Each adapter therefore declares one of exactly two postures, and the descriptor records which:

- **interactive** — every selectable feature passes BOTH `ariaLabel` and `onClick`, so it is
  focusable, named, operable by keyboard and visibly focused. Its selection is bound to the
  ranked list in both directions.
- **presentational** — `role="img"` with a single `aria-label` naming what the map shows, and no
  per-feature interaction, the posture `EuChoroplethMap` already takes. This is a legitimate
  answer for a map that illustrates rather than selects; it is not a licence to skip the ranked
  list, which §4 requires regardless.

A third state — features that respond to a mouse and not to a keyboard — is the defect, and it is
what an adapter produces by default if nobody states the posture.

**Reduced motion reaches the map through its own rule.** `src/index.css` carries the global
`prefers-reduced-motion` block, but map libraries animate outside it — `VoteFlowSankey` ships an
inline override for exactly this. A panel that animates zoom, pan or a mode transition needs the
same, or the global preference is honoured everywhere except the largest moving thing on screen.

### Finder

Configured, not built — see §6.2 for the `HubSearch` + `scopedSources()` composition, the
`placeSearchItems` rows and the index-payload decision. The behavioural requirements:

- Results are grouped by region, municipality, settlement, and section.
- The current election kind and cycle are preserved when a destination exists.
- Local-unavailable places surface as an out-of-scope group with a named label, never as an
  absent row and never as a link to an empty page.
- Abroad search is parliamentary-only.
- Selecting a polling section while switching kind explicitly announces the settlement fallback.
- A "see all" is shipped only where the destination reads the query param.

## 7. Standout selection rules

Implement pure selectors in `scripts/elections/standouts.ts` with fixture tests. Selection happens at generation time.

Priority slots:

1. outcome/change — winner margin, lead change, threshold/majority, split control, runoff;
2. participation/competition — turnout change where the denominator is valid, unusually close contest, unusually fragmented council;
3. review — only a documented existing review signal with a direct evidence destination.

Rules:

- emit at most one standout per category;
- prefer a material local fact over a weaker national comparison;
- require a minimum sample size appropriate to the metric;
- include the actual comparison group and cycle in the baseline;
- suppress turnout comparison when `turnoutBasis === "unavailable"`;
- suppress a review signal if the evidence leaf is absent for that cycle/scope;
- use neutral copy: “stands out”, “differs from”, “flagged for review”; never “fraud”, “manipulation”, or causal language;
- Benford-only output never receives a headline slot;
- deterministic tie-breaking is metric, then sample size, then stable place/result ID.

**Numeric thresholds are frozen in Phase 0, not "in the implementation phase".** A threshold
chosen while fitting fixtures is a threshold fitted to the corpus: whoever writes the selector
will pick the value that makes the sample look right, and the review that follows cannot tell
that from a value chosen on the merits. Every threshold therefore lands in
`docs/methodology/election-surfaces.md` with the reasoning **before** `standouts.ts` is written,
and the file is what the selector and the source panel both read.

Each threshold is recorded with four fields, because a bare number is not reviewable:

| field            | what it answers                                                                                             |
| ---------------- | ----------------------------------------------------------------------------------------------------------- |
| value            | the number itself, with its unit                                                                            |
| basis            | why this value and not one 20% either side — a distribution, a statutory line, a reader-legibility argument |
| minimum sample   | below which the signal is suppressed rather than emitted at low confidence                                  |
| what it excludes | the cases this value deliberately drops, so a later widening is a decision and not a bug fix                |

The set to freeze in Phase 0, at minimum: the margin below which a contest is "close"; the
turnout change that counts as a departure and the minimum registered-voter base beneath it; the
council-fragmentation index and its floor; the minimum section count for any section-derived
signal; and, for every review signal, the existing published threshold it inherits — a review
lead must not invent a second definition of a flag the reports already publish under a
different one.

Two consequences: the thresholds are exposed in the source panel because a reader cannot judge
"stands out" without them, and a threshold change requires a fixture update **and** an edit to
the methodology file in the same commit. `standouts.ts` importing its constants from a module
whose header points at that file is the cheapest way to keep the two from drifting.

### 7.1 A figure appears once per screen

The surface has three figure-bearing regions on one screen — the strip (at most four facts), the
ranked result, and the standouts (at most three) — and on `/elections` a `HubHead` KPI band as
well. Nothing in the contract stops "winner margin 6.2 pts" appearing in all of them, and the
same number rendered twice on one page reads as two different facts.

The rule, and the gate:

- **the strip and the standouts are disjoint by fact code**;
- **no standout restates the ranked result's first row** — a standout whose metric is the
  winner's share or margin is suppressed at generation time, because the canvas already says it;
- **on `/elections`, no KPI band value equals a tile metric on the same page**, and no two KPI
  cells share a destination. These are the sibling hubs' existing gates and they apply
  unchanged;
- where a figure genuinely belongs in two places, it is removed from the **weaker** one: the
  band carries a declared basis and sits above the fold, so it wins over a tile metric; the
  canvas is the page's answer, so it wins over a standout.

## 8. Level-by-level composition

| Level        | Parliamentary lead                                                                  | Local lead                                                                          | Required deeper links                                                   |
| ------------ | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Country      | party votes, seats, winner/margin map, threshold/wasted vote, valid turnout         | separate mayor-control and council-support modes, runoffs, split control            | regions, municipalities, analyses, reports, partial elections           |
| Abroad       | party votes, total votes cast, countries/cities, voting mode; no turnout percentage | unavailable with explanation                                                        | countries/cities/sections and source guidance                           |
| Region       | party result/change, MPs/candidates, municipality map                               | mayor control and council control by municipality, runoffs/split control            | all municipalities and full leaderboards                                |
| Municipality | party result/change/preferences and child-place map                                 | elected mayor or runoff pair plus council seats/majority; split control explicit    | full mayor result, full council result, settlements/districts, sections |
| Settlement   | party result/change and leading sections                                            | own settlement-mayor contest only when held; parent council clearly labeled context | section list, full parent context, source                               |
| Section      | ranked parliamentary result and protocol/audit context                              | separate mayor/council/district ballot panels only when data exists                 | official protocol, scan/video, parent settlement                        |

At section level, a missing ballot is “not held/not available”, not zero votes. Mayor and council totals are never added.

Every party, place and office label on this table is resolved from an ID at render time, never
stored as a name in the artifact (§5.3). Mayor and candidate names render in Bulgarian in both
languages and are not transliterated — that is the v1 decision, not a gap.

## 9. Delivery phases

Each phase ends with targeted tests, a focused code review of only that phase, repair of all valid findings, and a separate commit. Do not start the next phase with known defects.

Critical path:

```text
definitions → generated data → runtime primitives → /elections
                                          ├→ country/region
                                          ├→ municipality
                                          └→ settlement/section
all migrated levels → measured reduction → optional URL study
```

The data generator is the only hard blocker for production migration. SEO/OG work for `/elections`, fixture-based component work, and finder/navigation tests can proceed after the schema freezes, but none should merge with invented fixture-only facts in the live route.

### 9.0 Publication, and why every browser gate is vacuous without it

**CI fetches election data from the live production bucket.**
`.github/workflows/test.yml` sets `VITE_DATA_BASE_URL: https://storage.googleapis.com/data-electionsbg-com`
on the Build step, and `public/` carries no election symlink — only `myarea` and `procurement`.
So a Playwright run reads whatever is in the bucket at that moment, not what is on the branch.

Combine that with `ElectionSurfaceBoundary`'s legacy fallback and the failure mode is exact:
**until an artifact is published, every gate in Phases 2 to 6 passes while rendering the legacy
body.** The plan's own runtime gate — "a missing/corrupt surface falls back without an empty
first screen" — is _satisfied_ by that state. Nothing is red. Nothing has been tested.

Three rules, and none is optional:

1. **Publication is a numbered step inside the phase that generates the artifact**, before that
   phase's browser gates run. Not §12 step 1 in the abstract, and not "at rollout".
2. **Every browser gate over a migrated level carries an anti-vacuity assertion.** Assert a
   marker the shared shell renders and the legacy body cannot — a `data-surface-shell="<level>"`
   attribute on `ElectionResultsShell`'s root — and assert it is **present**, not merely that
   the page rendered something. A gate that only checks "the ranked result precedes the map" is
   satisfied by a legacy page that happens to be ordered that way.
3. **A boundary fallback is logged and counted, never silent.** `ElectionSurfaceBoundary` emits
   one console warning per process naming the level and the reason (absent / wrong
   `schemaVersion` / malformed), and the Playwright suites fail on that warning for any level
   already migrated. That log, not latency, is how an operator learns the sync never ran.

The publication commands, and the three files that have to know about a new `data/**` path:

```bash
npm run bucket:sync:paths -- --dry-run <cycle>   # read the object count before writing it
npm run bucket:sync:paths -- <cycle>
npm run bucket:gz                                # only if a new file joins the hot list
```

- `scripts/bucket_sync_paths.ts` — `isExcluded` guards the top-level ARGUMENT and
  `CHILD_EXCLUDES` guards the subtree; a scoped sync walks into subtrees, so both halves have
  to agree about a new path. Confirm the existing per-cycle behaviour already covers
  `data/<cycle>/surface/` before adding anything, and say so in the commit.
- `scripts/bucket_gzip.ts` — `PER_ELECTION_FILES` is the per-cycle hot list
  (`candidates.json`, `national_summary.json`, `region_votes.json`, `sections_index.json`). A
  country surface belongs there; 12,721 section surfaces do not (the shard-size threshold
  exists for exactly this).
- `scripts/db/refresh_coverage.ts` — `UPLOAD_PUBLISHED_ARTIFACTS` plus
  `npm run db:check-generated`, which byte-compares a committed artifact against the bucket and
  prints its own remedy. A new artifact reports `404 — the artifact has NEVER been published`,
  which is the state this section exists to make visible.

The precedent is not hypothetical: `culture/derived/hub_stats.json` shipped committed, with its
generator in the chain and every gate green, while the bucket object returned **404 for two
days** and the hub drew its tiles with no numbers at a 200.

### Phase 0 — definitions and executable prototypes

**Prerequisite, before any Phase 0 work:** commit
`src/screens/dashboard/electionsResultsFirst.gates.test.ts`. It is currently **untracked**, and
Phase 4 step 7 upgrades it — a plan cannot upgrade a baseline that is not in the repository.

**Goal:** remove ambiguity before data generation or route changes.

Work:

1. Add `surfaceTypes.ts` with the discriminated contracts above.
2. Add `electionSurfaceDescriptors.ts` for every kind/level combination.
   3a. Freeze the **place digest**: which fact each of the four views contributes, its basis, its producer, and the `reason` enum for an unreachable view (§4.1). Decide and record **where each half is served from** — the election facts on the surface, the governance and consumption facts on their existing hooks or one place-digest route — because their refresh cadences differ by orders of magnitude and one file with two cadences is the failure.
   3b. Diff each level's intended fact set against what the nine existing dashboard-card screens render today (§6.3), so every card the descriptor drops is a recorded decision.
   3c. Freeze the **copy contract** (§5.2, §5.3): every enum member's `labelKey` written OUT beside the code rather than built by template; the counts enumerated as PLURAL families; and the list of things carried as an ID whose label the renderer resolves (party, place, office), with person names recorded as the deliberate Bulgarian-in-both-languages exception.
3. Freeze status vocabulary, turnout bases, fact priority, standout categories **and every numeric standout threshold** in `docs/methodology/election-surfaces.md`, each threshold carrying value, basis, minimum sample and what it excludes (§7). Thresholds are a Phase 0 design decision precisely because deferring them means fitting them to the fixtures.
4. Create static fixture payloads for:
   - parliamentary country;
   - parliamentary abroad;
   - local country;
   - local municipality with runoff and split control;
   - local settlement without its own mayoral ballot;
   - section with multiple local ballots;
   - a municipality with all four views reachable, and one with no local cycle (the three-cell digest).
5. Build an isolated `ElectionResultsShell` component story/test page using fixtures at 390 px and 1440 px.
6. Validate the four research tasks with internal walkthroughs before generator work.

Tests/gates:

- exhaustive descriptor type test;
- schema invariant tests;
- DOM-order test: ranked result before map;
- keyboard focus order and visible focus;
- map alternative/list always present;
- no more than four facts and three standouts;
- the digest renders one cell per REACHABLE view and omits the rest — never a zero, never a dead link;
- the digest and the outcome strip never render the same figure on one page;
- every enum member the contract can emit resolves to a key present in BOTH corpora (`electionCopyCoverage.test.ts` — `parity.test.ts` cannot see this, §5.2);
- no i18n key is built by template anywhere in the descriptor or the registry;
- every map adapter declares an `interactive` or `presentational` posture, and an `interactive` one passes both `ariaLabel` and `onClick` for every selectable feature (§6);
- the fixture shell passes an axe run at 390 px and 1440 px in both themes;
- contrast check in light/dark mode.

Exit criterion: product/design accepts the country and municipality grammar and the schema can represent every level without generic `unknown` payloads.

### Phase 1 — generated surface data

**Goal:** produce small, deterministic projections before any production page consumes them.

New script files:

```text
scripts/elections/build_surfaces.ts
scripts/elections/build_parliamentary_surface.ts
scripts/elections/build_local_surface.ts
scripts/elections/standouts.ts
scripts/elections/source_links.ts
scripts/elections/surface_budget.test.ts
scripts/elections/build_surfaces.test.ts
scripts/tests/election/surfaces.data.test.ts
```

Integration:

1. Parliamentary country generation reuses `generateNationalSummary` outputs.
2. Parliamentary subnational generation reads canonical shards and prior-cycle stats once in Node; it replaces the headline computation currently repeated in `useRegionSummary`, `useMunicipalitySummary`, `useSettlementSummary`, and `useSectionSummary`.
3. Local country/region generation runs after `buildLocalRollups` and projects the already-built index, region summaries, leaderboards, and municipality rows.
4. Local municipality/settlement/section generation reads one canonical municipality/section bundle at a time and releases it; do not hold the full local corpus in memory.
5. Add `--election-surfaces` and optional `--date`/`--local-date` wiring in `scripts/main.ts`.
6. Invoke the relevant surface build at the end of parliamentary summaries and local rollups. Keep the standalone flag for repair/rebuild.
7. Add the new JSON name/path to bucket upload and gzip rules only after confirming the existing cycle subtree wildcard does not already include it.

Data gates:

- schema and version valid for every emitted file;
- output facts reconcile exactly to canonical vote/protocol/seat totals;
- local mayor and council denominators remain distinct;
- an elected mayor resolves to the decisive round;
- settlement surfaces never attribute a parent council as a settlement office;
- `region/32` has no turnout percentage and declares `turnoutBasis: "unavailable"`;
- every standout evidence route/file exists;
- every `ElectionDestinations` route resolves to a live route, and every `available: false` carries a `reason` key present in both locales;
- `destinations.views` availability agrees with what `PlaceViewNav` would render for the same place — the two must not disagree about whether a view exists;
- every map mode is allowed by the data available at that scope;
- artifact budgets pass for the largest country, municipality, settlement, and section cases;
- **§5.0's emit column is re-measured against generated output**: every `no` level is confirmed still inside its budget, every `yes` level shows the reduction that justified it, and a level whose artifact is no smaller than the file it replaces is dropped from the generator;
- **the object-count delta is recorded** per cycle and per level, and is inside the bound §5.0 sets;
- deterministic rebuild produces byte-identical JSON. `status.updatedAt` is therefore taken from the source file's mtime or the ingest ledger and **never stamped at generation time** — a generator that reads the clock either fails this gate or makes it vacuous.

Publication (step 8, and part of this phase per §9.0):

8. Dry-run the scoped sync, read the object count, then sync `data/<cycle>/surface/` for every generated cycle and confirm the objects are served. `npm run db:check-generated` for any artifact that joins `UPLOAD_PUBLISHED_ARTIFACTS`.

Exit criterion: the emitting cycles generate valid artifacts, the latest cycles pass reconciliation and size gates, **and the artifacts are readable from the bucket** — verified by fetching one country, one municipality and one section URL, not inferred from a green build.

### Phase 2 — shared runtime primitives

**Goal:** land the shell and adapters behind data-availability fallbacks without changing public composition.

Work:

1. Implement `surfacePath.ts` and `useElectionSurface.ts` using `dataUrl` and React Query.
2. Implement `ElectionSurfaceBoundary`; it renders the new surface only for `schemaVersion === 1`, otherwise the existing composition.
3. Implement scope bar, finder, status row, strip, canvas, ranking, standouts, and source panel. The strip ADOPTS the nine existing four-card compositions rather than replacing them (§6.3); the scope bar's cycle/status composes into `PlaceHeader` rather than stacking a second control row under `PlaceViewNav` (§4).
   3b. Implement `PlaceDigest` + `placeDigestFacts.ts` (§4.1): pure per-view selectors, each reading the producer that draws its own view's numbers, each returning `undefined` — not zero — for an unreachable view.
4. Reuse existing maps through adapters; do not import Leaflet/d3/recharts into the shell module.
5. Add loading skeletons with fixed dimensions matching the final ranking/map layout, each on a container carrying `aria-busy` while it resolves. "No layout shift when the map arrives" is a VISUAL gate; without `aria-busy` the skeleton→content swap — and `ElectionSurfaceBoundary`'s legacy-fallback swap — is silent to a screen reader. The repo already uses `aria-busy` and `aria-live`; do not invent a third pattern.
   5b. Pass `headingLevel={2}` on every `DashboardSection` on a migrated screen, and give every one of the seven regions a landmark name (§4.0).
6. Add Bulgarian and English keys per §5.2: enumerate the key set from the descriptor matrix and the fact/standout enums first — **counts as plural families**, `labelKey`s written out rather than built — measure the core chunk's brotli delta in both languages, and re-ratchet `tests/perf.spec.ts` in the same commit (or split an `elections` bundle if the delta needs a lever). Ship `electionCopyCoverage.test.ts` in this commit; `parity.test.ts` and `plurals.test.ts` are corpus-symmetry and call-site gates and neither covers enum coverage. Keep long existing analysis copy in its current bundles.
   6b. Resolve every party, place and office LABEL from its id at render time (§5.3). No name reaches the artifact.

Runtime gates:

- one surface fetch produces identity facts/ranking/status/standouts;
- **anti-vacuity: the shell's `data-surface-shell="<level>"` marker is PRESENT** on every level under test, so a run that silently rendered the legacy body fails instead of passing (see §9.0);
- a missing/corrupt surface falls back without an empty first screen, **and logs the reason once per process**;
- a result page that does not open the finder issues no place-catalog request (§6.2);
- map modules stay lazy and absent on the section composition;
- screen-reader labels include value, unit, candidate/party, and basis;
- selected map feature is reflected in the ranked list and vice versa;
- no layout shift when the map arrives.

Exit criterion: fixture and live-data component tests pass while every production page still renders its legacy composition — and the live-data tests are demonstrated to be reading the published artifact rather than falling back, by breaking the marker assertion once and watching it fire.

### Phase 3 — `/elections`, combined navigation, and route artifacts

**Goal:** establish the unified entry without moving any result URL.

Route/UI work:

1. Add a static `elections` route in `src/routes.tsx`, lazy-loading `ElectionsHubScreen`. (React Router v7 ranks a static segment above `elections/:date` on its own, so declaration order is belt-and-braces rather than a constraint — do not treat it as load-bearing.)
2. `ElectionsHubScreen` renders `HubHead` per §6.0 — eyebrow + freshness, `h1`, deck, the cycle control, and a 3–5 figure KPI band with a declared basis per figure. It must **not** also render `<Title>`. Add the screen to `HUB_SCREENS` in `src/ux/infographic/hubHead.gates.test.ts` and to `HUB_HEAD_BUDGETS` in `tests/ui.spec.ts` in this commit, with the measured height and `data-kpi-cell` count.
3. `/elections` resolves its cycle per §3.1a — `?elections` first, latest event as the fallback, the resolved cycle named in the scope control. It offers Parliamentary/Local selection with explicit dates/status, and selection navigates to the existing canonical full result (`/elections/:date` or `/local/:cycle`) writing `?elections`, not a hidden client-only result state.
4. The lead area uses one outcome canvas for the resolved cycle, not two simultaneous maps. A compact adjacent link exposes the other election kind.
5. Add the finder (a `HubSearch` configuration per §6.2, in the head's search slot) and the tile bands from the `electionsRegistry` per §6.1, below the outcome canvas. Ship `electionsHubBands.test.ts` in this commit.
6. Merge `electionsMenu` and `localMenu` in `src/layout/header/reportMenus.ts`; update `Header.tsx` to render one Elections top-level item at `/elections`. Preserve all election destinations, grouped as Results, Places, Analysis and review, and Partial/local administration. **Two things the merge must decide explicitly rather than by omission:** remove the old `/` election leaf because root is the global home reached through the logo/home navigation, and do not absorb `localMenu`'s `/governance/mayor-pay` governance leaf into Elections by accident.
7. Keep the current Parliamentary and Local pills in `PlaceViewNav` in v1; the shared `ElectionScopeBar` provides the family relationship. Re-evaluate pill consolidation only with the optional URL migration.

Artifact work in the same commit:

1. Add `/elections` to `scripts/prerender/routes.ts` via `staticPage({...})` with an `english:` block — no leading or trailing slash on `path`, and the EN root convention is `/en`, never `/en/`. Write a real `bodyHtml`: it is the only part of the page a crawler that runs no JS ever sees.
2. Add the path to **both** lists in `scripts/sitemap/route_defs.ts` — `routeDefs(year)` for the Bulgarian `<loc>` and `ENGLISH_STATIC_PAGES` for `/en/elections`. They are not derived from one another, and the EN list alone gets the mirror indexed and not the original (the live `/sofia/*` and `/consumption/*` class). Point `file:` at the artifact the page renders, e.g. `data/${year}/national_summary.json`, not at `ElectionsHubScreen.tsx`, or `lastmod` is the date somebody last touched the JSX — and note that a `file:` which does not exist **skips the entry silently**. Then run `npm run sitemap` and COMMIT `public/sitemap*.xml`; the command is manual and its output is committed, so the entries alone change nothing.
3. Add dedicated SEO title, description, canonical, H1, and indexable body — via `HubHead`, which owns the `h1` and the `<SEO>`. The deck and the SEO description are different sentences written for different readers; do not write one and reuse it as the other.
4. Add a dedicated `public/og/elections.png` capture in `scripts/og/capture-screens.ts`, anchored on a `data-og` attribute (a class name gets renamed silently by a refactor) on the head, with a `waitFor` naming something that exists only after the data loads — a head shot before its numbers arrive is a screenshot of a skeleton. Then **open the PNG and look at it**; a capture reports success on any 1200x630 clip it managed to take.
5. Add `/elections` to `scripts/og/capture_routes.test.ts`, `scripts/prerender/ogAndSitemapCoverage.test.ts`, and `tests/seo.spec.ts` with a `minBodyChars` — the suite checks body length only for routes listed there.
6. Add a direct header link, retain the global home's `/elections` tile/contextual link, and add at least one contextual link from `/local/:cycle` so reachability does not depend on the sitemap.

Ordering within the phase: the og capture and `npm run sitemap` run **before** `npm run build`, because `vite build` copies `public/` into `dist/` — run them after and they ship one deploy late. Both are the steps that get skipped, because neither is wired into anything.

Exit criterion: `/elections` is unique, indexable, reachable, bilingual, has a `<loc>` in the committed sitemap in both languages and an `og:image` that resolves to a file on disk, and all existing election links still resolve to their original destinations.

### Phase 4 — country and region migration

**Goal:** make the most-used levels consistently results-first. The parliamentary country composition that formerly lived at root is now owned by `/elections`; root itself is not an election migration target.

Parliamentary files:

- `src/screens/DashboardScreen.tsx` (the preserved `/elections` country composition; rename to `ElectionsCountryScreen` when doing so improves ownership clarity);
- `src/screens/ElectionScreen.tsx`;
- `src/screens/dashboard/DashboardCards.tsx`;
- `src/screens/MunicipalitiesScreen.tsx`;
- `src/screens/dashboard/RegionDashboardCards.tsx`.

Local files:

- country branch in `src/screens/LocalElectionScreen.tsx`;
- `src/screens/dashboard/local/LocalCountryDashboardCards.tsx`;
- `src/screens/LocalRegionDashboardScreen.tsx`;
- `src/screens/dashboard/local/LocalRegionDashboardCards.tsx`.

Work:

1. Compose the scope bar's cycle/round/status INTO the `PlaceHeader` block (§4) — it must not become a second control strip beneath the `PlaceViewNav` pills. Measure the combined header at 390 px before and after.
   1b. Render `PlaceDigest` directly beneath the header, above the outcome strip, on every migrated level (§4.1).
2. Replace the legacy KPI row and first votes section with `ElectionResultsShell` backed by the surface artifact.
3. Preserve all current deeper sections after standouts; remove only numbers duplicated by the new strip/canvas.
4. Parliamentary country/region lead with winner+margin map and ranked party result.
5. Local country/region expose Mayor and Council as explicit modes with independent legends, totals, and ranked equivalents.
6. Abroad uses the parliamentary region adapter, total votes cast, country/city ranking, and no turnout fact/card.
7. Upgrade `electionsResultsFirst.gates.test.ts` from legacy source scanning to rendered shell/descriptor assertions; retain a route-level anti-vacuity test.

Digest gate: on a municipality with all four views reachable, the digest renders four cells; with no local cycle it renders three and names why; and the strip does not repeat the cell for the view the page is already on.

Publication and vacuity (§9.0): the country/region/abroad artifacts for the cycles under test are in the bucket before this phase's browser gates run, and each migrated route asserts `data-surface-shell` is present, so a run that silently fell back to the legacy body fails.

Exit criterion: country, region, and abroad pass the shared result-first gates **while demonstrably rendering the shared shell**, and every old deep result/analysis remains reachable within one click from its migrated page.

### Phase 5 — municipality migration

**Goal:** answer the highest-value local question without flattening the ballots.

Files:

- `src/screens/SettlementsScreen.tsx`;
- `src/screens/dashboard/MunicipalityDashboardCards.tsx`;
- municipality branch in `src/screens/LocalElectionScreen.tsx`;
- local mayor/council compact tiles and maps under `src/screens/dashboard/local/`.

Work:

1. Parliamentary municipality: lead with ranked party result and child geography; preferences remain directly below when available.
2. Local municipality: show the decisive mayor result or runoff pair first, including margin and current/by-election status.
3. Render council composition separately with seats, majority threshold, lead group, vote share, and full-results link.
4. Emit and render a split-control standout when mayor and leading council group differ. **The digest's Местни cell states the same thing in one line** — mayor, council lead, and whether they match — so the two must be produced once and read twice, never computed separately.
   4b. ⚠️ **Gate that the digest's mayor and council figures re-derive from the producer the Местни tab itself renders**, not from a stored copy and not from a second resolver. This is the phase where the failure is worst: a digest naming one mayor while the tab one click away names another is wrong about a named individual, renders at a 200, and no row count moves.
5. Keep district mayors, settlement mayors, council members, trends, officials reconciliation, and section analysis below the shared surface.
6. Preserve Sofia city/rayon and Plovdiv/Varna district behavior through existing catalogs and adapters.

Publication and vacuity (§9.0): the local municipality/settlement artifacts — the levels §5.0's measurements most justify, at 58 KB for `BGS01` against a 16 KiB budget — are published before this phase's browser gates run, and every migrated route asserts the `data-surface-shell` marker.

Exit criterion: task 2 — “Who is mayor, which group leads the council, and are they the same?” — is answerable without scrolling on 390 px and 1440 px for outright, runoff, split-control, independent, and city-district fixtures, on the shared shell rather than the fallback.

### Phase 6 — settlement and section migration

**Goal:** make ballot availability and official evidence unambiguous at the finest levels.

Files:

- `src/screens/SectionsScreen.tsx`;
- `src/screens/dashboard/SettlementDashboardCards.tsx`;
- `src/screens/SectionScreen.tsx`;
- `src/screens/dashboard/SectionDashboardCards.tsx`;
- `src/screens/LocalSettlementDashboardScreen.tsx`;
- `src/screens/dashboard/local/LocalSettlementDashboardCards.tsx`;
- `src/screens/LocalSectionScreen.tsx`.

Work:

1. Parliamentary settlement keeps ranked result before sections map on mobile and provides leading-section preview and complete list.
2. Local settlement renders its own settlement-mayor contest only when the ballot existed. Otherwise render a plain explanation and a clearly labeled parent-municipality council context.
3. Parliamentary section removes decorative geography and leads with result, address, risk/review context, and official scan/video/protocol links.
4. Local section renders separate compact panels for council, municipality mayor, and district mayor only when each vote array/denominator exists.
5. Do not infer zeros for absent arrays or unavailable older-cycle ballots.
   5b. Render no `PlaceDigest` on a polling section: three of the four views do not resolve there, so a one-cell digest is chrome (§4.1).
6. Kind switching from a section falls back to the settlement and announces why section codes do not map reliably between election kinds/cycles.
7. Add source-link reconciliation tests for CEC protocol, scan, video, and download URLs.

Publication and vacuity (§9.0): parliamentary section artifacts are the one new route-sized family (§5.0), so this phase carries the largest object-count delta — dry-run the scoped sync, record the count, publish, then run the browser gates with the `data-surface-shell` assertion. Local sections publish as a `surface` key on the existing per-station file and need no new objects.

Exit criterion: task 4 — open the official protocol for a station — succeeds from both parliamentary and local section pages, no page combines unlike ballots, and both section compositions render the shared shell rather than the fallback.

### Phase 7 — progressive reduction and analysis integration

**Goal:** reduce repetition after the shared surfaces prove useful, without deleting depth.

Work:

1. Instrument clicks from surface facts, map/list selections, standouts, finder, and “see all” links using the existing analytics seam if present at implementation time; do not add a vendor solely for this feature.
2. Run the four research tasks with at least five readers across phone and desktop, including one keyboard-only walkthrough.
3. Use findings to remove duplicate KPI bands and repeated charts. Every removal requires an existing reachable complete-results destination and a regression test for it.
4. Reorder deeper sections consistently: Outcome detail → Geography → Comparison/history → People/representation → Review signals → Data/method.
5. Keep `DashboardSection` for deep content; do not turn the result surface into the ordinary hub tile registry.
6. Add a short methods disclosure explaining standout selection, limitations, and result status.

Exit criterion: primary-task completion improves or remains stable, no evidence destination loses reachability, and the first viewport meets the information budget at every level.

### Phase 8 — optional URL migration, separately approved

This phase is not part of v1 shipping and must not begin automatically.

Evaluate `/elections/:kind/:cycle/<scope>` only after all existing surfaces have parity. A migration proposal must include:

- old→new route table for every scope and special case;
- redirect/canonical behavior;
- full internal-link rewrite;
- prerender count and build-time impact;
- both sitemap producers and committed artifact regeneration;
- per-family OG strategy;
- search-index and external-link risk;
- rollback redirects;
- a measured reason the cleaner URLs justify the migration.

## 10. Cross-cutting test matrix

### 10.0 The accessibility gate — the one section that had requirements and no owner

⚠️ **There is no automated accessibility gate anywhere in this repository.** Audited 2026-09-01:
no `axe-core`, `@axe-core/playwright`, `pa11y` or lighthouse dependency, and `tests/ui.spec.ts`
contains **zero** `aria-` or `getByRole` assertions. So every accessibility line below is a human
step, in a plan that now names a gate file for the emission test, the copy coverage, the bucket
rule, the digest and the band rules.

That asymmetry is the defect. Accessibility requirements degrade the same way the figure rules
do — silently, under a green suite — and the manual instruction in §11 ("inspect light/dark mode
and keyboard traversal") is the weakest enforcement in the document.

The gate is two parts, because they catch disjoint things:

```text
tests/a11y.spec.ts     # an axe pass per representative route, in the desktop AND mobile projects
```

- **The axe pass** covers what a rule engine can see: contrast, names on interactive elements,
  duplicate landmarks, invalid ARIA, form labelling. Run it over the §10 representative route
  list, not over one page. Introducing it repo-wide is out of scope; introducing it for the
  routes this plan touches is not.
- **Four hand-written assertions cover what axe cannot**, because each is about meaning rather
  than markup:
  1. heading order across the COMPOSED shell — one `h1`, then the migrated sections as `h2`,
     with no skipped level (see §4's `headingLevel` note, which is why this can fail);
  2. selecting a map feature updates the ranked list and vice versa, driven from the KEYBOARD;
  3. focus is retained, not reset, across a mode or cycle change that does not navigate;
  4. every party colour rendered on the page passes contrast in both themes, or its row carries
     the text/pattern fallback.

**Then check the gate can fail.** Break each clause and watch it fire — an axe pass configured
against the wrong selector reports zero violations exactly like a clean page.

### Data correctness

- national totals equal the sum of canonical region totals;
- preview ranking is a stable prefix of the complete ranking;
- winner, runner-up, margin, seats, and majority threshold reconcile;
- current and prior cycles use the same party/candidate identity rules as existing summaries;
- local elected winner comes from resolved decisive round;
- council seat totals match elected mandates;
- independent/local-only groups retain their existing canonical buckets;
- status and update time come from source/ingest metadata, not browser time;
- no abroad turnout without an approved basis;
- absent ballot and zero-vote ballot are distinct;
- no artifact stores a party, place or office NAME — only ids the renderer resolves (§5.3);
- every digest cell re-derives from its own view's producer and equals what that view renders — mayor name, council lead, MP count and price rank are compared against the destination, never against a stored copy;
- `status.reconciliation` is present iff an `officials_diff` sidecar exists for that município and cycle, and `agrees` re-derives from the sidecar; its absence never renders as agreement.

### Component/accessibility

- one H1 and logical H2 order;
- the combined `PlaceHeader` (identity + `PlaceViewNav` + cycle/status) is inside its measured height budget at 390 px, and does not stack two control strips above the first figure;
- every enum the contract emits resolves to a rendered string in BOTH languages — no raw identifier reaches the DOM at any level;
- every count renders through a plural family that resolves at count 1 and 3 in both languages (`plurals.test.ts`'s contract);
- the scope bar's cycle label uses `formatDate` (UTC-pinned) and never the election folder id, verified under a `TZ` west of UTC;
- EN pages render party and place names from the English corpus, and person names in Bulgarian by design (§5.3);
- an axe pass over every representative route, in the desktop and mobile projects (§10.0);
- every migrated screen passes `headingLevel={2}`, so the composed outline is h1 → h2 with no skipped level;
- each of the seven regions is a named landmark, and no two share a name;
- the folded header keeps `place_view_nav_label` and `aria-current="page"` on the active view;
- a loading container carries `aria-busy`, so the skeleton→content and fallback swaps are not silent;
- result/list available without map interaction;
- map legend uses labels/symbols in addition to color;
- map/list selection has keyboard support and announced state;
- tables retain headers and captions on mobile overflow;
- fact deltas announce direction and unit, not only arrow/color;
- focus is not moved on mode/cycle changes unless navigation occurs;
- reduced-motion preference disables nonessential transitions;
- light/dark contrast passes for party colors against their rendered background, with text/pattern fallback where a party color cannot pass — computed through `src/lib/readableText.ts`, the existing helper (with its own test) that `tileAccents.ts` already uses, rather than a third implementation of the same WCAG arithmetic over the 183 canonical parties' `color` values.

### Route/navigation

- `/elections?elections=<older cycle>` renders that cycle in the canvas, the scope bar and `ElectionContext` alike; a malformed value falls back to the latest event **and says so** (§3.1a);
- every migrated route asserts the `data-surface-shell` marker is present, so a silent fallback to the legacy body fails rather than passes (§9.0);
- the merged Elections menu points to `/elections`, contains no stale `/` election leaf, and does not absorb `/governance/mayor-pay`;
- every digest cell's destination resolves to a live route, and its availability agrees with what `PlaceViewNav` renders for the same place;
- a place with no local cycle renders a three-cell digest with a named reason, not a zero and not a dead pill;
- every kind/level descriptor resolves to a live canonical route;
- finder destinations exist for representative normal, Sofia, city-district, abroad, and section-fallback cases;
- all previous menu destinations still appear after menu merge;
- local is unavailable abroad;
- historical `/elections/:date` continues to override the query election context;
- no stale breadcrumb uses the historical route segment as the geographic label.

### SEO/artifacts

- `/elections` and `/en/elections` unique title, H1, description, canonical, body;
- per-election and place pages keep their existing canonicals in v1;
- every new page has prerender, sitemap, and dedicated OG coverage;
- OG capture waits for a populated result canvas, not its skeleton;
- committed sitemap contains both language variants where supported, from **both** `route_defs.ts` lists — a page in `ENGLISH_STATIC_PAGES` and not in `routeDefs(year)` has its mirror indexed and not its original;
- every `routeDefs` `file:` exists on disk — a missing one skips the entry with no warning;
- every `ogImage` path resolves to a file under `public/og/`, and the captured PNG has been opened and looked at;
- no route falls through to home shell metadata.

### Performance

- raw surface budgets enforced in unit/data tests, and §5.0's emit column re-measured against generated output;
- the generated object-count delta is recorded per cycle and per level and is inside §5.0's bound;
- the place finder's index is not fetched by a page whose finder was never opened (§6.2);
- `/elections` head is inside the `dashboard-hub` SKILL.md §3.0 height budget, with the expected `data-kpi-cell` count;
- `/elections` route chunk remains lazy from the app entry;
- heavy map/chart vendor chunks do not join the entry static graph;
- result text becomes available before or independently of map geometry;
- CLS below 0.1 for `/elections`, parliamentary/local country, one municipality, and both section variants;
- localhost LCP smoke below the existing 4 s ceiling;
- no first-screen child-bundle fanout;
- exactly one language bundle is fetched;
- the core locale chunk's brotli size is inside the re-ratcheted `tests/perf.spec.ts` budget in both languages, with the delta recorded (§5.2).

### Required representative fixtures/routes

- latest parliamentary country;
- parliamentary abroad (`32`);
- one multi-municipality region and one single-municipality redirect case;
- ordinary municipality and Sofia/city-district special case;
- a municipality with all four views reachable, and one whose local view does not resolve;
- ordinary settlement and one with no local mayor ballot;
- parliamentary section with scan/video and without optional evidence;
- local country;
- local region;
- local municipality: outright winner, runoff, independent, split control;
- local section: council only, council+municipality mayor, district mayor.

## 11. Commands and phase gates

Exact commands may be narrowed per phase, but the final v1 gate is:

```bash
# 1. generate
npm run data -- --election-surfaces
npm run data -- --local-rollups --election-surfaces

# 2. unit / data / artifact gates
npx vitest run scripts/elections src/data/elections src/screens/elections
npx vitest run scripts/tests/election/surfaces.data.test.ts
npx vitest run src/data/local/placeViews.test.ts src/locales/parity.test.ts src/locales/plurals.test.ts
npx vitest run src/data/elections/electionCopyCoverage.test.ts scripts/i18n/bundle_reachability.test.ts
npx vitest run src/ux/infographic/hubHead.gates.test.ts src/screens/elections/electionsHubBands.test.ts
npx vitest run scripts/prerender/ogAndSitemapCoverage.test.ts scripts/og/capture_routes.test.ts

# 3. PUBLISH — before any browser gate, because CI reads the live bucket (§9.0)
npm run bucket:sync:paths -- --dry-run <cycle>     # read the object count first
npm run bucket:sync:paths -- <cycle>
npm run db:check-generated

# 4. manual public/ writers — BEFORE the build, which copies public/ into dist/
npx tsx scripts/og/capture-screens.ts elections     # then open the PNG and look at it
npm run sitemap                                     # rewrites public/sitemap*.xml — COMMIT it

# 5. build and browser gates
npm run build
npm run test:seo
npm run test:perf
npx playwright test tests/a11y.spec.ts    # axe + the four meaning-level assertions (§10.0)
npm run test:unit -- tests/ui.spec.ts               # hub head height + data-kpi-cell count
```

Two things about this block are load-bearing rather than cosmetic:

- **Step 3 precedes every browser gate.** CI fetches election data from the production bucket
  (§9.0), so a suite run before the sync exercises the legacy fallback and passes on nothing.
- **Step 4 precedes step 5.** `vite build` copies `public/` into `dist/`, so an og capture or a
  sitemap regenerated afterwards ships one deploy late. Neither is wired into anything, which is
  why both are the steps that get skipped.

Before using this block, implement the CLI so one standalone `--election-surfaces` run discovers both parliamentary and local cycle directories; do not make operators repeat the second line if the final interface can safely cover both.

For every phase:

1. run the narrowest generator/tests first;
2. render affected routes at 390, 768, 1280, and 1440 px in Bulgarian and English;
3. inspect light/dark mode and keyboard traversal;
4. run a focused code review on the phase diff;
5. repair all valid findings;
6. run the targeted suite again;
7. commit the phase separately.

## 12. Rollout and rollback

Roll out by data capability, not a global boolean feature flag.

1. Publish additive `surface` JSON to the bucket; no UI reads them yet. This is per-phase (§9.0), not a single event at the end — an artifact that is committed but unpublished makes that phase's browser gates vacuous rather than red.
2. Deploy shared components with `ElectionSurfaceBoundary` legacy fallback.
3. Launch `/elections` and combined navigation.
4. Enable country/region adapters.
5. Enable municipality.
6. Enable settlement/section.
7. Remove legacy first-screen code only after monitoring and task validation.

Rollback boundaries:

- a missing or invalid artifact automatically renders the legacy body;
- `/elections` can be removed from navigation without affecting any old route;
- generated surface files are additive and may remain published during UI rollback;
- each level adapter can be reverted independently;
- no redirect/canonical migration exists to unwind in v1.

Do not silently fall back after a valid surface request returns malformed data. Log the schema error, render the legacy page, and fail the data/monitoring gate so the corruption is visible.

**The fallback is the rollback mechanism and it is also the vacuity trap, so it is instrumented in both directions.** Every fallback logs once per process with the level and the reason; the browser suites fail on that log for any level already migrated, and assert the `data-surface-shell` marker is present. Without both halves, "renders the legacy body" is simultaneously the designed rollback and an undetected regression.

## 13. Risks and mitigations

| Risk                                                   | Mitigation                                                                                                                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared UI erases mayor/council differences             | Discriminated ballot types, separate panels/totals, local fixtures and reconciliation gates                                                                               |
| Projection drifts from canonical files                 | Generator-only artifacts, exact total reconciliation, deterministic rebuild test                                                                                          |
| First surface becomes another KPI band                 | Hard fact/standout caps and required map+ranking composition                                                                                                              |
| Large scope files create fanout or slow LCP            | Small route projection, no geometry/history, request and byte budgets                                                                                                     |
| Abroad shows impossible turnout                        | Required turnout basis and `region/32` negative data/UI tests                                                                                                             |
| Statistical flags imply wrongdoing                     | Neutral closed copy, evidence/baseline requirement, no Benford headline                                                                                                   |
| Route cleanup breaks SEO                               | No v1 migration; route artifacts ship atomically; optional migration separately approved                                                                                  |
| New shell loses existing depth                         | Existing detailed sections remain; every reduction requires a reachable complete-results leaf                                                                             |
| Sofia/district edge cases regress                      | Finder/routes use existing catalogs; mandatory special-case fixture set                                                                                                   |
| Local older cycles lack ballot fields                  | Availability-driven panels; missing is not zero; per-cycle data gates                                                                                                     |
| Artifacts generated but never published                | Publication is a numbered step inside each phase (§9.0); `db:check-generated`; a bucket fetch is the exit criterion, not a green build                                    |
| Browser gates green on the legacy fallback             | `data-surface-shell` presence assertion per migrated level; one fallback log per process, failed on by the suites (§9.0)                                                  |
| A six-figure object expansion for no gain              | §5.0's emission test, measured per level; bounded cycle coverage; the object-count delta recorded in the Phase 1 commit                                                   |
| `/elections` becomes a 14th bespoke header             | It composes `HubHead` (§6.0) and joins the two written gates that enumerate head screens and their height budgets                                                         |
| Accessibility requirements with no gate                | §10.0's axe pass plus four hand-written assertions; the map posture is declared per adapter and gated in Phase 0                                                          |
| A migrated page navigable by region but not by heading | `headingLevel={2}` on every migrated `DashboardSection`, asserted over the composed outline — the `<section>` stays a landmark either way, so nothing else would catch it |
| A map that answers the mouse and not the keyboard      | `FeatureMap` gates tabIndex/role/aria-label/onKeyDown on `ariaLabel && onClick`; each adapter declares interactive or presentational                                      |
| An enum member ships with no copy in either language   | `electionCopyCoverage.test.ts` over the enum declarations — `parity.test.ts` compares the corpora to each other and cannot see it                                         |
| The English page shows Cyrillic party names            | Names are ids in the artifact and labels at render time (§5.3); the EN forms live in `canonical_parties.json`, not in the shards                                          |
| A built i18n key defeats the bundle analysis           | `labelKey` written out beside every code; gated in Phase 0 alongside §6.1's registry rule                                                                                 |
| Postgres creeps onto the render path                   | §5.1 is a fixed decision; a Playwright network assertion per migrated route; a PG-only fact is a link cell, never a fetched number                                        |
| A place's four views stay siloed                       | `PlaceDigest` renders one fact per reachable view on every view (§4.1); validation task 2 is gated on it                                                                  |
| The digest disagrees with the tab it links to          | Every cell re-derives from the destination's own producer; the Phase 5 gate compares them rather than a stored copy                                                       |
| A daily price baked into a per-cycle file              | The digest's halves are served from their own producers; §4.1 forces the cadence decision in Phase 0                                                                      |
| A second control strip above the first number          | The scope bar composes into `PlaceHeader`, which already carries `PlaceViewNav`; the combined header is budgeted and measured at 390 px                                   |
| A shared composition rebuilt in parallel               | §6.3 names the nine existing four-card screens; the strip adopts them and the descriptor records every fact it drops                                                      |
| Root/election ownership drifts after cutover           | `/` is tested as the global hub; `/elections` owns election metadata, links and current-country experience; deep canonicals remain unchanged                              |

## 14. Definition of done

v1 is complete only when all of the following are true:

- `/elections` is the visible top-navigation entry for parliamentary and local elections, `/` is the global home rather than an election leaf, and the election hub composes `HubHead` with an entry in `HUB_SCREENS` and `HUB_HEAD_BUDGETS`;
- every generated artifact is published and served from the bucket, verified by fetch and by `db:check-generated` — not inferred from a green build;
- every migrated level is demonstrated to render the shared shell rather than the legacy fallback;
- `/elections` honours `?elections` and names the cycle whose numbers are on screen;
- every requested level uses the shared scope/status grammar where data exists;
- country and region show map plus ranked result first;
- every result page states one fact from each reachable view, so a reader learns who the mayor is without finding the pill — and every one of those figures matches the view it links to;
- municipality makes mayor, runoff, council, majority, and split control immediately legible;
- settlement shows only offices actually elected there and labels parent context;
- section pages are result/evidence-first and never combine unlike ballots;
- abroad never displays a turnout percentage without a valid denominator;
- every standout is reproducible, neutral, and evidence-linked;
- the accessibility gate exists, runs over every representative route, and has been shown to fail when each clause is broken;
- every enum the contract can emit has copy in both languages, every count is a plural family, and no raw identifier or folder id reaches the DOM;
- surface payload, entry bundle, CLS, LCP, accessibility, i18n, and artifact gates pass;
- all old routes and deep analyses remain reachable;
- the four validation tasks succeed on phone and desktop;
- final review finds no unresolved correctness, accessibility, performance, route, or SEO issue.

## 15. Explicitly out of scope for v1

- changing election result authorities or ingest sources;
- real-time election-night infrastructure beyond representing projection/provisional/final states;
- predicting winners;
- aggregating unlike local ballots;
- a national cartogram without a separate validated prototype;
- deleting existing report/analysis leaves;
- migrating the public route tree beyond moving the current parliamentary-country entry from `/` to `/elections` as required by the global-home plan;
- adding a new analytics vendor;
- rewriting every existing map before the shared shell ships.
