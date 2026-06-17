# Procurement awarder geo-enrichment (v2)

> **Status (2026-06-16): Tier A SHIPPED; Tier B code-complete, pending egov reachability.**
> `scripts/procurement/awarder_geo_map.ts` → `data/procurement/awarder_geo_overrides.json`;
> `buildRollups` applies it fill-missing. Tier A (name-parse) resolved **327** buyers
> → `by_settlement` local-tier pinned **712 → 943** (+231), settlement files 252 → 321,
> no-geo awarders 3,533 → 3,206. Spot-check: 15/15 sampled overrides correct (`name_only`,
> unique-match only). Tier B (МОН register) is wired but `getResourceData` 403s from
> blocked IPs — it lands automatically on the next run from a reachable environment
> (a normal pipeline/CI run), adding the ~2,052 schools+kindergartens. Not yet
> registered as a watcher source / data-map source (do that once Tier B is verified live).

**Goal:** pin no-geo procurement _buyers_ (contracting authorities) to their settlement
EKATTE so they roll into the place aggregates — `by_settlement/{ekatte}.json`, the
my-area / governance place procurement tile, and (for municipal-tier buyers) the
alerts feed. Closes the gap left by the ЦАИС ЕОП flat-feed gap-fill (which has no
buyer address) **and** the long tail of OCDS buyers that only appear in
address-less pre-2026 / legacy data.

## Problem & impact (measured 2026-06-16)

Of **4,387** awarders, only **854 (19%)** have a `geo` block; **3,533 (80%) have
none** → they're dropped from `by_settlement` ("no cached address") and therefore
invisible in every place-scoped view. `geo` today comes only from
`parties[].address` on an OCDS row (`buildRollups` → `resolve_ekatte.ts`); the flat
ЦАИС ЕОП feed carries no address, and legacy/old-OCDS rows often don't either.

No-geo awarders by kind (inferred from name):

| kind                          | count | local tier? |
| ----------------------------- | ----- | ----------- |
| school (училище/гимназия)     | 1,594 | yes         |
| kindergarten (детска градина) | 458   | yes         |
| other                         | 1,178 | mixed       |
| hospital (болница/МБАЛ)       | 142   | yes         |
| municipality                  | 83    | yes         |
| agency                        | 37    | central     |
| university                    | 25    | yes         |
| ministry                      | 16    | central     |

The tier classifier (`awarder_tier.ts`) already marks school/kindergarten/hospital/
university as **local** tiers, so the _only_ missing input is an EKATTE — once a
no-geo local buyer gets one, `buildBySettlement` pins it automatically. No tier or
aggregation logic needs to change.

