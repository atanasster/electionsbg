# Governance hub restructure — v1 plan (UX simplification via curated hubs)

Status: **PLAN / NOT STARTED — 2026-07-16.** Design agreed; no code yet. This is an approve-and-build
document. Updated 2026-07-16 with the **routing/URL-replacement, breadcrumb, and SEO
(sitemap · prerender · og:image)** analysis — see those sections below. Closest built siblings to copy:
the **procurement hub** (`src/screens/ProcurementScreen.tsx` — the reference tile-hub with shortcut
tiles) and the **sectors hub** (`src/screens/governance/GovernanceSectorsScreen.tsx` +
`sectorRegistry.ts` — the reference for a registry-driven `TileHubGrid`). Shared kit:
`src/ux/infographic/` (`TileHubGrid`, `InfographicTile`).

---

## Goal

Make the app approachable for casual users by replacing the complicated `Управление` mega-menu (18 leaves,
mostly bare jargon labels) with a **shallow, curated hub hierarchy** that uses plain-language descriptions.
Keep the procurement/sectors hub designs the user already likes; do not redesign them.

## Principles (the model)

1. **Curated, not menu-mirrored.** A hub shows the highest-value destinations for its level — never a tile
   per menu leaf.
2. **Two tile types:**
   - **Shortcut tiles** — deep-link straight into a useful slice, skipping navigation (procurement's
     `Изпълнители`, `Рискови сигнали`, `По място`). The hub's real value.
   - **Sub-hub tiles** — a short list of related areas one level down (what the top hub offers).
3. **Two tiers:** a **top hub** (`/governance`) = a short list of sub-hub tiles; **domain hubs**
   (procurement, budget, funds, sectors, parliament, indicators, declarations) = mostly shortcut tiles.
4. **Plain-language descriptions everywhere** — every tile carries a ≤6-word line that answers
   "what will I find / what question does this answer", not the official name restated. Sentence case,
   no bare acronyms, no period.
5. **Consistency** — one kit (`InfographicTile` `title` + `desc` + optional `metric`/`metricCaption`),
   one organization pattern across all hubs.

## Target hierarchy

```
Управление ▾   → /governance   (tile-hub of the 7 sub-hubs below; 18 leaves → 7)
  Държавен бюджет      → /budget                 (dashboard → add shortcut tiles)
  Обществени поръчки   → /procurement            (tile-hub ✓ — trim sector strip)
  Европейски средства  → /funds                  (dashboard → add shortcut tiles)
  Държавни сектори     → /governance/sectors     (tile-hub ✓)
  Парламент            → /parliament             (hub ✓ — surface attendance)
  Декларации           → /governance/declarations (NEW — no landing exists today)
  Показатели           → /indicators             (KPI hub + sub-nav ✓ — surface themes)
```

Everything deeper is a **shortcut inside its sub-hub**, not a top-hub tile.

---

## Landing-form audit (what exists today)

| Sub-hub | Landing | Form today | Work needed |
|---|---|---|---|
| Поръчки | `/procurement` | tile-hub | keep; **trim sector strip** to procurement-dominant sectors (roads, defense) or a single `По сектор →` link |
| Сектори | `/governance/sectors` | tile-hub (18 sectors, registry-driven) | keep |
| Парламент | `/parliament` | hub (`ParliamentHubScreen`) | surface `parliament/attendance` |
| Показатели | `/indicators` | KPI hub + `indicatorsNav.tsx` | surface the 5 themes at the menu/hub level |
| Бюджет | `/budget` | dashboard | **add shortcut tiles** |
| Евро-средства | `/funds` | dashboard | **add shortcut tiles** |
| Декларации | — | **none (4 loose leaves)** | **create sub-hub** `/governance/declarations` |
| top | `/governance` | dashboard (`GovernanceCards`) | **convert to tile-hub** (data sections can stack below the tile grid) |

Key completeness finding: 3 of 7 need real build work (create Декларации, convert /governance, add
budget/funds shortcut tiles) — "reuse the kit" is not free.

---

## Per-sub-hub tile spec (label · description · link)

Descriptions marked **(exists)** are already in i18n; the rest are new copy to add. Keep labels as-is.

### /governance (top hub) — 7 sub-hub tiles
| Tile | Description | Link |
|---|---|---|
| Държавен бюджет | Приходи, разходи и дефицит | /budget |
| Обществени поръчки | Пари, потоци, най-големи играчи | /procurement |
| Европейски средства | Кой получава евро-финансиране | /funds |
| Държавни сектори | Пари по сектор: пътища, здраве… | /governance/sectors |
| Парламент | Как гласуват депутатите | /parliament |
| Декларации | Имущество и връзки на властта | /governance/declarations |
| Показатели | България в числа и спрямо ЕС | /indicators |

