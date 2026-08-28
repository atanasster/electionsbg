# Mayor-pay dashboard polish — v1

**Status:** completed 2026-08-28.

## Completion record

- Tier 1 (`0b71809b63`): token-AND municipality/mayor search, including
  first+family name, reversed order, repeated separators and Latin input.
- Tier 2 (`fc4fb81bf8`): full-width dashboard head, connected KPI band,
  labelled live filters, responsive sortable table, localized row-specific
  declaration-link labels, and loading/error/empty coverage.
- Tier 3 (`88c7dcdeb8`): dedicated Local Elections menu discovery at the
  canonical `/governance/mayor-pay` URL.
- Tier 4: final data, browser, accessibility and build verification recorded
  in the completion record below.

Validation completed:

- mayor-pay data audit: 8/8 tests passed;
- focused screen/search/menu/route suites passed;
- repository lint and production TypeScript/Vite build passed;
- browser checks at 390, 768 and 1440 px found no page-level horizontal
  overflow; the narrow table overflow remains contained in its own scroller;
- live `Васил Терзиев` search returned the single Sofia row, the Local
  Elections menu exposed the canonical link, and the browser logged no errors.

## 1. Problems confirmed

1. **The page is narrower than the dashboard shell.**
   `GovernanceMayorPayScreen` adds `max-w-5xl mx-auto px-4 md:px-8` inside the
   global `Layout` container. On a desktop screenshot this leaves hundreds of
   pixels unused while the table columns compete for space.
2. **A natural two-part name query fails.**
   The filter folds `Васил Терзиев` to `василтерзиев` and asks whether that
   contiguous string occurs in `Васил Александров Терзиев` folded to
   `василалександровтерзиев`. It does not. The intended rule is token AND:
   every query word may match anywhere in the municipality/mayor search keys.
3. **The Local Elections menu has no entry.**
   The canonical page is registered in `governanceMenu` only. It is relevant to
   the local-election audience even though its data is current and not tied to
   an election cycle.
4. **The screen looks like a centred article with cards, not a data browser.**
   `/persons` has the stronger hierarchy: breadcrumbs, a compact `HubHead`, one
   integrated KPI band, a clearly labelled filter block, and then the results.
5. **The “newest year” KPI over-emphasises a tiny filing cohort.**
   In the screenshot it says 2026 while explaining that only two municipalities
   have a 2026 filing. Correct but visually louder than the comparable majority
   year. The dashboard should headline the dominant fiscal-year cohort and keep
   the absolute newest year in the methodology/freshness copy.

## 2. Proposed information architecture

Use the `/persons` rhythm without turning this 259-row client-side browser into
the server-paginated persons registry:

1. Breadcrumb: **Управление → Местна власт → Заплати на кметовете**.
2. Compact dashboard head:
   - eyebrow: **УПРАВЛЕНИЕ · МЕСТНА ВЛАСТ**;
   - title and one-sentence deck;
   - search field in the head;
   - one connected four-cell KPI band.
3. A labelled filter panel immediately below:
   - declaration year;
   - data availability;
   - visible result count and a single “clear filters” action when narrowed.
4. A full-width results card with the sortable table.
5. Methodology/source note below the results, kept to readable measure.

No chart returns: the sortable table remains the primary comparison surface.

## 3. Layout and visual treatment

### 3.1 Width

- Remove the screen-level `max-w-5xl`, `mx-auto`, and duplicate `md:px-8`.
- Use `w-full pb-12`; rely on `Layout`'s container padding, with at most a small
  page-level `px-1 sm:px-2` if visual alignment requires it.
- Keep prose constrained (`max-w-3xl`/the `HubHead` deck width), but allow KPI,
  filters, and table to span the dashboard container.

### 3.2 Head and KPIs

- Adopt `Breadcrumbs` and `HubHead`, as `/persons` does.
- Convert the four standalone shadowed `MetricCard`s into `HubHead` KPIs: one
  rounded segmented band, tighter vertical rhythm, consistent labels/bases.
- Proposed KPIs:
  1. municipalities with readable income / total;
  2. dominant fiscal year + number of rows in that cohort;
  3. median annual labour income;
  4. median income per 1,000 residents.
- Every KPI keeps an explicit basis. Medians continue to say that each mayor's
  latest available filing is used and fiscal years can differ.
- Loading uses four KPI skeleton cells in the head, preventing layout shift.

### 3.3 Search and filters

- Give search the `/persons` visual language: shared `Input`, search icon, clear
  affordance, visible/screen-reader label, and result summary.