Note: alerts (`scripts/myarea/build_alerts.ts`) only surface `tier === "municipal"`
buyers, so this v2 mainly benefits the **place tiles**, not alerts (municipalities
already have geo; schools wouldn't appear in alerts regardless).

## Sources (tiered by coverage × confidence)

| Tier | Source                                                                                                                                                                                                                                                                  | Covers                                            | Conf. | Access                                                                                      | New ingest?  |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------- | ------------ |
| A    | **Name-suffix parse** — `"- гр.X" / "- с.X"` in the awarder name → `ekatte_index`                                                                                                                                                                                       | ~413 (12%)                                        | low   | free, local                                                                                 | no           |
| B    | **МОН school register** — data.egov.bg open data ([resource `cac4d569-529c-4209-b797-1cf5f69901f5`](https://data.egov.bg/data/resourceView/cac4d569-529c-4209-b797-1cf5f69901f5); live UI [reg.mon.bg/Schools](https://reg.mon.bg/Schools/) searches by населено място) | schools + kindergartens ≈ **2,052 (58%)**         | high  | egov `getResourceData` POST API (same path `update-indicators`/`update-budget` already use) | yes (small)  |
| C    | **БУЛСТАT seat** — registryagency.bg / bulstat.bg, per-EIK current-status                                                                                                                                                                                               | the rest (other/hospital/agency/ministry ≈ 1,400) | high  | per-EIK query, registered/subscription for bulk → **access-gated**                          | yes (harder) |

**Rejected:** the TR/connections ingest (`companies-index.json`) — only **4/3,533**
EIKs overlap (it covers commercial companies, not budget entities). Dead end.

Tiers A+B alone pin **~60–65%** of the no-geo set (and ~all the schools — the EOP
gap-fill's main content). Tier C is optional polish for the long tail.

## Architecture (additive, mirrors `enrich_awarders_geo.ts`)

1. **`scripts/procurement/awarder_geo_map.ts`** (new) → writes
   `data/procurement/awarder_geo_overrides.json` = `{ [eik]: { ekatte, source: "mon"|"name"|"bulstat", confidence } }`.
   - Tier B: fetch the МОН register via `getResourceData`, map school EIK
     (`canonicalEik`, 9-digit) → settlement; resolve settlement→EKATTE via
     `ekatte_index` using the register's municipality/oblast to disambiguate
     duplicate names.
   - Tier A: parse `"- гр.X / - с.X"` from names not covered by B; resolve via
     `ekatte_index` (low confidence — bare name, ambiguous).
2. **Wire into `enrich_awarders_geo.ts` + `buildRollups`**: when an awarder has no
   address-derived `geo`, consult the override map → set
   `geo = { ekatte, confidence, tier: classifyAwarder(eik,name), isLocalHQ }`.
   **Only fill missing** — never override an address-derived geo.
3. Rebuild rollups → `by_settlement` → done. Place tiles + governance profile pick
   it up with no frontend change.

## Wiring (if Tier B becomes a tracked source)

- Watcher source `mon_school_register` (cadence ~yearly — the register changes
  slowly; likely a manual/periodic refresh, not the daily watcher).
- `process-watch-report` row → `update-procurement` (Step 1c) — **and** the
  hand-maintained map in `.claude/skills/process-watch-report/SKILL.md` (NOT the
  data-map model — see the gotcha in that skill).
- data-map model: either fold МОН into the existing `egov` group or a new `mon`
  source group → `ds:procurement` edge (build fails on an unplaced source).
- README + DataSources page (i18n) source link.

## Gotchas

- **Duplicate settlement names** across oblasts — `ekatte_index` carries
  `province`/`obshtina_code` for disambiguation; Tier B has the muni/oblast (safe),
  Tier A has only the bare name (ambiguous → low confidence, accept some miss).
- **Confidence band**: stamp `geo.confidence` (mon=high, name=low). Consider
  whether the by-settlement total should include low-confidence pins or only
  display them with a caveat.
- **EIK form**: register EIK vs our 9-digit canonical — match on `canonicalEik`;
  some procurement rows use 13-digit branch EIKs (collapsed to 9 already).
- **Sofia**: schools in Sofia → the city EKATTE (68134) / the S2\*\*\* district shards
  — verify the map lands them on the right Sofia node.
- **data.egov.bg flakiness**: 403s seen this session; the egov POST API is the
  working path (GET resource download is blocked). Retry/backoff like the other
  egov ingests.

## Scope tiers & effort

- **Spike (~0.5d):** confirm the МОН resource columns (does it carry EIK +
  settlement/EKATTE?) via `getResourceData`; measure exact match rate of our 2,052
  school/kindergarten EIKs against the register. Decides B's real coverage.
- **MVP (~1–1.5d):** Tiers A+B → override map → enrich wiring → rebuild. Expect
  `by_settlement` "dropped (no cached address)" to fall from **3,533 → ~1,400**;
  local-tier pinned roughly triples (712 → ~2,300). Schools appear in their
  settlement's my-area tile.
- **Full (+~1d):** Tier C (БУЛСТАT) for the remaining long tail — only if access is
  workable; otherwise document the residual gap.

## Verification

- Coverage report: no-geo before/after, by kind.
- Spot-check: school `000042608` (СУ Добри Чинтулов) and `000451989` (НУ Васил
  Левски, гр. Кричим) appear in their settlement's `by_settlement` file + my-area
  tile.
- No regression: existing geo'd awarders unchanged (only-fill-missing); no
  double-count (gap-fill buyers were never in any settlement total).

## Non-goals

- Not a re-platform; not changing alerts logic (schools aren't municipal-tier);
  not back-filling addresses into raw OCDS rows.