### Декларации (NEW sub-hub /governance/declarations)
| Tile | Description | Link | Status |
|---|---|---|---|
| Връзки | Фирмите зад депутатите | /connections | in menu |
| Имущество на депутати | Какво притежават депутатите | /mp-assets | in menu |
| Автомобили на депутати | Колите в декларациите | /mp-cars | in menu |
| Дружества, свързани с депутати | Бизнесът на депутатите | /mp/companies | in menu |
| **Длъжностни лица по имущество** | Министри, кметове, управители | /officials/assets | **SURFACE (buried)** |
| *(cross-link)* Финансиране на партии | Дарения и партийни отчети | /financing | Elections home |

### Показатели (/indicators — already a hub)
| Tile | Description | Link | Status |
|---|---|---|---|
| Икономика | Растеж, инфлация и пазар на труда, по мандати | /indicators/economy | **SURFACE** · desc (exists) |
| Фискални | Дълг, баланс, резерв, размер на държавата, потоци от ЕС | /indicators/fiscal | **SURFACE** · desc (exists) |
| Общество | Безработица, жилищни цени, неравенство, престъпност | /indicators/society | **SURFACE** · desc (exists) |
| Управление | Корупция, оценки на Световната банка, доверие | /indicators/governance | **SURFACE** · desc (exists) |
| Бюджети по кабинети | Разходите на всеки кабинет, сравнени | /indicators/budgets | **SURFACE** · new nav key |
| Сравнение с ЕС | България спрямо ЕС | /indicators/compare | in menu (was mis-listed as a sibling of Индикатори) |
| Демография | Население и застаряване | /demographics | in menu |
| Правителства | Кабинети и резултатите им | /governments | in menu |

### Парламент (/parliament — already a hub)
| Tile | Description | Link | Status |
|---|---|---|---|
| Гласуване в парламента | Как гласува всеки депутат | /parliament (or /votes) | in menu |
| Сесии (поименни гласувания) | Гласувания по конкретни закони | /votes | in menu |
| **Посещаемост** | Кои депутати присъстват | /parliament/attendance | **SURFACE (buried)** |
| Партиен консенсус | Кои партии гласуват заедно | /parliament/cohesion | in menu |
| Карта на гласуванията | Депутати, които гласуват еднакво | /parliament/embedding | in menu |

### Бюджет (/budget — add shortcut tiles)
| Tile | Description | Link |
|---|---|---|
| Изпълнение на бюджета | Приходи, разходи, дефицит | /budget |
| Данъчен калкулатор | Колко данък плащаш ти | /budget/tax-calculator |
| Бюджетен симулатор | Пренареди бюджета сам | /budget/simulator |
| Бюджети по кабинети | Разходите на всеки кабинет | /indicators/budgets *(cross-link)* |

### Евро-средства (/funds — add shortcut tiles)
| Tile | Description | Link |
|---|---|---|
| Бенефициенти | Кой получава евро-средства | /funds#top-beneficiaries |
| Свързани с публични фигури | Бенефициенти зад властта | /funds/political |
| Договори и грантове | Фирми и в двата потока | /funds#dual-corpus *(SHIPPED tile)* |
| План за възстановяване | Усвояване на ПВУ | /funds/rrf |
| Сигнали за риск | Концентрация и отстранени | /funds/integrity |

### Поръчки (/procurement) — no new tiles; **trim the sector strip**
Keep the existing shortcut tiles. Replace the full featured-sectors strip with either (a) 2–3
procurement-dominant sectors (roads, defense) as shortcuts, or (b) a single `По сектор →` link to
`/governance/sectors`. Sectors are cross-cutting (budget + payout + procurement) and belong to the
Сектори sub-hub, not under procurement.

---

## Open decisions

1. **`/subsidies` placement.** ДФЗ farm subsidies has its own dashboard AND there is a `/sector/agri`
   sector page. Recommendation: surface `/subsidies` from the **agri sector tile** (+ optionally one entry
   in Бюджет/spending), not as a standalone top-hub tile. Decide before build.
2. **`indicators/budgets` cross-listing.** "Бюджети по кабинети" is budget-flavoured but lives under
   `/indicators`. Recommendation: list in **both** Бюджет and Показатели (cross-link), primary home
   `/indicators/budgets`.

