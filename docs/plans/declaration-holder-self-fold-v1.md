# `isSpouseHolder` — the declarant's own name, respelled, published as somebody else's

**Status:** measured 2026-09-03 against the full local corpus. Nothing implemented.

`declaration_asset.is_spouse` answers „is this row somebody else's". The rule is
`isSpouseHolder` (`src/lib/declarations.ts`): normalise case and hyphen spacing, then fall
back to a **separator-only** letters-only compare. It already fixes two classes — a lost
space („ПЕТКОАНГЕЛОВ КУЩИРЕВ"), a hyphen standing in for one — and refuses a cell with no
letters. What it does not fix is a declarant who spells their OWN name a second way:
a dropped middle name, an initial, a title, a re-ordering, a Latin homoglyph, a one-letter
slip. Every one of those compares unequal, and the row is published as held by somebody
else.

The register is hand-typed twice per filing — once in the declarant field, once per asset
row — so the two spellings disagreeing is the normal accident, not the exceptional one.

## 1. Measured

Full recompute over 335,676 `declaration_asset` rows; 110,242 are currently published as
„not the declarant". Classes below partition those 110,242. `people` counts distinct
`person.slug`.

| # | class | rows | name pairs | people |
|---|---|---|---|---|
| A | **Latin↔Cyrillic homoglyph** — „Aлександър" with a Latin A | 61 | 22 | 22 |
| B | **declarant + decoration** — „адв.", „в СИО", „/наследство/", „съкредитор" | 1,101 | — | — |
| C | **holder is a shorter form** — middle name dropped | 1,271 | 287 | 247 |
| D | **initial** for the middle name — „Деница С. Славкова" | 75 | 3 | 3 |
| E | **tokens re-ordered** — „Борис Желев Димов" / „Борис Димов Желев" | 68 | 23 | 22 |
| F | **one token truncated / a letter added** — „Александъ Григоров Ангелов" | 977 | 328 | 296 |
| G | **exactly one token differs by one edit** | 4,902 | 2,041 | ~1,800 |
| — | **MIXED — the cell names the declarant AND somebody else** | 5,385 | — | — |
| — | genuinely another person | ~96,400 | 15,987 | 10,214 |

**A–F is ~3,600 rows across ~660 people. A–G is 8,455 rows across 2,319 people** — that
last pair is a direct union measurement, not a sum; the others are per-class and the people
sets overlap.

⚠️ **The class sizes do NOT add across tiers, because each tier changes what the next one
sees.** §1's B and C were measured under today's rule; strip decoration from both sides
first (T1) and 355 of C's rows collapse into plain equality instead. Re-measure after every
tier lands rather than subtracting from this table.

### 1a. Class G is not what it looks like

„One token differs by one edit" reads like the class we must not touch, because
**Петров/Петрова is one edit and is exactly the spouse case this flag exists to mark**. It
is not, and the reason is structural: `oneOff` fires only when *every other token is
identical*. A spouse differs in the given name AND the patronymic AND the family name;
a sibling or a child differs in the given name and the patronymic. Neither can present as
one token off. Split by which token differs:

| the differing token | rows | example |
|---|---|---|
| patronymic (middle) | 2,092 | Адалберт **Огнянав** Йолов ⟂ Адалберт **Огнянов** Йолов |
| family (last), not a masc/fem pair | 1,617 | Аделина Огнянова **Николоваз** ⟂ … **Николова** |
| given (first) | 1,233 | **Aлександър** Стоянов Савов ⟂ **Александър** Стоянов Савов |
| family (last), masc/fem pair | 270 | Айдън Нихадов **Шабанова** ⟂ … **Шабанов** |
| patronymic, masc/fem pair | 136 | Августина **Веселинов** Кайкова ⟂ … **Веселинова** |
| given, masc/fem pair | 34 | **Анели** Веселинова Джагарова ⟂ **АНЕЛИЯ** … |

Only the 270 in row four have a reading in which two people are involved, and even there
the given name and patronymic are identical, so it is far more likely a typed „а". They are
the one residue this plan deliberately keeps — see T5.

## 2. What a false flag actually does to a reader

**No money moves.** `is_spouse` is not in a WHERE clause in any migration — grep
`scripts/db/schema/pg/*.sql`: it is declared in 089 and 104 and otherwise only passed
through a payload. Net worth, the rankings and every SUM are computed by
`is_declared_holding` and `asset_share_multiplier`, which this rule does not touch.

So the whole exposure is a **label**, and it splits by whether the surface can name the
holder:

- **`/person` — mild.** `HolderChip` prints the register's own holder text where there is
  one. A false flag renders the person's own misspelled name beside their own row: odd,
  visibly a typo, and not a claim about anyone else.
- **`/mp-cars`, `/declarations/crypto`, `/declarations/abroad` — the sharp end.** All three
  payloads select `is_spouse` and no holder name, so the „Притежател" column prints the bare
  „друг титуляр". A false flag there is a positive statement that a named public figure's
  declared car / crypto / foreign account is **not theirs**, with nothing on the page to
  qualify it. `MpCarsScreen.tsx:181` and `HolderChip.tsx` both already flag this as the
  remaining half.

Measured on the three registers:

| surface | rows marked „not the declarant" | of those, the declarant's own name |
|---|---|---|
| `/declarations/crypto` (latest scope) | 12 of 34 | **12 — the whole marked set** |
| `/declarations/abroad` (latest scope) | 443 | 21 |
| `/mp-cars` | 402 | 8, plus 47 MIXED |

⚠️ **The crypto register is the worked example and it is a third of the page.** All 12
marked rows in the latest scope belong to one person — Христо Пламенов Панайотов
(`hristo-plamenov-panaiotov-a5c629`) — whose filing spells him „Панаотов" on the asset rows
and „Панайотов" in the declarant field. Twelve of his own holdings (Ripple, BUSD, DogeCoin
…) are published as somebody else's because of one missing „й". A register of 34 rows is
35% wrong on its only ownership column.

