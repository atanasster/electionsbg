# `?position` and `?obshtina` — the two /persons params with no producer, v1

**Status:** plan. Nothing implemented.
**Predecessor:** `docs/plans/persons-search-first-v1.md` — which shipped the chips that made
these two survivable, and closed noting that neither has a producer anywhere in the app.
**Screens:** `src/screens/persons/PersonsBrowserScreen.tsx`, `src/screens/myarea/*`

---

## 0. The question, and why the two halves get opposite answers

Both params are validated, applied and chipped today, and nothing in `src/`, `scripts/`,
`ai/` or `functions/` emits either. The obvious reading is "build a producer for each".
That is right for one of them and wrong for the other, and the measurements say which.

| | `?position` | `?obshtina` |
|---|---|---|
| filters | `position_type` | `obshtina_code` |
| a set no other param can express? | **no** — provably | **yes** — the only municipality filter |
| rows it can reach | 137,461 | 23,469 across 289 municipalities |
| verdict | **retire** | **build, with a producer** |

---

## 1. `?position` is a pure alias for `?pfacet`, and that is measurable

`position_type` and `primary_facet` are the same column with **one value renamed**.
Measured 2026-08-26 over all 137,461 rows of `person_browse_table`:

| `position_type` | `primary_facet` | rows |
|---|---|---|
| `private_sector` | `company` | 73,645 |
| `politician` | `politician` | 46,139 |
| `executive` | `executive` | 8,234 |
| `public_sector` | `public_sector` | 5,882 |
| `magistrate` | `magistrate` | 3,535 |
| `regulator` | `regulator` | 26 |

Six values, no NULLs, and the cross-tab is perfectly diagonal. `?position=politician` and
`?pfacet=politician` return the identical 46,139 rows; the only value that differs is spelled
one way in each column and selects the identical 73,645. `person_search` carries the same six
and no more, so the wider `POSITION_LABEL` map (13 codes) describes seven values that occur
nowhere.

So `?position=private_sector`, `?pfacet=company` and `?sector=private` are **three spellings of
one set**. The plan's §1.3 already had to write a sentence apologising for the second and third
overlapping; a producer for `?position` would add a fourth name and a second control for a
partition that already has one — the mix bar.

**Decision: retire it, via an alias rather than a deletion.** Deleting the param outright would
turn a hand-built link or an AI-tool call that already emits it into a silently *unfiltered*
page. Normalising it keeps those working and collapses the vocabulary:

* `useUrlPersonFilters` reads `?position`, maps `private_sector → company`, and folds it into
  `primaryFacet` **when `?pfacet` is absent**; an explicit `?pfacet` wins.
* `setPosition` and the `position` field come off the hook's public surface; `positionF` and the
  `position` chip come off the screen. One dimension, one control, one chip.
* ⚠️ **Do NOT write the normalised value back to the URL.** A read-side fold is invisible; a
  write turns every inbound `?position=` link into a redirect, which is a different promise and
  breaks anyone diffing URLs.

**Alternatively, keep it** — but then it needs a reason, and the only one that would hold is a
column whose vocabulary is *about to* diverge from `primary_facet`. Nothing in 120 suggests
that. If the alias is judged too clever, the honest fallback is to delete the param and accept
that an inbound link renders unfiltered; what must not happen is a producer.

---

## 2. `?obshtina` is real, and its producer is the page that has 20 tiles and no people

### 2.1 What it can serve

* **23,469 rows across all 289 municipalities**, every one populated — min 4, median 61,
  max 1,315 (Столична община). No municipality would get an empty tile.
* All tier P. Tier V carries no place, so the scope control never empties it by accident.
* **487 buffers / 0.5 ms** for a single-municipality count on the existing
  `idx_person_browse_obshtina`. A per-page tile is free.

### 2.2 It is not the government card

`/governance/:id` already renders `MyAreaGovernmentCard` — mayor, deputies, chair, councillors,
from the officials roster. That is the **current officeholders**. `?obshtina=` is the wider set
the identity layer places there across all nine registers and all time: former officials,
candidates who never took office, magistrates seated at courts in the municipality, everyone
with a declaration. Burgas (`BGS04`, 329 people) breaks down as:

| primary facet | rows | held office | with a declaration |
|---|---|---|---|
| politician | 160 | 160 | 47 |
| **magistrate** | **152** | 152 | 0 |
| executive | 15 | 15 | 15 |
| public_sector | 2 | 2 | 2 |

⚠️ **Those 152 magistrates are why the tile cannot be captioned „местна власт".** 120's
`obshtina_code` is a CASE over three place kinds — `obshtina`, `settlement` → parent obshtina
(the 10,721 village-mayor roles), and `judicial` → the court body's obshtina. A court seated in
Burgas places its magistrates in Burgas, correctly, and a reader who clicked „местната власт"
would be looking at a bench. The caption has to be about the PLACE („хора, свързани с
общината"), not about the municipal government, and the tile should show the facet mix rather
than a bare number so the composition is visible before the click.

### 2.3 ⚠️ The Sofia code hazard — the one thing that must not be got wrong

The governance dashboards route on **`SOF00`**; the corpus says **`SFO_CITY`**. Measured:

| code | rows in `person_browse_table` |
|---|---|
| `SOF00` | **0** |
| `SOF` | **0** |
| `SFO_CITY` | **1,315** |

So a producer that interpolates the route's own `:id` emits `?obshtina=SOF00` and matches
**nothing** — on the largest municipality in the corpus, 5.6% of all placed rows, and it fails
as an empty table rather than as an error. `src/lib/obshtinaPlace.ts` exists for exactly this
and its header names all three synonyms: **every producer must route the code through
`canonicalObshtina()`**, never through the URL segment.

This is the same class as `officePlaceHref.ts`'s own warning in the mirror direction — that file
already refuses to interpolate `SFO_CITY` into a place URL because it "looks like a perfectly
good path segment". This is that hazard reflected: the code that is right for the corpus is
wrong for the route, and vice versa.

**Everything else lines up.** 288 of the 289 codes are in `data/municipalities.json`; the one
exception is `SFO_CITY`, which is not an EKATTE municipality at all. It is a real frontend code
(`routes.tsx` names it beside `BGS04` and `S2414`), so `/governance/` speaks it after the fold.

### 2.4 Sofia's районa are deliberately NOT folded

`S2302…S2524` (24 of them) carry their own people and `canonicalObshtina` leaves them alone —
`obshtinaPlace.ts` argues that a кмет на район holds that район's own office and folding them
into the city bundle "would erase 24 distinct offices to fix a problem that does not exist".
A район governance page should therefore link with its OWN `S2***` code, and the city page with
`SFO_CITY`. The two are different sets and both are right.

### 2.5 The representative-seat limit, measured

`obshtina_code` is the representative seat; there is no padded code-SET column for obshtina as
there is for oblast. The undercount is **small**: of 15,126 people holding an `obshtina`-placed
role, **96 hold one in more than one municipality** (88 in two, 8 in three) — 0.6%. That is a
different order from oblast's 1,851, so a code-set column is not worth minting for this; the
tile simply must not claim completeness. Say „свързани с общината", never „всички, които са
служили тук".

---

## 3. The work

### Tier 1 — the chip says a NAME (closes a gap the predecessor left open)

`PersonsActiveFilters` currently renders the obshtina chip as the raw code — „Община: BGS04".
That was accepted as "strictly better than the previous state", and it is, but it is the one
chip a reader cannot read. Everything needed already exists:

* `useMunicipalities().findMunicipality(code)?.name` for the 288 EKATTE codes;
* `SYNTHETIC_OBSHTINA_LABELS` (`obshtinaPlace.ts`) for `SFO_CITY` → „Столична община";
* `canonicalObshtina()` first, so an inbound `?obshtina=SOF00` chips as Sofia.

⚠️ Fall back to the CODE, never to nothing: a chip that renders empty is a filter applied and
named nowhere, which is the state the component exists to end.

Do this tier first — it is independent, it is the smallest, and Tier 2 makes the chip visible to
every reader who follows the new link.

### Tier 2 — the producer: `/governance/:id`

A footer link on `MyAreaGovernmentCard` (it already owns "who governs here" and already imports
`canonicalObshtina` and `isSofiaCityObshtina`), or a small tile of its own beside it. Either
way:

* the href is `` `/persons?obshtina=${canonicalObshtina(area.obshtina)}` ``;
* the count comes from `/api/db/facets` with `columns: ["primary_facet"]` and
  `filters: [{ id: "obshtina_code", value: [code] }]` — **one request that returns the total AND
  the mix**, so the caption can say what the 329 are made of rather than only how many;
* it renders only when the count is > 0 — every municipality is populated today, so this is a
  guard against a corpus change, not an expected state;
* ⚠️ it must NOT render on a settlement page (`/governance/:ekatte`) with the parent's code
  under a caption that says „тук". Either omit it there or caption it with the parent
  municipality's name explicitly. `area.kind` already distinguishes the two.

**A second producer worth considering in the same tier:** `/governance/region/:oblast` →
`/persons?oblast=<code>`. That param already has a picker, so it is not in the same "no way in"
category — but the regional page has the same gap, and the two links are the same shape.

### Tier 3 — retire `?position`

Per §1. Read-side alias into `?pfacet`, remove the field, the setter, the filter fragment and
the chip. The `positionLabel` import in `PersonsBrowserScreen` goes with it — note that
`positionLabel` itself stays, since three search surfaces render it.

### Tier 4 — gates

1. **The Sofia fold, at the producer.** A test that `/governance/SOF00` emits
   `?obshtina=SFO_CITY`. This is the one failure that renders an empty table at a 200, and it
   is one character from being wrong.
2. **The chip label** — `?obshtina=SFO_CITY` chips „Столична община", `?obshtina=BGS04` chips
   „Бургас", an unknown code chips the code.
3. **`?position` folds into `?pfacet`** — `?position=private_sector` yields one chip, not two,
   and the same rows as `?pfacet=company`; an explicit `?pfacet` wins over `?position`.
4. **A data gate on the alias claim** (`person_browse.data.test.ts`, beside the three the
   predecessor added): `position_type` and `primary_facet` agree on every row except where
   `position_type='private_sector' AND primary_facet='company'`. That is the premise the whole
   retirement rests on, it is a fact about migration 120, and if 120 ever makes the two diverge
   the alias silently starts answering a different question. Assert it in BOTH directions so a
   rename of either value fails rather than passing over two empty sets.
5. **Chip completeness stays true.** `PersonsBrowserScreen.test.tsx` enumerates eleven
   narrowings; dropping `?position` makes it ten. The list is derived from `hasNarrowingFilters`,
   so it must be updated in both places or the gate goes stale rather than red.

---

## 4. What this does NOT propose

* **No obshtina PICKER on /persons.** 289 options is under the facet cap, but the oblast picker
  plus free-text search already cover browsing, and the predecessor's reasoning holds: a
  municipality is somewhere you arrive from, not something you scroll to. The chip is what the
  param needed.
* **No code-SET column for obshtina.** 0.6% multi-seat (§2.5) does not justify a matview column
  and a padded-match filter, and the honest caption costs nothing.
* **No new server route, migration or index.** `obshtina_code` is already filterable and
  indexed, and the facets route already answers the count.
* **No producer for `?position`.** That is the whole point of §1.

---

## 5. Risks

| risk | mitigation |
|---|---|
| The producer emits `SOF00` and Sofia's tile links to an empty table. | §2.3, and Tier 4 gate 1. This is the failure to design against; everything else here degrades gracefully. |
| The tile reads as "the municipal government" and shows 152 magistrates. | §2.2 — caption about the PLACE, and show the facet mix rather than a bare count. |
| Retiring `?position` breaks an AI tool or a saved link that emits it. | The read-side alias, not a deletion. Tier 4 gate 3 pins it. |
| 120 later makes `position_type` diverge from `primary_facet`, and the alias quietly answers the wrong question. | Tier 4 gate 4 asserts the identity in both directions against live Postgres. |
| A settlement page links with its parent's code under a „тук" caption. | §2.4 / Tier 2 — `area.kind` already distinguishes them. |