## i18n copy still to write

- New nav/title keys: `subsidies_nav`, `officials_assets_nav`, `parliament_attendance` nav
  (only `attendance_title` exists), `indicators_budgets_nav`.
- Sub-hub tile descriptions in the tables above not marked "(exists)".
- Indicator theme descriptions already exist (drop-in): `indicators_{economy,fiscal,society,governance}_description`.

## Routing & URL replacement

`/governance` is doing **double duty** today and this is the trickiest part of the migration:
1. The `Управление` **nav landing** (menu → `/governance`; `GOVERNANCE_PREFIXES` in `Header.tsx` drives
   the active-dropdown tint).
2. The **country node of the place-governance view** — `governanceUrl(country) → /governance`
   (`src/data/local/placeViews.ts:82`), with `/governance/region/:oblast` and
   `/governance/:obshtina|:ekatte` below it, a "Governance" pill in `PlaceViewNav`, and the
   `PlaceHeader` narrative drill-up. `GovernanceScreen` renders `<PlaceHeader active="governance"
   level="country">`.

Making `/governance` a nav tile-hub **splits these two roles** (mirrors `/procurement` hub +
`/procurement/overview` dashboard):

| Route | Before | After | Breadcrumb system |
|---|---|---|---|
| `/governance` | country gov dashboard (`GovernanceCards`) | **Управление nav tile-hub** | tile-hub (`Breadcrumbs`) |
| `/governance/overview` **(NEW)** | — | **country gov dashboard** (moved `GovernanceScreen` content) | place-view (`PlaceHeader`) |
| `/governance/declarations` **(NEW)** | — | **Декларации sub-hub** | tile-hub (`Breadcrumbs`) |

**Repoint required (place-view country → `/governance/overview`):**
- `src/data/local/placeViews.ts` `governanceUrl`: `if (level==="country") return "/governance/overview"`
  (was `/governance`). This one change propagates through `placeViewUrl` so every oblast/muni
  governance dashboard's drill-up to country lands on `/overview`. Verify `RegionGovernanceScreen` /
  `MyAreaScreen` up-links.

**Inbound links that STAY correct** (they mean "Управление root" = the hub, no change):
- Breadcrumb "Управление → `/governance`" in `ProcurementBreadcrumb`, `SectorBreadcrumb`,
  `AwarderBreadcrumb`, `ContractDetailScreen`, `TenderDetailScreen`, `WaterOperatorsScreen`,
  `MpProfileSections`.
- `reportMenus.ts` nav link → `/governance` (now the hub — intended).
- `GOVERNANCE_PREFIXES` (`Header.tsx`) — the `/governance` prefix still covers hub + `/overview` +
  place ladder.

**One relabel:** the mobile `menu_overview → /governance` leaf (`reportMenus.ts:250`, labelled "Обзор")
now lands on the hub — either relabel it "Управление" or point it at `/governance/overview`.

**No redirect needed:** `/governance` persists as a URL (meaning changes dashboard→hub); external
bookmarks land on the hub, which links to `/overview`.

## Breadcrumbs

Two **disjoint** systems in the repo (do not merge — a new hub uses the first):
- **Tile-hub system** — `src/ux/Breadcrumbs.tsx` primitive (`{label, to?}[]`, plain `<Link to={string}>`,
  **no** search-param/view preservation) → `SectorBreadcrumb`, `ProcurementBreadcrumb`, `AwarderBreadcrumb`.
  Static "Управление › X › Y". The new `/governance` hub and `/governance/declarations` belong here.
- **Place-view system** — `PlaceHeader` + `placeViewUrl` + `PlaceViewNav`: view-aware geographic
  drill-up with sticky view. `/governance/overview` (country dashboard) stays here — keeps its
  `<PlaceHeader active="governance" level="country">`.

**Specs:**
- `/governance` (top hub): root of `Управление` — no breadcrumb needed (like other view roots); `<Title>`
  only. (Optionally a single non-linked "Управление".)
- `/governance/declarations` (sub-hub): author a **`DeclarationsBreadcrumb`** mirroring
  `ProcurementBreadcrumb` — items `[{Управление → /governance}, {Декларации → non-linked on the hub}]`;
  export a `DECLARATIONS_HUB_PATH` const. Sub-pages (`mp-assets`, `connections`, `mp-cars`,
  `mp/companies`, `officials/assets`) render it with `currentKey` → "Управление › Декларации › X".
  **These existing pages need their headers updated** to add this breadcrumb.
