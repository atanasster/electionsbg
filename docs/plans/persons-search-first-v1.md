# /persons — search-first browser, v1

**Status:** plan. Nothing implemented.
**Screen:** `src/screens/persons/PersonsBrowserScreen.tsx` (888 lines today)
**Predecessor:** `docs/plans/persons-browser-v1.md` (the browser this reworks)
**Sibling precedent:** `/procurement/contracts` — the other registry browser that already
adopted `HubHead` + a per-figure declared basis (`contractsKpiBasis.ts`). Read that file
before Tier 2; this plan mirrors its rule-module-plus-gate shape deliberately.

---

## 0. What was asked, and what each ask actually costs

Four requests, in the user's words:

1. show **ALL** by default (not just officials);
2. do **not** render the table for an empty search;
3. put the search string in the **URL** so a refresh restores the last result;
4. since the default table goes away, **design a world-class interface** for search + filters.

(1) and (3) are small and self-contained. (2) is the one that forces the redesign: the
filter row lives *inside* `DbDataTable`'s `toolbar` prop today, so removing the table
removes every filter with it. So (2) ⇒ the filters must come out of the table, and once
they are out, (4) is the design of what the page *is* when there are no rows.

### The measurements this plan rests on

All run 2026-08-26 against local Postgres (`person_browse_table`, migration 120), which the
screenshots reconcile with exactly (137 461).