- Keep filtering live because the full dataset is already in memory and only
  ~259 rows; do not add a server request or artificial submit delay.
- Put year and availability in a bordered, labelled filter panel rather than an
  unlabelled row of controls.
- Preserve the segmented availability choice, but make it wrap safely and meet
  a 36–40 px target height.
- Show `N от 259` next to a clear-all action; announce count changes through a
  polite live region.

### 3.4 Table

- Retain the five useful columns and existing sort semantics.
- Use the new width before hiding information. At narrow widths:
  - municipality and mayor remain visible;
  - population may hide below `md`;
  - declared income and per-1,000 value remain, with compact headers;
  - horizontal scrolling remains a last-resort safety net, not the desktop
    layout.
- Keep person and municipality links, source links, tabular numerals, null-last
  sorting, and the older-year marker.
- Add a subtle row hover/focus treatment and a sticky table header only if it
  works inside the existing card overflow container at mobile and desktop.

## 4. Search contract

Extract a pure matcher in `mayorPayFilters.ts`.

1. Split the query on whitespace/punctuation into non-empty tokens.
2. Require **every** token to match somewhere in the combined searchable keys:
   Bulgarian/English municipality names and the mayor's name.
3. Make token order irrelevant, so all of these find
   `Васил Александров Терзиев`:
   - `Васил Терзиев`;
   - `Терзиев Васил`;
   - `васил   терзиев`.
4. Reuse the repository's `searchMatches`/transliteration fold per token where
   possible, giving this small browser the same Cyrillic/Latin tolerance as the
   better registry searches without changing the API.
5. Use AND, not OR: `Васил Ангелов` must not return one row for “Васил” and a
   different row for “Ангелов”. All tokens must match the same row.

The result count and no-match message must update from this same filtered array.

## 5. Navigation

- Keep `/governance/mayor-pay` as the sole canonical route; do not create a
  cycle-scoped duplicate.
- Add it to `localMenu` under **Кметове и съвети**, directly after the elected
  mayors-by-party entry.
- Use a dedicated menu label such as **Заплати на действащите кметове** /
  **Current mayors' declared pay** so a reader does not mistake it for data from
  the selected 2023 local-election cycle.
- Retain the Governance menu entry as well: the page belongs to both discovery
  paths, while both links resolve to the same URL.
- Add a regression test asserting exactly one mayor-pay leaf in each relevant
  menu and the same canonical target.

## 6. Implementation sequence

### Tier 1 — search correctness

Files:

- `src/screens/governance/mayorPayFilters.ts`
- `src/screens/governance/mayorPayFilters.test.ts`
- `src/screens/governance/GovernanceMayorPayScreen.test.tsx`

Implement token-AND matching first and pin first+last, reversed-name,
multi-space, transliteration (if the shared fold is adopted), and false-OR
cases.

### Tier 2 — dashboard shell and responsive results

Files:

- `src/screens/governance/GovernanceMayorPayScreen.tsx`
- Bulgarian and English translations
- its component test

Replace the narrow article wrapper and standalone KPI cards with breadcrumbs +
`HubHead`; build the labelled filters/result toolbar and responsive table.
Keep all existing data and methodology semantics.

### Tier 3 — Local Elections discovery

Files:

- `src/layout/header/reportMenus.ts`
- Bulgarian and English translations
- a focused header-menu regression test (new or the nearest existing menu test)

Add the current-pay leaf to the local menu, linking to the unchanged canonical
route.

### Tier 4 — validation and polish

- Component tests for loading, error, empty, no-match and filtered states.
- Accessibility checks: one `h1`, labelled search/year/availability controls,
  `aria-sort` on headers, announced result count, keyboard-reachable clear and
  source links.
- Responsive browser checks at phone, tablet and wide desktop widths: no page
  horizontal overflow; table fallback scroll only within its card.
- Run focused tests, lint, production build, and the existing mayor-pay data
  audit.

## 7. Acceptance criteria

- At a 1440 px viewport the main dashboard/table uses the available container
  width and has no second 32 px desktop padding layer.
- `Васил Терзиев` and `Терзиев Васил` both return the Sofia mayor row.
- Search still finds municipality names and single name fragments.
- The page appears in both Governance and Local Elections menus, with both
  links targeting `/governance/mayor-pay`.
- The local-menu wording clearly identifies the data as current declarations,
  not a 2023 election result.
- The four KPIs form one dashboard band and state their denominator/year basis.
- Mobile controls wrap cleanly, core result columns remain usable, and the page
  itself does not overflow horizontally.
- No data/API/schema change, chart, salary-legality judgement, or new route is
  introduced.
