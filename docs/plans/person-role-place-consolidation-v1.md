# Consolidate `person_role.place` into a typed place (v1)

**Status:** design (2026-07-27). Goal: `person_role.place` stops being an untyped string
holding five incompatible namespaces, and becomes a **typed `(kind, code, label)` triple**
that the municipal roster can key on, the profile can render, and the resolver can
corroborate across sources.

Builds on / does not duplicate:
- [person-identity-v1.md](person-identity-v1.md) — the `person_role` model (§2), the resolver
  tiers (§3), the source catalog (§5).
- [persons-pg-retirement-v1.md](persons-pg-retirement-v1.md) — T0.2, which is *why* `place`
  started carrying obshtina codes (`102_municipal_officials.sql`).
- [judiciary-vss-v1.md](judiciary-vss-v1.md) — `court_load`, which this plan extends into a
  real institution dimension rather than forking a second one.

## 0. What is actually in the column today (measured, local PG 2026-07-27)

| source | roles | with place | what the string is | distinct |
|---|---|---|---|---|
| `candidate` | 67,065 | 76.0% | site oblast code (`BLG`, `S23`) — **and `PDV` vs `PDV-00`** | 31 |
| `local` | 16,936 | 100% | obshtina **name** (`Благоевград`) | 289 |
| `official_muni` | 6,391 | 100% | obshtina **code** (`BLG11`) | 288 |
| `magistrate` | 3,113 | 87.3% | raw institution string, unnormalized | 975 |
| `mp` | 2,122 | 11.3% | uppercase МИР name (`ПЛОВДИВ ГРАД`) | 29 |
| `regulator` / `ds` / `sanctions` | 45 | 100% | body / decision context / OFAC program — **not a place** | 16 |
| 8 other sources | 47,571 | 0% | — | — |

Five namespaces plus three non-places, in one `text` column, with **no place dimension
anywhere in the database** to normalize against.

### 0a. Three defects this causes in production

1. **Raw obshtina codes render on public `/person` pages.** `person_by_slug`
   ([082_person_api.sql:33](../../scripts/db/schema/pg/082_person_api.sql)) passes `place`
   straight into the roles jsonb and `PersonProfileScreen` prints it as the office badge —
   **6,210 visible `official_muni` rows currently show `BLG11` / `KRZ15` / `MON14` to
   users.** The dedupe at
   [PersonProfileScreen.tsx:105](../../src/screens/person/PersonProfileScreen.tsx) was
   written when `official_muni` was place-*less* (its comment still says so) and only drops
   place-less official rows. So **3,682 people show the same seat twice** — once as
   `Общински съветник — Благоевград` (`local`), once as `Общински съветник — BLG11`
   (`official_muni`).
2. **The place corroborant can never fire cross-source.** `cPlace` is a separate field but
   is fed the same raw values, and [cluster.ts:85](../../scripts/person/cluster.ts) requires
   string equality. `mp`→`БЛАГОЕВГРАД`, `candidate`→`BLG`, `local`→`Благоевград`: no pair can
   match. `official_muni`, which holds the cleanest structured place in the table, sets no
   `cPlace` at all. Weak-both corroboration is within-source only, by construction.
3. **`candidate` is lossy at the source.** `oblasts[0]` discards everything after the first:
   across the 67,065 candidacy shards, **15.9% carry more than one oblast** and **24.0% carry
   none**.

   **Correction to an earlier read of this: `PDV` and `PDV-00` are NOT duplicates.** They are
   two distinct МИР — **`PDV-00` is Пловдив-ГРАД (МИР 16)** and **`PDV` is Пловдив-ОБЛАСТ
   (МИР 17)** — and both exist as their own shard in
   `data/{election}/preferences/by_region/` (31 files = 31 МИР). Folding
   `PDV-00` into `PDV` would merge two separate constituencies. The `PDV-00 → PDV` rule in
   [regionalOblast.ts:47](../../src/lib/regionalOblast.ts) is the **statistical oblast**
   rollup for regional indicators, a different namespace from the electoral one. This is the
   real lesson of [[project_oblast_code_shard_mismatch]] and it is why `candidate`/`mp` get
   `place_kind='mir'` below rather than `'oblast'`.

