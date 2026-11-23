# Person identity — national ↔ local merge rule (v1)

Status: **PLAN, nothing built.** Written 2026-11-23. Every figure is local Postgres
(`electionsbg` on 5433) on 2026-11-22/23, after the last local `db:resolve:persons`.

## 1. The defect

A person who holds a **local** office (councillor, mayor, район mayor) and also stands
for or sits in **parliament** is published as **two people** whenever the name-only
tiers cannot save them. Worked case: Джипо Николов Джипов.

| person_id | slug | roles |
| --------- | ---- | ----- |
| 37465 | `mp-5202` | MP 51st/52nd NS, МИР Разград (`RAZ`), party `p_6` → `p_72`; candidacies 2024–2026 |
| 37466 | `mp-5202-2` | councillor, Община Разград (`RAZ26`), 2019 + 2023, party `p_6` |

Two consequences, the second one the reason this surfaced:

- two `/person` pages for one MP (the second one under an `mp-…-2` slug, which reads as
  a duplicate MP);
- **Bridge B refuses his Commerce-Registry footprint** — „МАТ" ООД (€10.1M, 90 contracts)
  and „МАТ 2020" ЕООД never reach his profile, because `bridgeB.ts`'s people-uniqueness
  guard sees two `person` rows on one fold. The guard is right; the split is the bug.

## 2. Why no current rule merges them

`clusterBlock` (`scripts/person/cluster.ts`) has five paths, and each misses:

- **Tier 1 `weakBoth` (party AND place)** — the rule that SHOULD fire. It compares
  `corroborants.place` by string equality, and the two sources fill it at different
  grains: a candidacy carries the **oblast/МИР** (`resolve_persons.ts` ~1250, `cPlace:
  oblast`), an MP the region **name** (~995), a local term the **община name** (~1351,
  `cPlace: place`). Разград-the-oblast never equals Разград-the-община, so the rule is
  structurally unable to bridge national ↔ local for ANYONE.
- **`sameLocalSeat` / `sameMayoralty` / `sameCandidacyParty`** — each is intra-source by
  construction (local↔local, local↔official_muni, candidate↔candidate).
- **Tier 2a** (`namesakeRisk <= 1`) — his name sits on 3 registry entries (МАТ, МАТ 2020,
  an NGO), so the company-count proxy refuses him for owning two firms.
