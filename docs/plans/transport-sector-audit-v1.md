# Транспорт (МТС) sector audit — v1

Audit of the `/governance/sectors` transport tile + `/sector/transport` against the raw
corpus (`/audit-sectors sector/transport`, 2026-08-13). Postgres: local docker `:5433`,
corpus as loaded that day.

## What was already right

- **The headline reconciles exactly.** `basis: procurement`, and every scope reproduces
  to the euro from `Σ contracts.amount_eur` over `TRANSPORT_SECTOR_EIKS`:

  | scope | `sector_stats.json` | PG |
  |---|---|---|
  | `all` | 6,890,127,007 | 6,890,127,007 |
  | `ns:2024_10_27` | 2,662,757,795 | 2,662,757,795 |
  | `y:2026` | 1,600,265,877 | 1,600,265,877 |

- **The EIK-set copies are in lockstep** — all four (plus a fifth, `transport_facility_geo`)
  derive from `TRANSPORT_ENTITIES` / `TRANSPORT_SECTOR_EIKS`; none hardcodes digits.
  No Failure mode E.
- **No wrong-EIK leakage.** All 11 members are genuinely МТС; no overlap with any other
  `*_SECTOR_EIKS`. No Failure mode C.
- **No Failure mode I.** The mode-split and category tiles normalise against their own
  row sum, so Σ parts == header by construction.
- **The 2026 rail-PSO awards are not duplicated** — three lots of one procedure
  (УНП `00042-2025-0016`), distinct keys, one release.

## Finding 1 (Failure mode D) — the „Въздух" universe is a 94× understatement

`TRANSPORT_UNIVERSES` declares five modes and the signature tile („Къде отиват парите за
транспорт — по вид") renders all five. Aviation holds **one** EIK — ГД ГВА, €3.68M —
while the state's air-navigation infrastructure manager and its airport company are absent.
Four state bodies whose principal is the transport minister are missing:

| body | EIK | € (all) | n | universe | why |
|---|---|---|---|---|---|
| ДП „Ръководство на въздушното движение" (БУЛАТСА) | `000697179` | 260,479,791 | 997 | aviation | Air-navigation service provider; the air-side analogue of НКЖИ (rail) and ДППИ (ports), both already in. Buys АСУВД SATCAS, digital tower, VCS. |
| „Летище София" ЕАД | `121023551` | 84,088,657 | 243 | aviation | 100% state, principal МТС. Corpus spans **2011-01-13 → 2021-04-06** and stops there of its own accord — the SOF Connect operating concession took over later in 2021. No cutoff rule is needed; see the note in the reference data. |
| ИА „Проучване и поддържане на река Дунав" | `000513106` | 21,951,392 | 38 | maritime | Executive agency of МТС (seat Русе); inland-waterway authority. Buys Danube dredging, hydrographic vessels, navigation marks. Peer of ИА „Морска администрация" / ИА „Автомобилна администрация", both in. |
| ДП „Транспортно строителство и възстановяване" | `130847116` | 7,830,017 | 86 | rail | ДП under the transport minister (rail construction/restoration). |

Three of the four match the set's **own stated inclusion rule** (infrastructure managers +
operators + regulators under МТС) — their absence is an omission, not a boundary call.
**ДП ТСВ is the exception**: it is a rail *works* enterprise, so it moves neither people
nor goods and the rule as written does not reach it. The header now names a fourth
(works) layer for it, with the one reason the rail-in / road-out asymmetry has: rail
building is in because rail has no sector of its own, road building is out because roads
DO (`/sector/roads`) and folding it here would double-count them.

Impact, measured:

| | before | after |
|---|---|---|
| headline (`all`) | 6,890,127,007 | **7,264,476,863** (+5.4%) |
| aviation | 3,681,361 | **348,249,809** (94.6×, 3rd-largest mode) |
| maritime | 275,156,710 | 297,108,102 |
| rail | 4,135,802,247 | 4,143,632,264 |
| entities | 11 | 15 |

## Finding 2 — the published „~€5.9 млрд., 11 структури" claim is stale in eight places

**Two of the eight are RENDERED**; the rest are comments that cost nothing at runtime but
sit directly above the code that derives from the constant, which is where the next reader
looks to learn what the set contains. The corpus already says €6.89bn today; after
Finding 1 it says €7.26bn / 15 entities.