### 0b. Three jobs, one column

- **Structural key** — `102_municipal_officials.sql:95,126` uses `place` as the obshtina FK
  for the entire municipal roster matview. Load-bearing and correct: the code genuinely
  exists nowhere else in PG (`municipality_join.ts` is the only producer).
- **Display badge** — the offices tile; plus `magistrateRoleKey(r.place)`, which sniffs
  Съдия/Прокурор/Следовател out of the institution *string* client-side.
- **Nothing** — `ds` / `sanctions` / `regulator`. All three already duplicate the value into
  `source_row` (`bodyContext`, `program`, `body`), and the UI renders those facets from
  dedicated payload arrays built off `source_row`, never off `place`. 45 rows of pure
  redundancy.

## Decisions (locked 2026-07-27)

1. **Split by job, don't normalize one string.** Add `place_kind` / `place_code` /
   `place_label`; drop `place`.
2. **A shared judicial-institution dimension with locations**, not a person-layer-local fold
   — `judicial_body` + `judicial_body_alias`, serving both the person layer and the
   judiciary pack. See §2 for why `court_load` cannot be it as-is.
3. **MP historical locations are in scope.** They exist and are recoverable — but not as a
   scalar (§3). The `mp` role gets a most-recent badge; the full history stays in
   `person_election_stats`, which already renders it correctly.
4. **`cPlace` unification is a separate tier** (T4). It changes clustering output and needs
   its own before/after merge diff.

## 1. Schema

```sql
-- 115_person_role_place.sql
ALTER TABLE person_role
  ADD COLUMN IF NOT EXISTS place_kind  text
    CHECK (place_kind IN ('mir', 'obshtina', 'judicial')),
  ADD COLUMN IF NOT EXISTS place_code  text,   -- canonical id within place_kind
  ADD COLUMN IF NOT EXISTS place_label text;   -- Bulgarian display string, precomputed
```

`mir` (electoral constituency, 31 of them) rather than `oblast` (statistical, 28) is the
right kind for electoral roles — see §0a.3. The МИР→oblast rollup already exists in
[regionalOblast.ts](../../src/lib/regionalOblast.ts) and is only needed for T5.

`place_label` is precomputed rather than joined at render time on purpose: every existing
code→name hook (`src/data/municipalities/*`, `src/data/regions/*`) is keyed on the **selected
election**, and a person page is not election-scoped. Carrying the label costs a few hundred
KB across the table and removes the need for a person-page place dictionary entirely.

Per-source mapping:

| source | kind | code | label |
|---|---|---|---|
| `official_muni` | `obshtina` | `official_roster.obshtina` (unchanged) | name via `municipality_join.ts`'s own table |
| `local` | `obshtina` | `d.obshtinaCode` — already in the shard, currently discarded | `d.obshtinaName` |
| `candidate` | `mir` | primary МИР — elected-from, else most preferences (§3) | МИР name |
| `mp` | `mir` | most recent seating МИР (§3) | МИР name |
| `magistrate` | `judicial` | `judicial_body.body_code` | `judicial_body.name` |
| `ds` / `sanctions` / `regulator` | NULL | NULL | NULL |

## 2. The judicial dimension (T2)

**`court_load` cannot be reused as-is.** It holds 208 names across 6 court tiers — courts
only. `magistrate.court` also contains **прокуратури** (`Софийска районна прокуратура`,
`Върховна касационна прокуратура` — 260 distinct strings) and **следствени служби**
(`Национална следствена служба`, `ОСлО при ОП-Видин` — 40 distinct). And `court_load.name` is
itself unnormalized (`АдмС - Благоевград` *and* `АдмС Благоевград` both present): only **9 of
975** magistrate strings match a `court_load.name` exactly.