- **Tier 2b** — refuses because the local component is `local`-only, which no
  people-count vouches for (condition 3 in that tier's comment). Correct as designed.

## 3. Size of the class (measured)

Same fold, 3-part name, both `active`; one side holds `mp`/`candidate` with a МИР place,
the other ONLY `local` with an obshtina place; same party id; same normalised oblast (§4.2).

| cut | pairs |
| --- | ----- |
| base | **490** (482 folds, 31 involving an MP) |
| uncontested (no other pair on the fold — §4.3) | **475** (28 MP) |
| + namesake cap `company_count <= 12` | **430** |
| + registry `people_n = 1` | **290** |
| of the 430: registry `people_n > 1` | 136 |
| of the 430: registry has never seen the name | 4 |

Джипов is in every cut. Village mayors (`settlement` places) are NOT in these numbers —
see §6.

## 4. The rule — `sameNationalLocal`

A new Tier-1 corroborant beside `sameLocalSeat`, NOT a change to `weakBoth`.

Changing `weakBoth`'s `place` to oblast grain would loosen every local↔local and
candidate↔candidate comparison at once (two councillors of one party in two
municipalities of one oblast would start merging). A dedicated rule touches only the
cross-grain pair that is currently unreachable.

### 4.1 Conditions (all required)

1. One mention is `mp`/`candidate`, the other `local`.
2. `nameShapeOk(a, b, MASS_COLLISION_CAP)` — 3-part, unambiguous, equal patronymic,
   namesake cap 12. Same helper every name rule uses; no opt-out (no exclusive seat here).
3. Same **canonical party id** — `cParty` is already the canonical id on both sources
   (the `party_id` both rows carry in `person_role`), so no new mapping.
4. Same **normalised oblast** (§4.2), compared on the TYPED place code, never on `cPlace`
   (which is a name on MP rows and would re-introduce the string mismatch).
5. The (party, oblast) key is **uncontested in the block** (§4.3).

### 4.2 The oblast key — the one part that is easy to get wrong

Derive it, don't take the first three characters of the code. Measured traps:

- **`SFO_CITY` (Столична община council) starts with `SFO`, which is the МИР code for
  Софийска ОБЛАСТ.** A prefix rule would compare every Sofia city councillor against
  Sofia-province MPs — the exact wrong-person merge this file exists to prevent. Sofia
  city must map to one key covering МИР `S23`/`S24`/`S25` and the `S2xxx` район codes.
- **Plovdiv** has МИР `PDV-00` (city) and `PDV` (province); both are one oblast for
  this purpose.
- Settlement places (village mayors) carry an EKATTE, not an obshtina code.

So: one pure function `oblastKeyFor(placeKind, placeCode)` in its own module with a unit
test over every МИР code in use (31 today) and every obshtina prefix, mapping through
`place_dim` (117) for obshtina/settlement and a fixed table for the four МИР special
cases. Unknown → `null` → the rule does not fire.

### 4.3 Contest guard — block level, like `sameLocalSeat`

Union-find closes over edges, so a pairwise guard cannot stop „two national X's both
match the one local X". Compute, over the whole block, the set of (party, oblastKey)
keys claimed by more than one national COMPONENT or more than one local component, and
exclude every mention on a contested key. Measured: 7 folds / 15 pairs fall out today.
This is the `contestedKeys` pattern already in the file, and the comment above
`sameLocalSeat` explains why it must not be pairwise.

### 4.4 Open decision — registry uniqueness

The 430 → 290 step (`tr_name_fold_people.people_n = 1`) is the one guard that changes
the answer materially, and it is a judgement call:

- **For requiring it:** it is positive evidence, the posture Bridge B and Tier 2b take.
- **Against:** it measures the Commerce Registry's population, which is unrelated to
  local politics; `weakBoth` already merges on party + place with NO registry check, and
  this rule is that rule at the right grain. 136 pairs would stay split purely because
  some namesake owns a company somewhere in Bulgaria.

**DECIDED 2026-11-23: no registry guard** — ship at 430, gated on the sample review in
§8. Original recommendation: ship WITHOUT it (430), because it is party + oblast + full name + a
namesake cap + an uncontested key — strictly more than `weakBoth` demands today — and
hand-review a stratified sample of the 136 before the first resolve (§5, step 3). If the
review finds a wrong merge, add the guard.

## 5. Steps

1. **`oblastKeyFor`** + unit tests (pure, no DB). Include the `SFO_CITY` ≠ `SFO` case as
   a named test.
2. **`sameNationalLocal`** in `cluster.ts`, wired into `shareCorroborant`; unit tests in
   `cluster.test.ts`: the Джипов shape merges; Sofia-city councillor vs Sofia-province MP
   does not; contested key does not; patronymic mismatch does not; namesake > 12 does not.
   The mention needs the typed place — `Mention` gains `oblastKey` (computed at `add()`),
   so `cluster.ts` stays DB-free.
3. **Dry-run report before any resolve.** There is no resolver dry-run today. Add a
   read-only script `scripts/person/measure_national_local.ts` that rebuilds the blocks
   the resolver would build, runs `clusterBlock` with and without the rule, and writes the
   NEW merges (names, slugs on both sides, party, oblast, registry people_n) to the
   scratch dir. Expect ≈430. Hand-review: all MP pairs (~28) and a stratified sample of
   the registry-multi set.
4. **Gate:** `scripts/db/tests/person_national_local.data.test.ts` — (a) Джипов is one
   person and his `person_role` carries `tr` rows for 116011316 and 206034748; (b) no
   active person holds a `local` role in Столична община AND a МИР `SFO` candidacy by
   this rule; (c) a mutation check: recount the class from §3 and require it fell to the
   contested + capped residue, so a rule that silently stopped firing cannot pass;
   (d) skips with a distinct reason on a corpus no resolve has run since the rule.
5. **Local resolve + the 10-step repair chain** (CLAUDE.md, "A LOCAL
   `db:resolve:persons` is never one command"), then `pnpm run test:data`.
6. **Slugs.** The merged person keeps the national slug (lower ordinal / gold key); the
   local slugs (~430, many of them `mp-…-2`-shaped) retire. Confirm the resolver writes
   them into `person_slug_retired` and `collapseSlugRedirectChains` leaves no chain.
7. **Cloud:** `db:resolve:persons:cloud` → the cloud person chain (≈18 min on
   `db-custom-2-13312`, 2026-08-29; expect ~6½ min of 500s on `/persons` & co per the
   2026-10-21 measurement — off-peak) → `person:slugs:cloud` → commit the manifest →
   `deploy`.

## 6. Out of scope (v1)

- **Village mayors** (`village_mayor`, settlement place). `oblastKeyFor` will support it,
  but the class was not measured; enable after a separate count.
- **`official_muni` / `official_exec` ↔ national.** Different sources, different
  evidence; the `samePartyOffice` / Tier 2b paths own those.
- **Party id drift across a career** (a councillor elected on `p_6` who is now an MP
  for `p_72`). Джипов matches because his 2024 candidacy carries `p_6`; someone whose
  every national mention post-dates a party change will still split. Not measured.

## 7. What would make this wrong

- A party with two same-named activists in one oblast, one a councillor and one a
  candidate, and no third mention to contest the key. The namesake cap and the
  patronymic shrink it; §5 step 3's review is the check. Every merge here is reversible
  with `pnpm run person:override split --ref …`.

## 8. Sample review (2026-11-23, by SQL, before any code)

Reviewed the 26 MP pairs in the 430 and a seeded sample of 30 from the 136 the registry
guard would have refused (`md5(a||b)` order). For each pair: every national mention
(party, МИР, election) against every local term (role, party, община, cycle). Raw dump
kept out of the repo; regenerate with the §3 query plus `ORDER BY md5(…) LIMIT 30`.

**Result: 0 pairs with evidence of two different people; 56/56 consistent with one
person.** Several are well-known figures whose split was already visible on the site:

- **Йорданка Фандъкова** — Sofia mayor 2009–2023 (`SFO_CITY`) and MP for МИР 24 are two
  `/person` pages today. The Sofia-city key in §4.2 is what joins them.
- **Иван Тотев** and **Здравко Димитров** — Plovdiv mayors (`PDV22`) and MPs; join only
  through the `PDV-00` ∪ `PDV` mapping.
- **Георги Кадиев** — Sofia councillor 2007 (БСП) and later МИР Стара Загора MP; joins
  through his 2014 `S23` candidacy.

Two shapes are the loose end of the rule and stay accepted, with the reason:

- **The national side spans several МИР** (Владислав Панев: Sofia candidacies, then
  Хасково MP; Хатидже Георгиева: Бургас 2017, then Сливен; Сейфи Мехмедали: Кърджали,
  then Ямбол). The match rides an OLDER candidacy's oblast, not the seat. In every sampled
  case that older candidacy is in the same oblast as the local term, the same party, and
  the same years — the career-move shape, not a namesake. Restricting to the seated МИР
  would re-split all three.
- **Names at the namesake cap** (Христо Стоянов Стоянов: registry 12 people, 12 companies;
  ГЕРБ candidate Стара Загора 2024 vs ГЕРБ councillor Стара Загора 2023). Nothing in the
  data contradicts one person, but nothing beyond party + oblast + name supports it
  either. This is where a wrong merge would come from if there is one. Kept, because the
  cap is the same 12 every other name rule uses; revisit if one is reported.

Decision stands: no registry guard. The dry run in §5 step 3 re-checks the full 430
against what the rule actually emits — this review checked the SQL approximation of it.

## 9. Steps 1–3 built (2026-11-23)

- `scripts/person/oblastKey.ts` (+ test) — `oblastKeyFor`; Sofia city is its own key
  (`SOFIA_CITY`), `PDV-00` folds into `PDV`, settlements return null.
- `cluster.ts` Tier 2c `unionNationalLocal`, run AFTER Tiers 0–2 over the components they
  produced (a pairwise Tier-1 corroborant cannot express "uncontested": a re-elected
  councillor is two mentions of ONE component). `resolve_persons.ts` stamps
  `corroborants.oblastKey` on `mp`/`candidate`/`local` mentions only. 8 unit tests; with the
  tier switched off the Джипов test fails.
- `resolve_persons.ts` — the mention-building half of `main()` is now the read-only
  `buildMentionBlocks()`, so the dry run uses the resolver's own path, not a copy.
- `scripts/person/measure_national_local.ts` — the dry run. Writes to `os.tmpdir()` by
  default (it names real people beside a proposed merge; no repo tree is gitignored).

**Dry run on local Postgres: 417 new joins, 66 involving an MP, 0 on an overridden fold.**
The SQL approximation in §3 said ~430; the difference is the tier seeing COMPONENTS (the
SQL saw final persons). Spot-checked: Джипов, Фандъкова, Тотев, Кадиев, Волен Сидеров
(Sofia councillor, Атака) all join as expected. Weakest MP row: Георги Йорданов Димитров
(`mp-176`, Хасково MP) joins a БСП Велико Търново councillor through a БСП/VTR candidacy
already in his component, register count 0 — worth a human look before step 5.

Not done: step 4 (the data gate), step 5 (local resolve + repair chain), step 7 (cloud).