- `/governance/overview`: keep `PlaceHeader` unchanged (only the route path is new).

**Cleanup while here:** standardize the procurement root-crumb label key (files disagree —
`procurement_link_label` vs `procurement_index_title`); `SectorBreadcrumb` is misfiled under
`components/procurement/` (cosmetic).

## New-page inventory (everything reachable from the hubs)

- **Genuinely new routes (2):** `/governance/overview`, `/governance/declarations`.
- **Repurposed (1):** `/governance` (dashboard → hub).
- **Newly surfaced existing routes** (already built, newly linked from a hub): `officials/assets`;
  `indicators/{economy,fiscal,society,governance,budgets}`; `parliament/attendance`; `subsidies`;
  `funds/{political,integrity,rrf}`; `budget/{tax-calculator,simulator}`;
  `demographics/{regions,municipalities}`; the shipped funds dual-corpus tile.

## SEO integration (sitemap · prerender · og:image)

Three **independent** subsystems — a new/renamed route must be added to each. Audit of the surfaced
pages shows **most are already fully integrated** (a real SEO win from surfacing alone):

| Page | Sitemap | Prerender | og:image | Action |
|---|---|---|---|---|
| `indicators/{economy,fiscal,society,governance,budgets}` | ✓ | ✓ | ✓ (`indicators-*.png`) | none |
| `subsidies` | ✓ | ✓ | ✓ | none |
| `funds/{political,integrity,rrf}` | ✓ | ✓ | ✓ | none |
| `budget/{tax-calculator,simulator}` | ✓ | ✓ | ✓ | none |
| `officials/assets` | ✓ | ✓ | default | optional dedicated og |
| **`parliament/attendance`** | ✗ | ✗ | ✗ | **ADD all 3** (pre-existing gap surfacing exposes) |
| **`/governance`** (→ hub) | ✓ (as dashboard) | ✓ (as dashboard) | `governance.png` | **UPDATE** title/desc/og to the hub; re-capture og |
| **`/governance/overview`** (NEW) | ✗ | ✗ | ✗ | **ADD all 3** |
| **`/governance/declarations`** (NEW) | ✗ | ✗ | ✗ | **ADD all 3** |

**Mechanism per subsystem** (all independent; `npm run test:seo` enforces sitemap↔prerender parity):
- **Sitemap** — `scripts/sitemap/route_defs.ts`: add static `{path, file}` entries (~line 155, `file`
  must exist on disk — it gates emission + sets `<lastmod>`). Add the slug to `ENGLISH_STATIC_PAGES`
  (~line 21) for the `/en/` mirror.
- **Prerender** — `scripts/prerender/routes.ts`: add a `staticPage({ path, title, description,
  breadcrumbName, ogImage, bodyHtml, english })` entry to `prerenderRoutes` (~line 1876). Titles/
  descriptions here are the canonical **crawler** metadata (baked into `dist/<path>/index.html`).
- **og:image** — governance-class dashboards use **Playwright screenshots**
  (`scripts/og/capture-screens.ts`, run manually `npx tsx scripts/og/capture-screens.ts` against a dev
  server, commit `public/og/<slug>.png`). Add a `Capture` with a stable **`data-og="…"` anchor** on the
  new screen. (Alternative: a generated card via `renderStaticPageCard(...)` in `scripts/og/generate.ts`
  — no committed asset.) Referenced via the route's `ogImage: "/og/<slug>.png"`.