So the dimension is new, and `court_load` becomes a *consumer* of it:

```sql
-- 116_judicial_body.sql
CREATE TABLE judicial_body (
  body_code   text PRIMARY KEY,        -- 'rs-plovdiv', 'op-varna', 'vks', 'nsls'
  name        text NOT NULL,           -- canonical Bulgarian display name
  kind        text NOT NULL CHECK (kind IN ('court','prosecution','investigation','council')),
  tier        text,                    -- районен|окръжен|апелативен|върховен|административен|военен|специализиран
  place_code  text,                    -- obshtina code where it sits
  place_label text,
  lng         double precision,        -- from court_load for the court half
  lat         double precision
);

CREATE TABLE judicial_body_alias (
  alias_norm text PRIMARY KEY,         -- folded surface form
  body_code  text NOT NULL REFERENCES judicial_body (body_code)
);
```

`kind` replaces the client-side string sniffing in
[src/lib/magistrateRole.ts](../../src/lib/magistrateRole.ts) — the Съдия/Прокурор/Следовател
label becomes a lookup, not a regex, and the currently-unclassifiable tail gets a real
answer.

**Sizing the alias work.** A trivial case+punctuation fold already collapses 975 → 481. The
rest is a bounded abbreviation dictionary (~20 prefixes: `РС`/`ОС`/`АС`/`АдмС`/`РП`/`ОП`/`АП`/
`ВКП`/`ВАП`/`СГП`/`СРП`/`ОСлО`/`ОСО`/`СО`/`ВОП`/`НСлС`, plus `ТО` territorial suffixes) times a
settlement token. `ОП Пловдив` / `ОП-Сливен` / `ОСлО при ОП-Видин` / `СО - СГП` all resolve
mechanically. Expected end state ~330 bodies (208 courts + ~120 prosecution/investigation).
Whatever does not resolve stays NULL and is reported, never guessed.

## 3. MP and candidate places (T3)

MPs do have historical locations, and they are **already correct and complete in
`person_election_stats.regions[].oblast`** — clean site oblast codes (`PVN`, `S25`), one entry
per oblast per election, 66,998 rows covering all 29,622 people with electoral history. That
is what the Области tile renders.

Two facts make a scalar `place` the wrong home for that history:

- **МИР is per-cycle.** `mp_profile.current_region_code` exists but is (a) only populated for
  the 240 currently-seated MPs and (b) the **МИР number** (`23`, `03`) — a *third* namespace,
  neither the oblast code nor the name.
- **It is multi-valued within a single cycle.** mp-3056 ran in both `S25` and `PVN` in
  2026_04_19; 9,418 `person_election_stats` rows are multi-oblast.

### 3a. Picking the primary МИР for a multi-МИР candidacy

Two rules, in order — elected-from first, most-preferences as the fallback:

**Rule 1 — the МИР they were seated from. Backfillable from parliament.bg for every MP.**
Our own corpus cannot answer it (the parliamentary CIK data is votes-only, with no elected
flag per МИР — only the *local* parsers emit `isElected`). But parliament.bg does, on the
`mp-profile` endpoint the scraper **already fetches for all 2,122 MPs** in `--all` mode:

```
GET /api/v1/mp-profile/bg/{mpId}  →  A_ns_Va_name: "23-СОФИЯ"
```

Measured 2026-07-27:
- **200/200 randomly sampled FORMER MPs carry it** — 100% fill, all 31 МИР represented.
- **30/30 sampled current MPs: the profile value is identical** to the `coll-list-ns/bg`
  roster region the scraper uses today. Same field, same value.