| site | rendered? | what it says |
|---|---|---|
| `src/screens/components/procurement/transport/TransportFacilityMap.tsx` (header + caption) | **yes, BG+EN** | „Всичките **11 структури** са **РЕГИСТРИРАНИ в София**" — both halves false after Finding 1: ИАППД's seat is Русе, so the map itself gains a third city while the caption explains a two-city one. Fixed by DERIVING the count and city list from the payload. |
| `scripts/prerender/routes.ts` | **yes, BG+EN** | the `/sector/transport` meta description |
| `scripts/data_map/model.ts` | no (BG+EN copy on `/data`) | „~€5.9 млрд., 11 структури" |
| `src/screens/components/procurement/transport/TransportPack.tsx` | no | THESIS comment |
| `src/data/procurement/useTransport.tsx` | no | header (`€2.2bn vs ~€5.9bn`) |
| `scripts/db/load_transport_facility_map_pg.ts` | no | header ("all 11 … София (9) + Варна (2)") |
| `src/screens/sector/sectorDashboards.ts` | no | enumerates the members as „aviation (ГД ГВА)" — now materially wrong (3 bodies, €348M) |
| `ai/tools/transport.ts` | no | "these tools aggregate the **11-EIK** state-transport group" |

## Finding 3 (observation) — 14.2% of the headline is the group paying itself

**On the post-change 15-EIK set: €1,033,666,762 over 55 contracts.** (On the old 11-EIK
set it was €988,851,550 over 10 — that figure is a correct measurement of a set that no
longer exists, so anything published must use the new one.) Two distinct mechanisms:

- **€980.6M in one contract** — МТС's 2026-02-18 rail-PSO award to БДЖ-Пътнически
  превози, itself a group member spending €517.9M of its own.
- **€44.8M over 45 contracts** — ДП ТСВ as a *contractor to* НКЖИ (€44.3M / 38), БДЖ-ПП
  (€0.4M / 6) and БДЖ-Товарни (€0.15M / 1). This is a shape the group did not have
  before: the first member that is materially a supplier to the group as well as an
  awarder within it, and the direct consequence of admitting a works enterprise.

The **headline is not double-counted** by any of this — it is an awarder-side Σ, so each
contract is counted exactly once, and €7,264,476,863 was verified directly.

Consequence for the mode-split tile: 95% of the €2.42bn „Министерство (централа)" slice
is in fact rail (three PSO lots at CPV 60210000 + two rolling-stock contracts), so the
tile reads „Железници 57%" when the true rail share is ~90%, and a reader takes
„ministry HQ" for a €2.4bn spender in its own right.

Not netted out — the group total is a true statement about what the group awards, and
netting would be a new engine behaviour. Named in a footnote instead.

## Decisions taken (2026-08-13, confirmed with the operator)

**IN** — the four bodies above.

**OUT**, recorded as an anti-allowlist in the reference data so the next audit does not
re-litigate them:

| kept out | EIK(s) | € | why |
|---|---|---|---|
| Български пощи + ИАЕСМИС (the „съобщения" half of МТС) | `121396123`, `131516795` | 256,197,251 | Would need a 6th, non-transport universe; `/sector/transport` stays about moving people and goods. |
| State port OPERATORS (Варна, Русе, Бургас) | `103061301`, `117021078`, `102004532` | 71,148,223 | Commercial ЕАД operators; the sector carries the port INFRASTRUCTURE company (ДППИ) and the regulator (ИА МА). |
| Транспортни болници (НМТБ „Цар Борис III", МТБ Пловдив) | `000662655`, `115214445` | 22,099,021 | МТС-owned but buy medicines and consumables — the ВМА-in-defense distortion, for 0.3% of the sector. |
| КЗК-style regulator: КРС | `121747864` | 38,148,161 | Reports to НС, not МТС; communications, not transport. |
| Метрополитен ЕАД | `000632256` | 1,691,794,317 | Municipal (Столична община) — already documented. |
| АПИ / „Автомагистрали" | `000695089`, `831646048` | — | Separate `roads` sector — already documented. |
| Държавен авиационен оператор | `129009105` | 16,837,512 | Към Министерски съвет; already on `securityReferenceData`'s anti-allowlist. |

## Steps

1. **Reference data** — add the four entities to `TRANSPORT_ENTITIES` in
   `src/lib/transportReferenceData.ts`; add the anti-allowlist block above to the header
   (mirroring `securityReferenceData.ts`'s "EXPLICITLY OUT" section) and the Летище София
   concession note. All four downstream copies and `transport_facility_geo` follow
   automatically — no other EIK list is touched. Also add `transportReferenceData.test.ts`,
   a pure-TS structural gate (see step 4 for why it cannot live only in the PG test).

   ⚠ **This step alone leaves the tree inconsistent, by design** — `transport_facility_geo`
   holds 11 rows against 15 EIKs (so `transport_facility_map.data.test.ts`'s lockstep
   assertion fails) and the committed `sector_stats.json` still reads €6,890,127,007. Step
   5's `db:gen-sector-stats` + `db:load:transport-facility-map:pg` are what close it, and
   until they run `npm run test:data` is red — which, per the CLAUDE.md `db:refresh` note,
   means the rest of the suite goes unrun. Land steps 1 and 5 in the same sitting.
2. **Stale prose** — update the eight sites in Finding 2 to €7.26bn / 15 entities, and name
   aviation in the `/sector/transport` description now that it is a real mode. For the
   facility-map caption, **derive** the count and city list from the payload rather than
   restating them — that string has now had to be chased by hand three times.
3. **Mode-split footnote** — name the intra-group flow on `TransportModeSplitTile` so the
   „Министерство" slice is not read as ministry-HQ spending. Use the post-change figure
   (€1,033.7M / 55), not Finding 3's superseded €988.9M.
4. **Regression tests** — two files, because they fail at different times:
   - `src/lib/transportReferenceData.test.ts` (**new**, no DB) — the structural
     invariants. These must be database-free: the PG gates auto-skip when Postgres is
     down, so on a fresh clone or a database-less CI leg they are unguarded. Transport is
     more exposed than water here — `TRANSPORT_SECTOR_EIKS` is a plain `.map` (not
     `[...new Set]` like `WATER_SECTOR_EIKS`) and `sector_stats.ts` joins it through
     `unnest()` with no dedupe, so a pasted duplicate row double-counts the hub headline
     at a 200 while `ENTITY_BY_EIK` hides it.
   - a `transport sector (procurement / МТС)` block in
     `scripts/db/tests/sector_stats.data.test.ts`: headline band; the four EIK-set copies
     equal; per-EIK € floors; aviation > €250M (the tripwire for re-dropping БУЛАТСА);
     `basis === 'procurement'`.

   ⚠ **Pin the scope per EIK.** Летище София's corpus ends 2021-04-06, so on the default
   `ns` scope, on any `y:<year>` after 2021 and on most `ns:` windows it contributes
   exactly €0 — a floor written against the same scope as the other three fails, and the
   natural "fix" (deleting it) removes the tripwire for the one EIK whose corpus quietly
   stops. Its floor belongs on `all` only. БУЛАТСА is live through 2026, so its floor and
   the aviation tripwire hold under windows too.
5. **Regenerate + verify** — `npm run db:gen-sector-stats`, `npm run db:load:transport-facility-map:pg`,
   `npx tsc -b`, `npm run lint`, the touched vitest suites, and a live check of
   `/governance/sectors` + `/sector/transport`.

## Deploy

- `npm run db:load:awarder-seats:pg:cloud` — **a hard prerequisite, newly load-bearing.**
  The facility loader pins any entity with no seat row (or a Sofia-oblast one) to София
  rather than failing, and ИАППД is the first member whose real seat differs from that
  fallback. On a target whose `awarder_seats` lacks `000513106` it lands in the capital
  with nothing red. `transport_facility_map.data.test.ts` now asserts Русе.
- `data/procurement/derived/sector_stats.json` is bucket-served:
  `npm run bucket:sync:paths -- procurement/derived/sector_stats.json`
- `npm run db:load:transport-facility-map:pg:cloud` (the four new rows)
- `npm run deploy` (reference data, screens, prerendered description)