**`/mp-cars` is also the one place a false flag moves a COUNT.** `build_car_makes.ts:376`
puts `isSpouse` in the merge key, so a car declared once by the MP and once under a
misspelling of the MP's own name is emitted as **two rows** rather than one. The euro total
is unaffected (each row is share-weighted before bucketing), the row count is not.

## 3. Why no gate catches it

`scripts/db/tests/declaration_is_spouse.data.test.ts` recomputes the stored column from
`holder_name` + `declarant_name` and asserts it matches. That is the right gate for the
defect it was written for — the parser and the live stake renderer drifting apart — and it
is structurally blind to this one: any rule both sides agree on passes, including a wrong
one. It reports 335,676 of 335,676 today.

Related: the comment at `src/lib/declarations.ts:557` says „195 corpus rows share ≥2 tokens
with the declarant and 2 are the same tokens in another order". The measured figures are
**3,507** and **68**. That number does not reproduce under any scoping tried here; re-derive
it or drop it when T6 lands.

## 4. The direction that must not fail

Every rule below moves rows **out of** „somebody else" and never into it. So the cost of an
over-eager fold is not an invented third party — it is the opposite: a spouse's or a child's
declared asset relabelled as the declarant's own, on a public figure's page. That is the
worse direction (it inflates what a named person appears to hold), which is why the tiers
are ordered by confidence and why T5's masc/fem carve-out is kept even though it costs 270
rows.

**Both sides move together or neither does.** The parser stores the column and
`PersonDeclarations` derives the stake side live at render time, so a rule change ships as
a code change *plus* a restamp; between the two, the same corpus says two things about whose
row it is, and the gate above fires. §6 is the chain.

## 5. Tiers

### T0 — name the holder on the three registers (no rule change)