- **Runtime** — add `<SEO title description />` (or `<Title description>`) to each new screen
  (`src/ux/SEO.tsx`; note the runtime `SEO` does **not** set og:image — that's prerender-only).

**"Beautiful" og:images to (re)capture** — each needs a `data-og` anchor on its screen:
- `governance.png` — **re-capture** as the new tile-hub grid (currently the dashboard screenshot).
- `governance-overview.png` — the country dashboard (can reuse the old `governance.png` framing).
- `governance-declarations.png` — the new declarations hub grid.
- `parliament-attendance.png` — new (or fall back to default).

## Cross-view / deliberately excluded

- **Cross-link only:** `/financing` (party financing — primary home Elections); `/my-area`
  (place-axis governance — already surfaced via the header "Моят район" pill).
- **Excluded from governance nav:** `*/methodology` pages, `/data*` (footer data hub), `/observations`
  (Elections/OSCE), `/db` (dev), `/preferences` (Elections preferential votes), `/parties`, `/regions`.

---

## Build phases

- **Phase A — top hub + the `/governance` split.**
  1. Move the current `GovernanceScreen`/`GovernanceCards` dashboard to a **new `/governance/overview`**
     route (keeps its `PlaceHeader`).
  2. Repoint `governanceUrl(country) → /governance/overview` in `placeViews.ts`; relabel the mobile
     `menu_overview` leaf.
  3. Build `/governance` as a `TileHubGrid` of the 7 sub-hub tiles (descriptions above) + an "Обзор /
     Национален преглед" tile → `/governance/overview`.
  4. SEO: update `/governance` sitemap `file` + prerender `title/description/ogImage` to the hub;
     re-capture `governance.png`; add `/governance/overview` to sitemap + prerender + `governance-overview.png`.
- **Phase B — Декларации sub-hub.** New `/governance/declarations` `TileHubGrid` (5 tiles incl. surfaced
  `officials/assets`) + a `DeclarationsBreadcrumb` (export `DECLARATIONS_HUB_PATH`); add the breadcrumb to
  the 5 declaration sub-pages. SEO: add `/governance/declarations` to sitemap + prerender +
  `governance-declarations.png`.
- **Phase C — surface Показатели + Парламент extras.** Add the 5 indicator themes + `attendance` as
  shortcut tiles on their existing hubs and to the menu group. SEO: `indicators/*` already integrated;
  **add `parliament/attendance` to sitemap + prerender + og** (pre-existing gap).
- **Phase D — budget/funds shortcut tiles.** Add the shortcut-tile rows to `/budget` and `/funds` for
  tier consistency (targets already SEO-integrated).
- **Phase E — procurement sector-strip trim** + **menu collapse.** Shrink the
  `menu_header_budget_spending` group + the whole `Управление` dropdown to the 7 sub-hubs
  (`reportMenus.ts`).
- **Verify:** `npm run test:seo` (sitemap↔prerender parity) after each SEO-touching phase.

## Out of scope (flag for later)

This plan covers **Управление** only. Run the same completeness pass on **Избори** and **Потребление**
before the global menu collapse ships, or the views drift inconsistent — the exact outcome we're avoiding.

## Files to touch

**Screens / routing**
- New `src/screens/GovernanceScreen.tsx` → the top hub (`TileHubGrid`); move current dashboard body to
  new `src/screens/governance/GovernanceOverviewScreen.tsx` (keeps `PlaceHeader` + `GovernanceCards`).
- New `src/screens/governance/GovernanceDeclarationsScreen.tsx` (+ a small registry like `sectorRegistry.ts`).
- `src/routes.tsx` — add `/governance/overview` + `/governance/declarations`; `/governance` now renders the hub.
- `src/data/local/placeViews.ts` — `governanceUrl(country) → /governance/overview`.
- `src/screens/ProcurementScreen.tsx` — trim sector strip.
- `src/screens/BudgetScreen.tsx`, `src/screens/FundsScreen.tsx` — shortcut-tile rows.
- `src/screens/indicators/IndicatorsLandingScreen.tsx` / `indicatorsNav.tsx` — theme surfacing (already navigable).

**Breadcrumbs**
- New `src/screens/.../DeclarationsBreadcrumb.tsx` (mirror `ProcurementBreadcrumb`); wire into the 5
  declaration sub-pages. Reuse `src/ux/Breadcrumbs.tsx` (no change).

**Nav + i18n**
- `src/layout/header/reportMenus.ts` — collapse the governance menu to 7 sub-hubs; relabel `menu_overview`.
- `src/locales/{bg,en}/translation.json` — new tile descriptions + nav keys (`subsidies_nav`,
  `officials_assets_nav`, `parliament_attendance` nav, `indicators_budgets_nav`, declarations keys).

**SEO**
- `scripts/sitemap/route_defs.ts` — `/governance/overview`, `/governance/declarations`, `parliament/attendance`
  (+ `ENGLISH_STATIC_PAGES`).
- `scripts/prerender/routes.ts` — `staticPage(...)` for the same three; update `/governance` entry to the hub.
- `scripts/og/capture-screens.ts` — `Capture` entries for `governance` (re-capture), `governance-overview`,
  `governance-declarations`, `parliament-attendance`; each screen needs a `data-og="…"` anchor. Commit
  `public/og/*.png`.

**No change:** shared kit `src/ux/infographic/`, `src/ux/Breadcrumbs.tsx`, `src/ux/SEO.tsx`.
