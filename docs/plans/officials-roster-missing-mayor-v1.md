# The „missing mayor" municipalities — four false claims about named sitting mayors

Analysis + plan, 2026-09-03. Every figure below is re-derivable with the command beside it,
against the LOCAL docker Postgres (5433) and the committed `data/officials/municipal/` tree.

---

## 0. What this is about, and why the documented version of it is wrong

`data/<cycle>/officials_diff/<obshtina>.json` compares the CIK-elected mayor against the
Сметна палата roster. `mayor.status = "missing_official"` means **the roster has no mayor
record**, and `computeOverall` folds it to `overallStatus = "missing"`.

Two places in the source describe that population, and both are stale:

| site                                        | claim                                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/data/elections/surfaceTypes.ts:350`    | „on the **2023 cycle** six municipalities (Разград, Бяла, Искър, Мъглиж, Раднево, Макреш)"       |
| `scripts/elections/source_links.ts:196,207` | „six municipalities' sidecars", „the six municipalities whose roster has no mayor record at all" |

⚠️ **Those six are the 2019 cycle's set, not 2023's.** The 2023 sidecar — regenerated today,
while the other four cycles are frozen at 2026-08-10 — carries **four**, and one of them
(Разлог) is absent from the documented list entirely:

```bash
for d in data/*/officials_diff; do echo "$(basename $(dirname $d)): $(grep -l '"status": *"missing_official"' $d/*.json | wc -l)"; done
# 2007: 6   2011: 5   2015: 6   2019: 6   2023: 4
```

```bash
for f in data/*/officials_diff.json; do node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log(process.argv[1],o.generatedAt)' $f; done
# 2007/2011/2015/2019 → 2026-08-10T02:57:*   2023 → 2026-09-03T07:03:10Z
```

So `/sverka` compares a different roster vintage per cycle, and the count anyone quotes
depends on which cycle's sidecar they opened.

## 1. The finding — none of the four is the roster being silent

Three of the four name the **correct, exactly-CIK-matching mayor**. All four filed a
declaration this site already holds and serves.

| obshtina  | município    | the roster actually holds                                             | our defect                                                                  | tier |
| --------- | ------------ | --------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---- |
| **VAR05** | Бяла (Варна) | Пеньо Красимиров Ненов, `Кмет`, descriptorYear 2026 — exact CIK match | resolver name collision: `Бяла/Варна/` → **RSE04**                          | T1   |
| **SZR22** | Мъглиж       | Душо Иванов Гавазов, descriptorYear 2026 — exact CIK match            | listing label `Заместник кмет`; his own filing says „Кмет на Община Мъглиж" | T2   |
| **VID25** | Макреш       | Митко Левчев Антов, descriptorYear 2026 — exact CIK match             | same listing-label defect; filing says „КМЕТ НА ОБЩИНА"                     | T2   |
| **BLG37** | Разлог       | Красимир Иванов Герчев, `Кмет`, filed 2025-05-09                      | `currentBench()` drops `descriptorYear 2025` against `current.year 2026`    | T3   |

**What a reader is told.** `OfficialsDiffTile` renders
`diff_tile_mayor_missing_official` — „Кметът {{cik}} още не е подал декларация." / „Mayor
{{cik}} has not filed a declaration yet." — and `/sverka` renders `sverka_status_missing`
(„Чака декларация" / „Awaiting declaration"). **All four filed.** For Разлог the site serves
the very filing it says does not exist, at
`data/officials/municipal/declarations/krasimir-ivanov-gerchev-2d598a.json`.

⚠️ So the four-state `outcome` in `surfaceTypes.ts` is still the right SHAPE — collapsing it
to a boolean would be strictly worse — but its documented rationale („the roster is SILENT,
not contradicting") is false for 4 of 4 today. Fix the join before re-writing the comment;
the comment is not the defect.

## 2. Бяла — a wrong-municipality attribution, not a gap

`scripts/officials/municipality_join.ts:215` captures the oblast disambiguator and throws it
away:

```ts
const slashMatch = trimmed.match(/^([^/]+)\/([^/]+)\/$/);
const bare = slashMatch[1]!.trim(); // slashMatch[2] — the oblast — is never read
const code = byName.get(normalize(bare)); // last-write-wins over municipalities.json
```

The file's own header already predicts this — „if multiple obshtini share the name the
operator must add an alias. For now, return whatever the dedup map holds" — and no alias was
ever added (`_aliases.json` holds 5 entries, none for Бяла).

```bash
npx tsx -e 'import {buildResolver} from "./scripts/officials/municipality_join";
const r=buildResolver(); for (const n of ["Бяла/Варна/","Бяла/Русе/"]) console.log(n, r(n));'
# Бяла/Варна/ -> { code: "RSE04", ... }      ← Бяла, РУСЕ
# Бяла/Русе/  -> { code: "RSE04", ... }
```

**`бяла` is the only true collision in the resolver's map.** `искър` and `средец` also collide
in `data/municipalities.json`, but rule 3 routes the Sofia райони (`S2414`, `S2401`) out
through `sofiaRayonByName` before `byName` is consulted, and the register spells them
`Район Искър` / `Район Средец`. Verified — `S2414`, `PVN23`, `S2401`, `BGS06` all carry the
right mayor.

Consequences, measured:

- **VAR05 is the ONE municipality of 288 with no shard file at all**, and it is absent from
  `official_roster` entirely.
  ```bash
  node -e 'const ms=JSON.parse(require("fs").readFileSync("data/municipalities.json")).filter(m=>m.oblast!=="32");
  const s=new Set(require("fs").readdirSync("data/officials/municipal/by_obshtina").map(f=>f.replace(".json","")));
  console.log(ms.filter(m=>!s.has(m.obshtina)).map(m=>m.obshtina+" "+m.name));'   # [ "VAR05 Бяла" ]
  ```
- **RSE04 carries the merged roster of both municipalities** — 36 rows, **2 mayors, 2 council
  chairs, 27 councillors**. Fifteen named Бяла (Варна) officials are published as Бяла (Русе)'s.
  ```sql
  SELECT obshtina, count(*) n, count(*) FILTER (WHERE role='mayor') mayors
    FROM official_roster WHERE obshtina IN ('RSE04','VAR05') GROUP BY 1;
  -- RSE04 | 36 | 2      (VAR05: no row)
  ```
  Its second „council chair" is Анастас Костов Трендафилов — the man CIK recorded as **Бяла
  (Варна)'s** mayor in 2007, 2011 and 2015.
- The VAR05 sidecar reports **0 of 11 councillors matched**, which reads as a total roster
  failure rather than a lookup bug.

`municipal_officials_table` (102) is NOT affected — it keys on the register's institution
NAME, so it keeps „Бяла/Варна/" and „Бяла/Русе/" apart. Only the obshtina-code-keyed path
breaks. That asymmetry is why the defect survived: the governance roster tile looks right.

## 3. Мъглиж / Макреш — the listing-label trap, one tier down

`mapRole()` is correct; its **input** is wrong. `scripts/officials/municipal.ts:112` reads
`Position > Name` out of the register's `list.xml` — the LISTING label, a group bucket — and
never the filing's own `<Personal><Position>`. That is the exact class `CLAUDE.md` documents
under `declared_label()`: „Rendering a listing label as a person's job publishes a false
claim about a named individual."

Postgres already holds the right answer. Sweeping the whole corpus for the class returns
exactly three municipal-tier hits:

```sql
SELECT declaration_year, institution, declarant_name, position_title, filed_position
  FROM declaration
 WHERE position_title ILIKE '%заместник%'
   AND filed_position ~* '^\s*кмет\s*(на)?\s*(община|общ\.)?\s*[^,;]*$'
   AND filed_position !~* 'заместник|зам\.|кметство|район|населено'
   AND declaration_year >= 2025;