- The scraper **discards it**:
  [scrape_mps.ts:394](../../scripts/parliament/scrape_mps.ts) sets
  `currentRegion: mp?.region ?? null`, taking the region only from the *current-NS list*
  lookup, so every former MP gets NULL even though the profile response in hand has it.
  That single line is why `person_role.place` is 11.3% filled for `mp`.

So this is a **field-mapping change to an existing scrape, not a new crawl.** No CIK seat
page, no Cloudflare, no new source. (The scraper's own header caveat — "for original
election-day winners use the CIK seat page (Cloudflare-protected)" — is about per-term seat
*detail*, which is still true; see the provenance caveat below.)

**The crosswalk already exists — no new reference data.**
[src/data/parliament/nsFolders.ts](../../src/data/parliament/nsFolders.ts) carries
`OBLAST_TO_MIR` (all 31, `PDV-00→16`, `PDV→17`, `S23/S24/S25`, `SFO→26`) plus
`ELECTION_TO_NS`, mirrored in `scripts/parsers/region_codes.ts`. Independently re-derived
from the data as a check: learning МИР→oblast from the 202 single-oblast current MPs yields
**31/31 codes with zero ambiguity**, matching the table exactly.

**Provenance caveat — one scalar per person, not per term.** `A_ns_Va_name` is a single
value; for a multi-term MP it cannot be attributed to a specific parliament. On 40
single-term former MPs it landed inside that term's candidacy oblast set 34/40 (85%); the 6
misses are explained by Rule 2's data, not by a bad profile value (see below). This is
exactly why §3b writes it as a **badge, not a history**.

**Rule 2 — most preference votes.** `person_election_stats.regions[].totalVotes` is the
preference votes received in that МИР (`regions[].pref` is the *ballot number*, not a count —
easy to misread; the candidate shards' `prefs` map is the same thing and equally unusable for
this). `argmax(totalVotes)` is unambiguous and available for everyone with region stats.

**What `oblasts` actually means — and why Rule 1 outranks it.** The by-slug shards' `oblasts`
array is built from **preference-vote rows**
([bundle_party_data.ts:357](../../scripts/parties/bundle_party_data.ts), `subset.map(r =>
r.oblast)`), so it is "МИР where this candidate has recorded preferences", **not** "МИР where
they stood on the ballot". That single fact explains both open anomalies: the 24.0% of
candidacies with an empty array (no recorded preferences anywhere), and the 6/40 single-term
MPs whose seated МИР falls outside their candidacy set. The set is a *subset* of the true
ballot МИР, so parliament.bg is the better ground truth wherever the two disagree — Rule 1
wins, and a Rule-1 value outside the candidacy set is not a conflict to be resolved away.

**Rule 1 is a genuine selection, and Rule 2's current proxy is a coin flip.** For the 38
multi-МИР current MPs, the seated МИР is inside the candidacy oblast set **38/38** — so
picking among the candidacies is the right frame. But today's `oblasts[0]` picks the seated
МИР only **18/38 (47%)**. That is the measured value of this fix.

**Coverage split:** Rule 1 now covers **all 2,122 MPs** once the scrape change lands, so it
carries every seated candidacy. Rule 2 carries the non-seated remainder — of the 10,679
multi-МИР candidacies, 1,277 (12.0%) were seated and go to Rule 1, the other 9,402 to Rule 2.

### 3b. What gets written

- `mp.place_code` = the seated МИР from `A_ns_Va_name` (Rule 1), else Rule 2 on the latest
  `election_date`. A **badge**, not a history. Fill goes **11.3% → 100%**.
- `candidate.place_code` = the primary МИР for that candidacy per §3a, replacing `oblasts[0]`
  and its arbitrary-first truncation on the 15.9% multi-МИР rows.
- The full per-cycle, multi-МИР history stays in `person_election_stats`. No duplication.

**Known limit, not fixed here:** the 24.0% of candidacies with an empty `oblasts` array are
**not** recoverable from `person_election_stats` — only 83 of 16,124 have region rows. The gap
is a flat ~1,600 per election across all ten cycles, so it is structural in the candidate
shards, not a data-quality tail. Out of scope; worth its own look.