The cheapest fix for the sharpest exposure, and independent of everything below: carry
`holder_name` into the three payloads so the „Притежател" column prints the register's own
text instead of „друг титуляр". A false flag then degrades from a claim into a visible
typo — „Христо Пламенов Панаотов" beside Христо Пламенов Панайотов's own holdings.

- `159_person_crypto.sql` and `169_person_abroad.sql` both already select from
  `declaration_asset a`; add `a.holder_name` to the matview, the route payload and the
  screen column. No backfill, no reload — the matviews are rebuilt by
  `db:load:declarations:pg -- --resolve`.
- `mp_car` (104) has no such column, so this one is a table column + `build_car_makes.ts`
  emitting `holderName` into `data/parliament/mp-cars.json` + `load_mp_roster_pg.ts` +
  105's payload + `MpCarsScreen`.
  ⚠️ **Decide the merge key at the same time.** The builder merges on
  `[detail, acquiredYear, isSpouse]`, so two holders' identical cars already fold into one
  row; emitting a holder name means choosing one of them. Either add `holderName` to the key
  (more rows, each honest) or emit null when the merged rows disagree. Do not silently pick
  the first.

`HolderChip` needs no change — it already prefers the name and falls back to the neutral
label — so T0 is finished the moment the three payloads carry the column.

### T1 — strip decoration from BOTH sides, and fold Latin homoglyphs

Two independent changes, shipped together because both are strictly safe.

**Decoration strip.** A closed allowlist of tokens that decorate a name without naming
anybody — `СИО`, `ЗП`, `ЕТ`, `адв.`, `д-р`, `проф.`, `доц.`, `инж.`, `арх.`, `наследство`,
`дарение`, `съкредитор`, `съдлъжник`, `през <year>`, `ид. част`, and the connectives
`в на от по за и с`. Applied to the holder **and** the declarant.

⚠️ **The declarant side is the half that is easy to skip and it is 355 rows.** Almost all of
class C's „first token differs" population is `declarant_name = „д-р Али Вели Дурмушали"`
against a holder of „Али Вели Дурмушали" — the title is on the *declarant*, and stripping
only the holder leaves every one of them marked.

**Homoglyph fold.** Map the 16 Latin letters that are visually identical to a Cyrillic one
(`A B C E H I J K M N O P S T X Y`) before comparing. 61 rows, 22 pairs, 22 people, and
every one of them is a Cyrillic name with a single Latin letter typed into it. `translit_bg_latin()` in
`000_search_fns.sql` already carries a confusables table for the search side — in the
Cyrillic→Latin direction, so it is not directly reusable, but check it before writing a
second one and keep the two in step if you do.

⚠️ Fold **only** for the comparison. Do not normalise the stored `holder_name` — the
register's own text is what `HolderChip` prints and what T0 exposes.

### T2 — the holder cell contains the whole declarant name plus decoration only

After T1's strip, if the holder's token multiset **contains** the declarant's and every
surplus token is in the decoration allowlist, it is the declarant. **1,101 rows.**

⚠️ **An allowlist, never a heuristic.** The first cut of this used „does the surplus look
like ≥2 name-ish tokens" and mis-folded three cells that name a real second person whose
surname the declarant shares — „Айрие Ибрямова, Алис Ремзиева" (surplus `[АЛИС]`),
„Виктор Стоянов, Цветомир Стоянов" (surplus `[ЦВЕТОМИР]`), „Борислав Божинов Чалъков,
Драгомир Божинов Чалъков" (surplus `[ДРАГОМИР]`). One unknown token is enough to name a
person. The allowlist refuses **5,385** rows on exactly that ground, which is the MIXED
class below.

### T3 — the holder is a shorter form of the declarant's name

Holder tokens ⊂ declarant tokens, holder has ≥2 tokens, **and the first token matches**.
**916 rows** after T1 (1,271 before it).

