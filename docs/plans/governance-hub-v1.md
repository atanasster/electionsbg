# Governance hub restructure — v1 plan (UX simplification via curated hubs)

Status: **PLAN / NOT STARTED — 2026-07-16.** Design agreed; no code yet. This is an approve-and-build
document. Closest built siblings to copy: the **procurement hub** (`src/screens/ProcurementScreen.tsx`
— the reference tile-hub with shortcut tiles) and the **sectors hub**
(`src/screens/governance/GovernanceSectorsScreen.tsx` + `sectorRegistry.ts` — the reference for a
registry-driven `TileHubGrid`). Shared kit: `src/ux/infographic/` (`TileHubGrid`, `InfographicTile`).

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

## Cross-view / deliberately excluded

- **Cross-link only:** `/financing` (party financing — primary home Elections); `/my-area`
  (place-axis governance — already surfaced via the header "Моят район" pill).
- **Excluded from governance nav:** `*/methodology` pages, `/data*` (footer data hub), `/observations`
  (Elections/OSCE), `/db` (dev), `/preferences` (Elections preferential votes), `/parties`, `/regions`.

---

## Build phases

- **Phase A — top hub.** Convert `/governance` to a `TileHubGrid` of the 7 sub-hub tiles (descriptions
  above); stack the existing `GovernanceCards` data sections below the grid. Reuses the kit. New route
  wiring only.
- **Phase B — Декларации sub-hub.** New `/governance/declarations` `TileHubGrid` (5 tiles incl. the
  surfaced `officials/assets`).
- **Phase C — surface Показатели + Парламент extras.** Add the 5 indicator themes + `attendance` as
  shortcut tiles on their existing hubs and to the menu group.
- **Phase D — budget/funds shortcut tiles.** Add the shortcut-tile rows to `/budget` and `/funds` for
  tier consistency.
- **Phase E — procurement sector-strip trim** + **menu collapse.** Shrink the `menu_header_budget_spending`
  group + the whole `Управление` dropdown to the 7 sub-hubs (`reportMenus.ts`).

## Out of scope (flag for later)

This plan covers **Управление** only. Run the same completeness pass on **Избори** and **Потребление**
before the global menu collapse ships, or the views drift inconsistent — the exact outcome we're avoiding.

## Files to touch

- `src/screens/GovernanceScreen.tsx` / `src/screens/governance/GovernanceCards.tsx` — top hub grid.
- New `src/screens/governance/GovernanceDeclarationsScreen.tsx` (+ a small registry like `sectorRegistry.ts`).
- `src/screens/ProcurementScreen.tsx` — trim sector strip.
- `src/screens/BudgetScreen.tsx`, `src/screens/FundsScreen.tsx` — shortcut-tile rows.
- `src/screens/indicators/IndicatorsLandingScreen.tsx` / `indicatorsNav.tsx` — theme surfacing (already navigable).
- `src/layout/header/reportMenus.ts` — collapse the governance menu to 7 sub-hubs.
- `src/routes.tsx` — `/governance/declarations` route.
- `src/locales/{bg,en}/translation.json` — new tile descriptions + nav keys.
- Shared kit (no change): `src/ux/infographic/`.