```

```
2026 | Макреш  | МИТКО ЛЕВЧЕВ АНТОВ     | Заместник кмет | КМЕТ НА ОБЩИНА
2026 | Мъглиж  | Душо Иванов Гавазов    | Заместник кмет | Кмет на Община Мъглиж
2025 | Разград | Добрин Младенов Добрев | Заместник кмет | Кмет
```

(The party-tier rows the same query returns are correct — a party deputy chair who is also a
mayor. Filter on the municipal tier.)

⚠️ **Разград is why the count went 6 → 4, and it is not a fix: the register itself relabelled
him `Кмет` in its 2026 folder.** The defect self-heals only by luck upstream, so the count is
a coin-flip on the source's own data entry, not a trend.

The contradiction is already visible on one profile — `person_role` gives Гавазов both offices
from two of our own pipelines:

```
dusho-ivanov-gavazov-ac3222 | local         | mayor        | 2023_10_29_mi:SZR22:mayor
dusho-ivanov-gavazov-ac3222 | official_muni | deputy_mayor | dusho-ivanov-gavazov-ac3222
```

`official_roster` has exactly two obshtini with zero mayor rows — SZR22 and VID25 — and they
are these two.

## 4. Разлог — a year filter, not an absence

`currentBench()` (`scripts/officials/build_municipal_shards.ts:73`) keeps
`descriptorYear === current.year`, and `current.year` is 2026. Разлог's descriptorYear
histogram is `{2025: 1, 2026: 26}` — the single 2025 row is the mayor. So the shard publishes a
município with three deputy mayors, a council chair and **no mayor**, which is not a state that
exists in Bulgarian local government.

The rule itself is right and its header argues for it correctly („a councillor who left last
year rendered beside the sitting ones is simply wrong"). What is missing is that a **mayor with
no successor in the current year** is different from a departed councillor: the office is not
vacant, the register merely has not re-listed the incumbent.

## 5. Why nothing caught it

`scripts/db/tests/official_roster_obshtina.data.test.ts` has four assertions and **all four are
shard-relative**:

- „every municipal roster row carries an obshtina code" — VAR05 contributes no rows
- „person_role carries a typed obshtina place" — same
- „every code in person_role matches a real obshtina shard" — RSE04 is a real shard
- „every shard row is in Postgres under the same code" — the merged rows ARE in Postgres

None asks whether the shard SET **covers** `data/municipalities.json`, so a município with no
shard at all is invisible to every one of them, and a município with two rosters merged into one
is indistinguishable from a large município. There is no test file for
`municipality_join.ts` or `build_municipal_shards.ts` at all.

---

## The work

### T1 — Бяла: stop the wrong-municipality attribution (highest severity)

The cheapest correct fix is the resolver, not the alias file: an alias fixes Бяла and leaves the
next collision to fail the same silent way.

1. `municipality_join.ts` rule 4 — use `slashMatch[2]`. Build a second map keyed
   `(normalised name, oblast name)` from `data/municipalities.json`, try it first, and fall back
   to the bare lookup ONLY when the bare name is unambiguous.
2. **A bare name that is ambiguous must return `null`, not a guess.** `municipal.ts` already
   collects unmatched rows and fails loud above a threshold — that is the correct destination for
   an unresolvable collision. Returning `RSE04` is how 15 register entries (14 of them on the current bench) ended up on
   the wrong municipality's page.
3. Keep the alias escape hatch; add `"Бяла/Варна/": "VAR05"` only if the oblast map cannot
   resolve it (it can — `data/municipalities.json` carries `oblast: "VAR"`).
4. Re-emit shards: `npx tsx scripts/officials/build_municipal_shards.ts` (seconds, no re-scrape).
   Expect VAR05 to appear with 14 rows (its 2026 bench; the 15th is a 2025 councillor) and RSE04
   to drop from 35 to ~20.
5. Reload, in this order — `refresh_coverage.test.ts`'s `ORDER_PAIRS` pins the first pair:
   `npm run db:load:ngo-board-links` (the repo's sole `TRUNCATE official_roster`) →
   `npm run db:load:council:pg` (its `roster_code` bridge and every `council_vote.person_id`
   resolve against that table) → `npm run db:resolve:persons`, since `person_role.place_code`
   is copied from the shards and 14 people currently carry `RSE04`. Cloud side is the `:cloud`
   twins; nothing runs them automatically.

⚠️ `db:resolve:persons` reassigns `person_id` ordinals — see CLAUDE.md's „A LOCAL
`db:resolve:persons` is never one command" — so the repair chain (declarations phase 2,
person-elections, council, persons-browse, person-search, graph, tr-company-place) is owed
after it. Budget for that before starting, or batch T1 with other roster work.

### T2 — Мъглиж / Макреш: take the role from the declarant, not the listing

`municipal.ts`'s listing parse has only `list.xml` in hand — the filing's `<Personal><Position>`
is parsed later, per declaration. Two shapes, in preference order:

- **(a) Reconcile after the filings are parsed.** Where the filing's own position maps to a role
  that differs from the listing's, prefer the filing and record both. This matches how
  `declared_label()` already treats the pair everywhere else in the repo, and it is the only
  option that generalises past the mayor/deputy case.
- **(b) A targeted post-pass** restricted to `deputy_mayor` rows whose `filed_position` states a
  municipal mayoralty, promoting them. Narrower, cheaper, and does not touch the 6,647-row
  ingest — but it is a second rule about roles living away from `mapRole`.

Prefer (a). Whichever ships, `roleRaw` must keep the listing's verbatim string so the
disagreement stays inspectable rather than being overwritten.

⚠️ A promotion changes a person's published OFFICE. Print every flip and diff it by hand before
the first apply; the sweep in §3 is the whole population today (2 rows).

### T3 — Разлог: an incumbent with no successor is not a vacancy

In `currentBench()`, after filtering to `current.year`, carry forward a **single-holder office**
(`mayor`, `council_chair`) from the most recent prior year when the current year names nobody in
that office for that município. Do not carry councillors or deputies — the header's argument
against stale benches holds for those.

Mark carried rows so the UI can date them („последна декларация 2025"). A silently carried row
re-creates the problem one level up: the reader would be told the mayor is current when the
roster last saw them a year ago.

### T4 — gates (none of these exists today)

1. `scripts/officials/municipality_join.test.ts` — every name in `data/municipalities.json`
   resolves to its OWN code; every registry name in `index.json` resolves; an ambiguous bare name
   returns `null`. **Include a mutation check**: with the oblast arm removed, `Бяла/Варна/` must
   resolve to `RSE04` and the test must go red — otherwise the assertion is satisfied by the
   broken implementation.
2. Extend `official_roster_obshtina.data.test.ts` with the missing DIRECTION: every
   non-oblast-32 code in `data/municipalities.json` has a shard, and no shard carries two rows in
   a single-holder role (`mayor`, `council_chair`). Both fail today.
3. `scripts/db/tests/officials_diff_missing.data.test.ts` — for every `missing_official` sidecar,
   assert the roster genuinely holds no filing for the CIK-named mayor. Today all four have one,
   so this fails on the current corpus and passes only once T1–T3 land. Skip with a DISTINCT
   reason when the sidecars are absent; „no sidecars" must never read as „no false claims".
4. Regenerate the four frozen cycles' sidecars in the same run as the live one, or state in
   `reconcile_officials.ts` that older cycles are pinned — currently neither is true.

### T5 — copy and comments (do LAST, after the numbers move)

- `src/data/elections/surfaceTypes.ts:350` and `scripts/elections/source_links.ts:196,207` —
  re-state the population per cycle rather than as a bare „six", and drop „the roster is SILENT"
  unless §T4.3 is green.
- `SverkaScreen.tsx:99` renders a **hardcoded Bulgarian** „(без декларация)" with no i18n key —
  it stays Bulgarian on `/en`. Give it a key while the file is open.
- Once T1–T3 land, `missing_official` should describe an actual absence. Re-check the four
  affected `/local/<cycle>/<code>` tiles and `/sverka` before closing.

## Ordering

T1 and T2 are independent of each other and both are independent of T3. T4.1/T4.2 can land
with T1; T4.3 must land after all three or it is red for the wrong reason. T5 last — the
comments describe a population that is about to change.