## Tiers

**T1 — schema + resolver fill (additive, nothing breaks).**
`115_person_role_place.sql`; `resolve_persons.ts` fills the triple alongside the existing
`place` for `official_muni` and `local` (both already hold the code, `local` just discards
it). `ds`/`sanctions`/`regulator` write NULL. Data test: every `official_muni` row has
`place_kind='obshtina'` and a `place_code` matching `^[A-Z]{3}[0-9]{2}$`.

**T2 — judicial dimension.** `116_judicial_body.sql` + a loader building the alias table from
`magistrate.court` ∪ `court_load.name`; `magistrate` roles fill `place_kind='judicial'`.
Report unresolved strings; do not guess. `court_load` keeps its own `name` for now — pointing
it at `body_code` is a follow-up inside the judiciary pack, not a blocker here.

**T3 — MP + candidate backfill (§3).** Three parts, in order:

1. **`scrape_mps.ts`: persist `A_ns_Va_name`.** Add a `seatedRegion` field parsed by the
   existing `parseRegion()` (it already handles the `"23-СОФИЯ"` shape), sourced from the
   profile response rather than the current-NS list, so former MPs stop getting NULL. Widen
   `mp_profile` with `seated_region_code` / `seated_region_name` — keep `current_region_*`
   as-is, it means something different (still-sitting). Needs one `--all --refresh-current`
   run (~10 min, git-committed output).
2. **Resolver**: `mp.place_code` from `seated_region_code` via the existing `OBLAST_TO_MIR`
   inverse; `candidate.place_code` per §3a.
3. **Data tests**: `OBLAST_TO_MIR` is a bijection covering exactly the 31
   `preferences/by_region/*.json` shards; `PDV` / `PDV-00` stay distinct and map to 17 / 16
   respectively; every `mp` role has a `place_code`.

**T4 — consumers switch, `place` drops.**
- `102_municipal_officials.sql`: `r.place` → `r.place_code WHERE r.place_kind='obshtina'`.
  Pure rename, no semantic change.
- `082_person_api.sql`: emit `placeKind` / `placeCode` / `placeLabel` in the roles jsonb.
- `PersonProfileScreen`: render `placeLabel`; **delete the stale place-less dedupe rule** and
  key the dedupe on `(role, place_code)` — that is what actually fixes the 3,682 double-rows.
  `magistrateRoleKey` retires in favour of the server-side `kind`.
- `ALTER TABLE person_role DROP COLUMN place`.

**T5 — `cPlace` unification (separate, gated).** Set `cPlace` uniformly to `oblast:<code>` —
the **statistical** oblast, rolling both obshtina and МИР up to it via
[regionalOblast.ts](../../src/lib/regionalOblast.ts) (`PDV`+`PDV-00`→`PDV`,
`S22..S25`→`SOFIA_CITY`). Rolling up is right *here* and wrong in `place_code`: a corroborant
wants the coarsest namespace two sources can agree in, a badge wants the finest one that is
true. That is what makes weak-both work cross-source and lets `official_muni` contribute a
corroborant for the first time. This **changes clustering
output**: it needs a before/after diff on merge counts and a pass through
`person_review_candidate` before it lands. Do not bundle with T4.

## Cost, risk, deploy

Blast radius is small: two SQL consumers, one resolver, one screen. The work is in the
mapping tables (T2's alias dictionary), not the plumbing.

T1–T3 are additive and can land independently. T4 is the only breaking step and must follow
the migration-before-writer rule (CLAUDE.md): apply `115`/`116` to Cloud SQL, then
`db:resolve:persons:cloud`, then `deploy:db`, then `deploy`. `102` is REFRESHed by
`load_declarations_pg --resolve`, so the roster cannot serve a stale key shape.