The first-token pin is what separates „Албена Туджарова ⟂ Албена Иванова Туджарова" from
MOST household members: a child's patronymic is the declarant's given name, not their
patronymic, so no child's FULL three-token name is a subset of the parent's while opening
with the same given name. Without the pin the rule also swallows two-token cells whose
given name was dropped („Димитрова Иванова ⟂ Искра Димитрова Иванова") — same person, but
the evidence is weaker and it is only 2 rows; leave them.

⚠️ **That is a margin, not a proof, and the gap is this tier's dominant shape.** 866 of the
1,308 folded rows have a **two-token** holder („given + family"). A son named after his
father writes exactly that, and it is a strict subset opening with the same given name —
indistinguishable from the declarant's own short form. What carries the fold is that
Bulgarian juniors are uncommon (the convention names a son after the GRANDfather). Do not
widen this tier, and do not drop the pin.

### T4 — an initial where the declarant writes the word

One token is a single letter and prefixes the corresponding declarant token, every other
token identical. **75 rows, 3 pairs** — 70 of them one person („дирк йохан г пергот" ⟂
„Дирк Йохан Густаф Пергот"). Trivial in size, trivial in risk, and the cheapest tier to
verify by hand: the whole population fits on three lines.

### T5 — exactly one token differs by exactly one edit

**4,632 rows** — every other token identical, so per §1a the same human. **Refuse when the
differing pair is a masculine/feminine form of the LAST token** (`X`/`Xа`, `Xски`/`Xска`):
270 rows, kept as a named residue because that is the only single-edit shape with a
two-person reading.

⚠️ **The carve-out is the last token only.** A gender-mismatched *patronymic* beside an
unchanged given name („Августина **Веселинов** Кайкова") is a dropped „а", not a person —
136 rows — and so is the given-name variant „Анели"/„Анелия" (34). Applying the carve-out at
every position keeps 440 rows instead of 270 and buys nothing.

⚠️ **„A spouse or child cannot present as one token off" is true of the Bulgarian
given/patronymic/family triple and FALSE of the triple-given-name convention** this corpus
uses heavily. There a name is [own, father's, grandfather's], so a child is a **rotation**
of the parent — P = [p, f, g] → S = [s, p, f] — sharing two of three tokens, and the
differing pair is matched by value rather than position. One-edit given-name variants are
ordinary there (Мехмед/Мехмет, Ахмед/Ахмет). 0 corpus rows carry the signature, and the
implementation refuses the rotation outright rather than resting on that.

⚠️ **The tier floors at THREE tokens.** At two, „the rest of the name" is a single given
name from a pool of a few hundred: „Ана Петрова" ⟂ „Яна Петрова" is one edit and two
sisters. 0 corpus rows have that shape, so the floor costs nothing.

⚠️ **Do not generalise this to an edit-distance-2 fold or to a similarity score.** At two
edits a spouse becomes reachable, and this is the tier where a wrong fold relabels a
household member's property as a public figure's own.

### T6 — re-ordered tokens

Same multiset, different order. **68 rows, 23 pairs** — the complete list fits in the commit
message, and the first token is the given name in every one of them
(„Айдоан Али Муталиб" ⟂ „Айдоан Муталиб Али"). Last because it is the tier where a naming
convention can produce two people from one token set; verify all 23 by hand before
shipping, and pin the given name as T3 does.

⚠️ **The pin alone does not exclude a father and son.** It keeps a family-name-first
spelling out („Копринков Николай Иванов"), but under the triple-given-name convention P
named after his grandfather is [p, f, p] and P's son named after P is [p, p, f] — same
multiset, same leading token. A **repeated token** is that shape's signature; none of the
23 corpus pairs has one, so the implementation refuses it as well as pinning.

### T7 — a gate that can see a wrong rule

The existing data test stays as it is; it answers a different question. Add:

1. **A unit corpus** in `src/lib/declarations.test.ts` — one fixture per class in §1 with
   the expected verdict, plus the refusals: the three T2 cells whose surplus names a person,
   the 270 masc/fem last-token pairs, and a real spouse („Иван Петров Георгиев" ⟂
   „Мария Иванова Георгиева"). Runs without Postgres.
2. **A residue ratchet** in `declaration_is_spouse.data.test.ts` — re-derive the class
   counts of §1 over the corpus and fail when any of A–G **grows**. A class going to zero is
   the tier landing; a class growing is either a new register spelling or a regression, and
   both want eyes.
3. **A mutation check.** Recompute with each new fold disabled in turn and assert the count
   moves. Without it, „the rule folds initials" is satisfied by a rule that folds nothing,
   which is how §3's blindness got in.

## 6. Restamping — every tier, both sides

A rule change is INERT until the shards are re-stamped, and the local chain is the one in
`isSpouseHolder`'s header. Unlike its neighbours in 089 (`table_num`, `value_basis`,
`held_scope`) this needs **no re-parse and no network**: `holderName` and `declarantName`
are already on the committed shards, so the backfill reads only `data/`.

```bash
npx tsx scripts/declarations/backfill_asset_is_spouse.ts --apply   # shards only
npm run db:load:declarations:pg                                    # phase 1
npm run db:load:declarations:pg -- --resolve                       # phase 2 — refills person_id
npx tsx scripts/declarations/rebuild_post.ts                       # car-makes.json + mp-cars.json
npm run db:load:mp-roster:pg                                       # mp-cars.json → mp_car.is_spouse
```

⚠️ **The last two look skippable and are not.** Neither load phase touches the committed
artifacts; `build_car_makes` writes `isSpouse` into `data/parliament/car-makes.json` and
`mp-cars.json`, and `load_mp_roster_pg.ts` is what puts it in `mp_car`. `buildCarMakes` reads
only each MP's LATEST filing, so a restamp is a no-op unless a flip lands on one — twice now
it has not, which is luck. The first time it does and this step was skipped, `/mp-cars` ships
the old answer at a 200 with nothing failing.

Cloud side is the `:cloud` twin of the two load phases and nothing runs it automatically.
Phase 2 is not optional even though nothing here reads `person_id`: phase 1 TRUNCATEs
`declaration`.

⚠️ **Phase 1 + phase 2 on Cloud SQL degrade `/persons`, `/officials/assets`, `/mp-assets`,
`/declarations/crypto` and `/declarations/abroad` to 500** — phase 1 NULLs every `person_id`,
phase 2 runs 090's `DROP MATERIALIZED VIEW … CASCADE`, and a DbDataTable resource has no
`missingMigration` degrade. Loader wall-clock is **5m30s** (39 s + 4m52s, measured 2026-08-29
on `db-perf-optimized-N-2`); the OUTAGE itself was measured at ~8 minutes on an earlier run
and has not been re-checked, so budget the larger figure. Off-peak only.
The `ship_held_abroad.ts` shape (ship the derived column into the rows already there, keyed
on `(source_url, seq)`) applies exactly here and is the better publish path if these tiers
land more than once — `is_spouse` is derived from two immutable fields, so it is identical
whichever database computes it.

## 7. Deliberately out of scope

- **MIXED — the cell names the declarant and somebody else (5,385 rows).** „Албена Иванова
  Михайлова и Милко Златков Михайлов", „1. Богдан Мирославов Кирилов 1/2 ид. Част 2.
  Александра Миткова Тоскова - Кирилова". `is_spouse` is a boolean over a question with
  three answers, and „the declarant is one of several holders" is not one of them. On
  `/person` the chip already prints the whole cell, so a reader sees both names; T0 gives
  the three registers the same. A third state is a schema change and a separate plan.
- **Normalising `holder_name` at rest.** The register's own words are what we publish; the
  folds are for comparison only.
- **Any similarity score.** `aop_expert_person_links()` (174) is the precedent — it returns
  the unambiguous matches and reports the rest as refused, rather than grading candidates.
  Same rule here: fold what is provably one spelling of one name, and leave the rest marked.