| | rows |
|---|---|
| `tier = 'P'` (public / resolved — today's default) | **63 816** |
| `tier = 'V'` (name-fold private owners) | **73 645** |
| **total (`?sector=all`)** | **137 461** |

Group membership over the full corpus: `is_company` 85 060 · `is_candidate` 29 707 ·
`is_exec` 14 583 · `is_muni` 6 544 · `is_ngo` 4 930 · `is_magistrate` 3 594 ·
`is_mp` 2 118 · **`is_donor` 0**. `has_declaration` 21 170 (15%) · `held_office` 39 123 ·
`parties_n > 1` 5 146.

`primary_facet` over the full corpus: company 73 645 · politician 46 139 · executive 8 234 ·
public_sector 5 882 · magistrate 3 535 · regulator 26.

`identity_confidence`: P → `resolved` 63 816. V → `verified` 64 750, `name_fold` 4 507,
`shared_name` 4 388.

---

## 1. Three findings that shape the design

### 1.1 Defaulting to ALL is nearly free for existing deep links — and NOT free for the reader

Measured per tier, the dimensions every existing `/persons` deep link uses are **P-only by
construction**, so flipping the default changes nothing for them:

| dimension | tier P | tier V |
|---|---|---|
| `has_declaration` (`?decl=1`) | 21 170 | **0** |
| `role_codes` contains `mp` (`?role=mp`) | 2 118 | **0** |
| `place_kind='judicial'` (`?court=…`) | 3 127 | **0** |
| `is_ngo` (`?facet=ngo`) | 4 930 | **0** |
| `parties_n > 1` | 5 146 | **0** |
| `is_company` (`?facet=company`) | 11 415 | **73 645** ⚠ |

Only two things widen: `?facet=company` (11 415 → 85 060) and **free-text search**, which is
the point of the change. Every in-app entry point survives unchanged —
`parliamentRegistry.ts` `?role=mp`, `CourtScreen` `?court=`, `declarationsSearch.ts`
`?q=…&decl=1`, `cultureRegistry.ts` `?role=cultural_institute`, `governanceRegistry.ts`
bare `/persons`.

**What is NOT free:** under `all`, **73 645 of 137 461 rows (53.6%) carry a name-based
identity** and therefore the amber „по име" / „няколко лица" badge — 4 388 of them the
stronger „няколко лица" warning. The default view flips from *cross-register resolved
people* to *mostly name-matched records*. That is honest data and the badge already says
so per row, but the page must say it **once, at the top**, not 137 461 times in a column.
Hence: the scope control gets counts, and the deck names the two populations. Hiding the
badge, or leaving the change unstated, is the one resolution this plan refuses.

### 1.2 The KPI band already contradicts itself under search — and the fix already exists

Screenshot 2 (`?sector=all`, `q=yavor`) publishes four numbers about **two different
populations**: „Лица 321" is the table's own server aggregate and *is* search-scoped, while
„С декларация 15%", „С фирми в ТР 62%", „Общини 289" and the whole mix bar ride
`/api/db/facets`, **which has no free-text parameter at all** (`usePersonFacets`'s own
header states this, and `runDbFacets` never passes `global`). 15% and 62% are the corpus
figures (21 170/137 461 and 85 060/137 461), rendered under a heading that says 321.

`/procurement/contracts` hit exactly this and solved it in `contractsKpiBasis.ts`: every
cell declares its basis, and a rate that follows the filters but not the search says
`contracts_basis_filters_not_search`. This plan ports that rule wholesale rather than
hiding the band or making the facets search-aware (which would need a new engine
parameter and would make every dropdown vocabulary collapse to the query).

### 1.3 Under `sector=all` the mix bar's „Бизнес" segment IS the private scope

`primary_facet = 'company'` is **73 645 — exactly the V-tier count**, i.e. the two sets are
provably identical. So on the landing the page would offer the same narrowing twice: the
scope control's „Частен сектор" and the mix bar's largest segment. Not a bug — both work
and return the same rows — but it must be a stated decision rather than an accident.
**Decision:** keep both, and let the mix bar note say the „Бизнес" segment is the private
arm, so a reader who clicks it understands they have switched population rather than
narrowed one. Re-check this identity if 120's `primary_facet` derivation ever changes; a
gate asserting it is proposed in Tier 6.

---

## 2. The page, after

```
Breadcrumbs                                    (unchanged, above the head)

┌─ HubHead ────────────────────────────────────────────────────────────────┐
│ УПРАВЛЕНИЕ · ХОРА                             ┌── evidence aside ──────┐ │
│ Хора във властта                              │ ГРУПИ                  │ │
│ deck: one sentence, naming both populations   │ по брой лица           │ │
│                                               │ Бизнес         85 060  │ │
│ [ Всички 137 461 ▾ ]   ← scope slot           │ Кандидати      29 707  │ │
│                                               │ Изпълн. власт  14 583  │ │
│ ┌──────────────────────────────────────────┐  │ Общ. админ.     6 544  │ │
│ │ 🔍  Търси име, институция или община…  ✕ │  │ ЮЛНЦ            4 930  │ │
│ └──────────────────────────────────────────┘  │ Магистрати      3 594  │ │
│ hint / example chips                          │ Депутати        2 118  │ │
│                                               └────────────────────────┘ │
│ ┌ Лица ─────┬ С декларация ┬ С фирми в ТР ┬ Общини ───┐  ← KPI band      │
│ │ 137 461   │ 15%          │ 62%          │ 289       │                  │
│ │ ВСИЧКИ…   │ ОТ ВСИЧКИ…   │ ОТ ВСИЧКИ…   │ ОТ ВСИЧКИ…│  ← basis, req.   │
│ └───────────┴──────────────┴──────────────┴───────────┘                  │
└──────────────────────────────────────────────────────────────────────────┘

PersonsFilterBar   Група ▾  Роля ▾  Партия ▾  Област ▾  Институция ▾
                   ☐ заемали длъжност   ☐ с декларация

Active chips       [Роля: Кмет ✕] [Област: Бургас ✕]        Изчисти всички

── then ONE of two bodies ─────────────────────────────────────────────────

(A) LANDING — no query, no narrowing filter
    MixBar „Основна принадлежност"  (clickable → ?pfacet, which opens (B))
    „Започнете оттук" — cross-cutting query cards the group list cannot express:
       Сменили партия 5 146 · С декларация 21 170 · Заемали длъжност 39 123
       С фирми в ТР 85 060
    „Разгледай всички 137 461 лица →"   (?browse=1 — the explicit escape hatch)

(B) RESULTS — a query, a narrowing filter, or ?browse=1
    MixBar (unchanged, still clickable)
    results header:  N лица · Свали CSV
    <DbDataTable>  (search input suppressed — the head owns it)
```

### 2.1 The rule that switches bodies

```
showTable  =  queryIsSendable  ||  hasNarrowingFilters  ||  browseAll
```

* `queryIsSendable` — the trimmed term is **≥ `SEARCH_MIN_CHARS` (3)** characters, counted
  the way `DbDataTable.termLength` counts them (`[...s.normalize("NFC")].length`, not
  `String.length` — „👍👍" is 4 code units and 2 characters, and pg_trgm extracts zero
  trigrams from it). A 1–2 character term is not yet a query, so it must not open a table
  the engine would refuse with a 400.
* `hasNarrowingFilters` — `facet · pfacet · role · party · oblast · obshtina · court ·
  position · decl · held · switch`. **`sector` is deliberately excluded**: it is a *scope*,
  not a query. Switching „Всички" → „Във властта" and getting 63 816 prominence-sorted rows
  is precisely the default-table behaviour requirement (2) removes.
* `browseAll` — `?browse=1`, set only by the landing's „Разгледай всички" link. The escape
  hatch exists so the rule can never trap a reader who genuinely wants the list.

**Why filters unlock the table and not just search:** every cross-link into this page is a
filter, not a query (`?role=mp` from `/parliament`, `?court=…` from `/court/:code`,
`?obshtina=` from `/governance/:id`). A search-only gate would 404-by-blank-page every one
of them.

---

## 3. Tier 0 — the `DbDataTable` seam

`src/ux/data_table/DbDataTable.tsx`. Three additive, optional props; every one of the ~24
existing callers passes none and is byte-for-byte unchanged.

```ts
/** CONTROLLED search. When provided the component stops owning the term: the page does,
 *  and `initialSearch` is ignored. The 250 ms fetch debounce and the SEARCH_MIN_CHARS
 *  floor stay HERE in both modes, so the engine's 400-on-a-short-term contract keeps
 *  exactly one client-side guard. */
search?: string;
/** Reports the term back. Only meaningful uncontrolled — a controlled parent already has it. */
onSearchChange?: (term: string) => void;
/** Suppress the built-in input; the page renders its own (search-first pages). */
hideSearchInput?: boolean;
```

Implementation notes to carry into the file's header:

* `const value = search ?? inner` — one value feeds the existing 250 ms debounce, so the
  page-reset effect (`useEffect(() => setPageIndex(0), [debounced, …])`) covers the
  controlled path with no change.
* **`search` and `initialSearch` are mutually exclusive.** If both arrive, `search` wins
  and DEV logs a `console.error` — the alternative is a term the reader can see and cannot
  clear.
* **`hideSearchInput` without `search` is a foot-gun** — a term nobody can type — so it
  also DEV-errors.
* The `tooShort` body hint stays. On /persons the table only mounts once the term is
  sendable, so it is unreachable via search there; it still fires for `filter + 1-char
  term`, which is correct, and the page suppresses its own hint whenever the table is
  mounted so the reader hears one voice.

**Tests** (`DbDataTable.test.tsx`): controlled term reaches `filters.global` after the
debounce · `initialSearch` ignored when `search` is present · uncontrolled behaviour
unchanged (regression) · `hideSearchInput` renders no `input[type=search]` but still
applies the floor.

---

## 4. Tier 1 — the URL contract

`src/data/persons/useUrlPersonFilters.ts` + its test.

| param | change |
|---|---|
| `?sector` | default flips `public` → **`all`**. `setSector` now stores `null` for `all` and an explicit value for `public`/`private`, so the clean URL `/persons` *is* the full corpus. |
| `?q` | **new here.** The hook becomes the owner (it was read ad-hoc in the screen via `params.get("q")`). Trimmed, capped at 200 characters (the engine's own cap). No character validation — the engine escapes LIKE metacharacters itself (`likeEscape` in `db_table.js`), and rejecting punctuation would break „Окръжен съд - Варна". |
| `?browse` | **new.** `"1"` = show the table anyway. In `PARAMS` (so `clearFilters` clears it) but NOT in `hasActiveFilters` — it is a view mode, not a narrowing, so it must not light the „Изчисти филтрите" button. |
| `?switch` | **new.** `"1"` = `parties_n ≥ 2`, the „сменили партия" discovery query. Maps to `{ id: "parties_n", min: 2 }` — the registry already declares `parties_n: { filter: "range" }`. |

New exports: `query`, `setQuery`, `browseAll`, `setBrowseAll`, `switchers`,
`setSwitchers`, and a derived **`hasNarrowingFilters`** (everything except `sector`),
which is the switch in §2.1 and belongs in the hook rather than in the screen so the test
can pin it — as does **`queryIsSendable`**, the switch's other half, derived from the shared
`termLength` / `SEARCH_MIN_CHARS` rule (moved to `src/ux/data_table/searchTerm.ts` so a page
can ask it without importing a React component) rather than hand-rolled in the screen. A
`.length >= 3` there is a third copy of the rule the engine documents as the one people get
wrong, and it opens the table on a term the engine answers with a 400.

`hasActiveFilters` gains `query` and `switchers`; its `sector` clause becomes
`sector !== "all"`.

⚠️ **`clearFilters` now clears `?q` too.** Today its comment says it preserves `?q`
deliberately; under this design the search box is the page's primary control and „Изчисти
всички" that leaves a term in it is the more surprising behaviour. State the reversal in
the comment so the next reader does not restore the old rule.

⚠️ **`q` stays OUT of `usePreserveParams`'s allowlist** (it already is). A search term must
not follow a reader onto another page.

**Tests** (`useUrlPersonFilters.test.ts`): default sector is `all` · `public` round-trips
as an explicit param while `all` writes nothing · `?q` round-trips, trims, and caps at 200
· `?browse` is cleared by `clearFilters` but absent from `hasActiveFilters` ·
`hasNarrowingFilters` is false for a bare `?sector=public` and true for each of the eleven
narrowing params.

---

## 5. Tier 2 — the head

Replace `<Title>` + the intro `<div>` + `PersonsAnalysisStrip`'s four `StatCard`s with
`<HubHead>` (`src/ux/infographic/HubHead.tsx`).

⚠️ **`HubHead` renders both the `<h1>` and the `<SEO>`, so `<Title>` must go** or the page
emits two h1s — gated statically by `hubHead.gates.test.ts` and at runtime by
`tests/ui.spec.ts`.

* `eyebrow` — „УПРАВЛЕНИЕ · ХОРА".
* `title` — `roleName || "Хора във властта"`. Keep the existing role-narrowing (§ the
  screen's own "THE HEADING NAMES THE FILTERED SET" comment — landing from the hub's
  „Депутати" tile onto a page headed „Хора" over „Лица 2 120" is the defect it fixed) and
  align the base with the prerendered `<h1>`, which already says „Хора във властта".
* `deck` — one sentence naming **both** populations, per §1.1.
* `scope` — the sector `Select`, moved out of the table toolbar into the slot that exists
  for exactly this ("beside the figures it governs"). Options carry counts:
  „Всички (137 461)" / „Във властта (63 816)" / „Частен сектор (73 645)".
* `search` — `<PersonsSearchField>` (Tier 3).
* `kpis` — from **`personsKpiBasis.ts`** (new, below). `kpisPending={4}`.
* `evidence` — heading „Групи", `basis` „по брой лица в регистъра", rows = the non-empty
  group counts already in `groupOptions`, ranked desc, each `to: /persons?facet=<key>`.
  ⚠️ `is_donor` is **0** corpus-wide, and `groupOptions` already drops zero counts — keep
  that filter; a „Дарители 0" row is a dead link.

### 5.1 `src/screens/persons/personsKpiBasis.ts` — a pure rule, not layout

Direct port of `contractsKpiBasis.ts`'s shape, because the same truth table applies:

```
cell             sector  filters  search   source
Лица               ✓        ✓       ✓      the table's aggregate, or facetTotal on the landing
С декларация       ✓        ✓       ✗      the has_declaration facet
С фирми в ТР       ✓        ✓       ✗      the is_company facet
Общини             ✓        ✓       ✗      the obshtina_code facet cardinality
```

The three ✗ are `/api/db/facets` having no free-text parameter. Basis strings:

* rows: searching → `persons_basis_matching` (`по търсене „{{term}}"`, term clamped to
  `TERM_MAX = 24` — a pasted name took the contracts band from 149 px to 413 px) ·
  filtered → `persons_basis_filters` · otherwise → `persons_basis_scope` (`от всички
  137 461 лица`, i.e. naming the SCOPE, since the scope is the one thing always in play).
* rates: searching → **`persons_basis_filters_not_search`** (`по филтрите, не по
  търсенето`) · filtered → `persons_basis_filters` · otherwise → `persons_basis_scope`.

Withholding rules, mirroring the sibling:

* **Gate on ARRIVAL, never `?? 0`.** `count == null` ⇒ render no cells (the band shows its
  4 skeletons). Unconditional cells published „€0 · в избрания период" on every cold mount
  of `/procurement/contracts`; the persons equivalent is „Лица 0 · от всички 137 461".
* **„С декларация" is withheld when `?decl=1` is on** — the facet excludes its own
  dimension, so the cell would hold at 15% over a set that is 100% by construction.
* **„С фирми в ТР" is withheld when `?facet=company` is on**, same reason.
* **„Общини" is withheld when it is 0** (the existing rule — under `?role=mp` no member
  holds a municipal seat, so a hard 0 beside three live figures reads as broken rather than
  as not-applicable) **and when `?obshtina=` is on** (it would read 1).

On the landing the count comes from `boolTotal("has_declaration")`, which is exact:
`has_declaration` is **NOT NULL** across all 137 461 rows, so its two buckets sum to the
table. Verified 2026-08-26; if a future 120 makes it nullable this silently under-counts,
so the gate asserts the sum.

**Gate:** `personsKpiBasis.test.ts` — the truth table executed, one clause per sentence the
band must not publish. Model it on `contractsKpiBasis.test.ts`, including its trick of
asserting over the RULE rather than the screen (the screen needs a mounted table and a live
facets route to reach most of these states).

### 5.2 `PersonsAnalysisStrip` loses its cards

It keeps the `MixBar` and gains `showKpis?: boolean` (default `true`, so nothing else
breaks) — the exact prop and the exact reasoning `ContractsAnalysisStrip` carries:
*the same number twice on one page reads as two different facts, and the resolution is to
drop it from the lower position, not from the band.* Update
`PersonsAnalysisStrip.test.tsx`.

Its note gains the §1.3 sentence about „Бизнес" being the private arm under `sector=all`.

---

## 6. Tier 3 — `PersonsSearchField`

New: `src/screens/persons/PersonsSearchField.tsx`.

* Full-width to `max-w-2xl`, `h-12`, `type="search"`, `Search` icon inset left, a clear (✕)
  button inset right once non-empty. Uses the shared `Input`.
* A visually-hidden `<label>`, and `aria-describedby` pointing at the hint line — the
  trigger otherwise announces only its value.
* **Hint line, three states** (rendered only when the table is NOT mounted, so the reader
  hears one voice — `DbDataTable`'s own body hint owns the other case):
  * empty → „Търсете по име, институция или община." + 3 example chips that set the term
    („Явор", „Окръжен съд - Варна", „Кмет");
  * 1–2 characters → „Въведете поне 3 знака." — mirroring `SEARCH_MIN_CHARS`, because with
    the table hidden `DbDataTable`'s hint has nowhere to render;
  * ≥3 → nothing; the results header carries the count.
* **Keyboard:** `Esc` clears. `Enter` is a no-op (results are live) but must not submit a
  form or reload. **`autoFocus` on `lg` and up only** — autofocusing on a phone opens the
  keyboard over the whole page, which is the opposite of a landing.
* No typeahead dropdown. See §9.

**Search → URL.** The screen owns `term` in React state (so typing is instant) and mirrors
it into `?q` on a ~350 ms debounce with `{ replace: true }` (no history spam, so Back still
leaves the page). `DbDataTable` receives `search={term}` and applies its own 250 ms fetch
debounce. On mount the state seeds from `?q`, which is what makes a refresh restore the
last result — requirement (3).

⚠️ Two debounces are intentional and must not be collapsed: one bounds **fetches** (250 ms,
in the table, where the engine contract lives), the other bounds **URL writes** (350 ms, in
the screen). Sharing one couples an SEO/navigation concern to a query-cost concern.

---

## 7. Tier 4 — filters out of the toolbar

New: `src/screens/persons/PersonsFilterBar.tsx` and
`src/screens/persons/PersonsActiveFilters.tsx`. The screen renders both directly; the
`DbDataTable` `toolbar` prop shrinks to the CSV button + export note, or is dropped in
favour of a results header owning them.

**`PersonsFilterBar`** — the five `PersonFilterSelect`s and the two checkboxes, laid out as
a wrapping row of *labelled* controls rather than a run of unlabelled boxes. Each control
keeps its existing facet wiring untouched (a facet excludes its own dimension; role/party
carry no counts because the facet groups the representative seat while the filter matches
the code set — measured Кмет 619 shown vs 921 returned). Its own `?sector`-scoped Група
guard stays: render the Група select only when `groupOptions.length > 1`.

⚠️ Under the new `sector=all` default there are **7** group options, so the Група select
now always renders — the existing comment ("today, only under sector=private") is about to
be stale and must be rewritten, not deleted.

**`PersonsActiveFilters`** — the world-class half. One chip per applied filter, reading
`Роля: Кмет ✕` / `Област: Бургас ✕` / `с декларация ✕`, plus „Изчисти всички". Renders
nothing when empty. This is what a deep link needs: today `?role=mp&party=gerb` gives a
reader five dropdowns they must open to discover what is applied. **The chip labels come
from the same label resolvers the selects use** (`usePersonLabels`, `useCanonicalParties`,
`oblastName`) so a chip can never name a code the select names differently.

⚠️ `?position` and `?obshtina` have no picker (cross-link targets only) — they **must**
still get chips, or a reader arriving from `/governance/:id` sees a narrowed table with no
visible cause and no way to widen it. This is the single biggest usability win in the tier.

---

## 8. Tier 5 — the landing body

New: `src/screens/persons/PersonsLanding.tsx`, rendered when `!showTable`.

* The `MixBar` (from `PersonsAnalysisStrip`, `showKpis={false}`) — clicking a segment sets
  `?pfacet`, which is a narrowing filter and therefore opens the results body.
* **„Започнете оттук"** — a small grid of cross-cutting queries the group aside cannot
  express, each a card with a label, a count and an href:
  * Сменили партия · **5 146** · `?switch=1`
  * С декларация · **21 170** · `?decl=1`
  * Заемали длъжност · **39 123** · `?held=1`
  * С фирми в ТР · **85 060** · `?facet=company`
  ⚠️ **Every count is read from a facet, never hardcoded.** `switch`'s needs `parties_n`
  added to the existing `kpis` facet spec's `columns` (it is `filter: "range"`, and
  `runDbFacets` facets any filterable column, so it groups to `{1: n, 2: m, …}` and the
  card sums the ≥2 buckets) — one extra column on a request already in flight, not a new
  round trip. A card whose count is not in hand renders **without** one; it never renders a
  constant, which is the drift this repo has fixed repeatedly elsewhere.
* **„Разгледай всички 137 461 лица →"** — sets `?browse=1`.

The results body additionally gains a **„← Назад към търсенето"** affordance whenever
`browseAll` is the *only* reason the table is showing, since `browseAll` is deliberately
absent from `hasActiveFilters` and so gets no „Изчисти" button.

### 8.1 What this costs and saves

The landing stops issuing the 137 461-row table query entirely. The facet requests go from
**7 to 8**: `parties_n` rides the existing `kpis` spec, but `tier` needed **its own**, because a
facet must exclude its own dimension and `scopeF` carried both the tier and the position filter
— so that had to be split (`tierF` / `positionF`) and `tiers` given everything but `tierF`.
Without it, „Във властта (63 816)" collapses to whatever the reader has already selected.

Measured locally 2026-08-26: the boolean group facet over the full corpus is **5 568 buffers /
27 ms**, the judicial `institution` facet **3 027 buffers / 3 ms**, and the new `tiers` facet a
parallel seq scan at **5 985 buffers / 52 ms** for a two-bucket answer. React Query holds them
at `staleTime: Infinity`, so returning to the landing from a result is free.

⚠️ The `tiers` query key deliberately does NOT move with `?sector` — which is what makes a
scope switch update both the picker's counts and the band's basis with no refetch. Easy to
break by "tidying" `scopeF` back into its filter list.

⚠️ The band waits on BOTH producers (`count` **and** `facetTotal`), so a failed
`/api/db/facets` leaves skeletons rather than a caption computed from nothing —
`fetchFacets` swallows `!r.ok` into `{}` and `useQueries` caches that at `staleTime: Infinity`,
so one 500 would otherwise be permanent for the session. The `tiers` facet is separate from
that gate, which is why `scopeBasis` also carries a count-free fallback.

---

## 9. Explicitly not doing

* **No typeahead dropdown** on the search field. `HubSearch`/`EntitySearchTile` exist and
  are good, but on this page the *table is the result list* — a dropdown over the same rows
  would race and duplicate it. The hub search belongs on `/governance`, which is where it
  already is.
* **No tabs** to switch landing/results (project rule: tiles or stacked sections).
* **No native `<select>`**, and no modal Radix dropdown (it locks body scroll).
* **No server change.** No migration, no new `/api/db` route, no registry edit. The
  `persons` resource's `defaultFilters: [{ col: "tier", val: "P" }]` **stays** — it is the
  floor for a raw API hit that sends no tier, and the client has always overridden it.
* **No sum aggregate** on the money column, for the reason `db_table.js` and the screen
  both already document (two co-officers of one company each carry its full total).

---

## 10. Tier 6 — gates and copy

1. **`tests/ui.spec.ts` → `HUB_HEAD_BUDGETS`** gains a `/persons` entry with a measured
   height and `cells: 4`. ⚠️ Read `/procurement/contracts`'s entry first: it warns that a
   browser head deliberately omits the search slot, and that slack in the ceiling is
   "enough to quietly acquire" one. /persons **does** acquire it, on purpose, and the entry
   must say why (this page is search-first; the table is the accessory, not the search).
   Expect a budget in the `/parliament` (520) band rather than the `/procurement/contracts`
   (360) one.
2. **`hubHead.gates.test.ts`** — the static one-h1 scan must see `<Title>` gone.
3. **New `PersonsBrowserScreen.test.tsx`** (there is none today). Assertions:
   the landing renders no `<table>`; a ≥3-char `?q` renders one; a 1–2-char `?q` does not
   and shows the floor hint; `?role=mp` renders one; `?browse=1` renders one;
   `?sector=public` alone does **not**; typing writes `?q` after the debounce; a chip's ✕
   removes exactly its own param.
4. **`personsKpiBasis.test.ts`** — §5.1's truth table.
5. **§1.3 identity gate** (optional but cheap) in `scripts/db/tests/person_browse.data.test.ts`:
   `count(primary_facet='company') == count(tier='V')`, so the day 120 breaks that identity
   the mix-bar note stops being true loudly rather than silently.
6. **Prerender copy** — `scripts/prerender/routes.ts`, the `staticPage({ path: "persons" })`
   entry, BG **and** EN. It currently says „Таблицата се търси по име или институция…",
   which describes a page that opens with a table. Rewrite both bodies to describe the
   search-first landing and the widened corpus (137 461, including private-sector owners).
   This is the crawlable content, so it is the SEO half of the change, not decoration.
7. **i18n** — new keys land in `src/locales/{bg,en}/translation.json` (the **core** corpus;
   `/persons` is not in `LOCALE_BUNDLES`), so they count against the per-language brotli
   budgets in `tests/perf.spec.ts`. Keep the set tight (~20 keys) and re-run the budget.
   `scripts/i18n/key_usage.test.ts` will fail on any key added and not reachable.
8. **`src/entryGraph.test.ts`** — the new modules must not import a sector registry, and
   `routes.tsx` must not take a constant from one.

---

## 11. Risks

| risk | mitigation |
|---|---|
| A reader who bookmarked `/persons` expecting a table now lands on a search page. | The landing carries „Разгледай всички 137 461 лица" as a first-class link, and every existing filtered deep link still opens straight into the table. |
| `sector=all` makes the majority of default rows name-matched. | §1.1: counts on the scope control, the deck names both populations, the per-row badge stays. Never hidden. |
| Lifting search state to the screen re-renders the page per keystroke. | The screen holds the term in local state (cheap); only the **debounced** value reaches the URL and the table's memoized `request`. The facet queries are keyed on filters, not on `q`, so none of them refetch while typing. |
| `DbDataTable` is shared by ~24 resources. | All three new props are optional; absent ⇒ today's code path exactly. Tier 0 ships with a regression test for the uncontrolled path. |
| The head grows past its budget as copy is tuned. | The `ui.spec.ts` entry lands in Tier 6 with a measured number, and the sibling entries' comments say what to check first (a fifth cell, not shorter captions). |

---

## 12. Order

Tier 0 → 1 → 2 → 3 → 4 → 5 → 6. Tiers 0 and 1 are independently shippable and testable
with no visible change. Tier 2 is the first visible one. Tier 5 is the first that can look
broken if 1 is wrong, so do not reorder them.
