# MPs whose declarations sit on a separate person row

Analysis, 2026-08-11. Follows the person-profile enrichment memo
(`docs/plans/person-enrichment-v1.md`). Every figure is measured against local Postgres
and the checked-in data tree on 2026-08-11.

Baseline restated: the earlier run measured **171**; the corpus has since moved by one and
today's count is **172**. Nothing in between changed the resolver, so the population is
pre-existing, exactly as suspected.

The brief is: **reduce the number without loosening the gate.** So each lever below is
scored on what it costs in merge safety, not only on what it yields.

---

## 0. What the population actually is

| | measured |
|---|---:|
| (MP person, declaration-holding person) pairs on the same name fold | **172** |
| distinct MPs affected | **119** |
| declarations stranded on the wrong person row | **462** |
| of those pairs, MP has no declaration of their own at all | 152 |

Not "the MP's own declaration is on another row". These people declared in a **second
capacity** — minister, oblast governor, mayor, ambassador, hospital director, councillor —
and the Сметна палата filed that under an officials slug, which minted its own person.

## 1. One blocker, and it is a mis-specified variable

Every one of the 172 is blocked by **exactly one** condition:

| reason | pairs |
|---|---:|
| `namesakeRisk > 1` | **172** |
| not 3-part | 0 |
| patronymic differs | 0 |

All 172 are 3-part, non-ambiguous, and carry an **identical patronymic**. Tier 2 would
merge every one of them but for `namesakeRisk`.

And `namesakeRisk` does not measure namesakes. It is
`officer_name_counts.company_count` — `COUNT(DISTINCT o.uic)` over `tr_officers`
(`008_connections.sql:283`), i.e. **how many companies an officer of that name sits on**:

- `Ивайло Ангелов Московски` scores **2**: `206165434` (director) and `121856059`
  (representative). Both are his. There is one man of that name in either register, and
  Tier 2 refuses him because he holds two board seats.
- `Стоян Христов Пасев` (MP + областен управител на Варна) scores 2. `Нено Ненов Димов`
  (MP + Minister of Environment) scores 3.

The repo already says this twice, in the two places that had to work around it:

- `cluster.ts`, on `LOCAL_SEAT_NAMESAKE_CAP` — "It says nothing about how many people of
  that name hold office"; the cap was dropped on exclusive seats for that reason.
- `resolve_persons.ts`, Bridge B — a direct people-uniqueness guard that "**supersedes the
  old namesake_risk<=1 proxy** … which conflated one person's multiple companies with
  distinct namesakes".

**It is wrong in both directions, and the second direction is the one that matters here.**
The Сметна палата stamps every filing with a per-declarant GUID, so `COUNT(DISTINCT guid)`
on a name fold is a real count of *people* of that name who have ever filed. Measured:

| | measured |
|---|---:|
| MP persons holding at least one declaration today (i.e. merged) | 969 |
| of those, passed Tier 2 on `namesake_risk <= 1` | 712 |
| **of those, on a fold the register knows ≥2 declarants for** | **11** |
| person rows sitewide passing `namesake_risk <= 1` on a ≥2-declarant fold | **81** |

Those 11 are live merges made on a name the register itself calls ambiguous — among them
`Нина Борисова Димитрова` (MP, 51st NS) merged with the declarations of a school employee
of the same name, and `Емил Димитров Симеонов` on a fold carrying **four** declarants. They
pass today only because their names happen not to appear on companies.

So the gate is not conservative. It is uncalibrated, and it lets through the same class of
case it refuses elsewhere.

---

## 2. Lever A — count people, not companies. **84 of 172.**

Ask the question the gate is for: *is there more than one person of this name in either
register being joined?*

| | measured |
|---|---:|
| folds carrying exactly ONE MP person | **172 / 172** |
| folds carrying exactly ONE register (cacbg GUID) declarant | **84 / 172** |
| both | **84** |
| both, **and** exactly two person rows on the fold in total | **42** |
| MPs unblocked by the standard variant | **84** |
| declarations reunited with their MP | **248** |

The parliament roster never contains two of these names — the MP side is unique for all
172. The whole question is the register side, and for 84 folds the register knows exactly
one declarant. Neither closed set being joined contains an alternative candidate.

**This is the same logical claim today's Tier 2 makes** — "no alternative exists", not
"positive proof" — measured on the right variable. It is Bridge B's shape, applied to the
MP↔officials join instead of the person↔TR one.

Spot-check of the 84, verbatim from the register's own `institution` / `position`:

| MP | the declaration on the other row |
|---|---|
| Нено Ненов Димов | Министерство на околната среда и водите · Министър |
| Ивайло Ангелов Московски | Министерство на транспорта, инф. техн. и съобщенията · Министър |
| Николай Йорданов Събев | Министерство на транспорта и съобщенията · Министър |
| Стоян Христов Пасев | Област - Варна · областен управител |
| Здравко Димитров Димитров | Област - Пловдив · областен управител |
| Ирена Любенова Соколова | Област - Перник · областен управител |
| Пенчо Пламенов Милков | Русе · Кмет |
| Филип Димитров Димитров | Конституционния съд · Съдия |
| Диана Иванова Йорданова | Комисия за финансов надзор · Заместник-председател |
| Димитър Иванов Абаджиев | задгранични представителства · Извънреден и пълномощен посланик |

**State the trade honestly rather than calling it free.** This is a *different* test, not a
strictly weaker one — it admits 84 pairs and would refuse 11 merges that stand today. If
the change ships as a replacement, those 11 must be re-decided (§5), not silently kept.

Two variants, and the choice is the user's:

- **Standard — 84 pairs.** One MP + one register declarant on the fold.
- **Conservative — 42 pairs.** The above, plus: the fold carries exactly TWO person rows
  in total. The 42 pairs this drops sit on folds that also carry a **`local`** officeholder
  row (51 of the 56 extra rows are `local`, 3 `candidate`, 2 `magistrate`) — a third
  identity that has to be decided in the same breath, so refusing them is defensible.

Either way the AND with the existing conditions stays: 3-part, non-ambiguous, identical
patronymic, no patronymic conflict.

## 3. Lever B — 68 of the 70 "collisions" were a resolver bug. **SHIPPED.**

`registerIdByRef()` skips any `subject_ref` carrying more than one GUID (`HAVING
count(DISTINCT guid) = 1`) — correctly, it refuses to guess. But it read the GUID with a
regex that matches a bare guid **anywhere** in the source URL, and that is not what a
person id looks like.

`scripts/officials/slug_identity.ts` already knows this and says so at length: only
`<GUID><filing-seq>.xml` carries a person id. In the 2019-2023 folders the register also
emitted a **bare** guid with no sequence suffix, and that one is per-DOCUMENT — read as an
identity it makes one declarant look like one stranger per extra filing. The officials
ingest learned it the hard way (66 document ids once sat in `_slug_collisions.json`,
splitting real people into orphan profiles). The resolver's SQL never did.

Worked case, `Атанас Зафиров Зафиров` (deputy PM / Minister of Defence): his exec slug's
"second person" is `255f6c79-…-77e8b1401ddb` — the very document guid `slug_identity.ts`
cites in its header.

Counted over `subject_ref`s, on the resolver's own input — `declaration` ∪ the fold-gated
`declaration_subject_alias` (`REGISTER_GUID_SOURCE_SQL`), not `declaration` alone. The two
agree today; the basis is named because a first draft of this table used the narrower one
and reported +58 where the resolver sees +61.

| | naive pattern | person-guid only |
|---|---:|---:|
| `exec` refs skipped as two register persons | 66 | **1** |
| `mp` refs skipped | 4 | **1** |
| `muni` | 0 | 0 |

So there were never 70 collisions to curate — there were **2**, and 68 refs silently losing
the register's own identity assertion. Because the guard is `HAVING … = 1`, the cost was
never a wrong merge; it was **no key at all**, with nothing logged.

Fixed by narrowing the pattern to the person-id filename shape, imported from
`slug_identity.ts` rather than restated (`PERSON_GUID_SQL_PATTERN`) so the two dialects
cannot drift. Narrowing can only ever REMOVE candidate guids, so it cannot invent a union:
a ref goes 2 → 1 (key restored, asserted by the register) or 1 document guid → 0 (no key,
where before it carried one nothing could match).

Measured, same basis: gold keys **21,600 → 21,659** — **+61 refs, −2, 0 changed**. Of the 61
gained, **19 now union with another ref**, and one of those crosses two different names:
`Иванка Славчева Рейзи` ⋃ `Иванка Славчева Веселинова` under `A01B1DCD-…`, a marriage rename
no name-based tier could ever have found, which is exactly what this gold key is for.
Зафиров's exec slug now carries the same person guid as MP ref `4911`.

The 2 lost keys (`kiril-mihailov-voinov-f1e59f`, `peto-vasilev-vlchev-1d751b`) are one filing
each under a document guid **shared with no other ref**, so the key they lose could never have
unioned anything. That premise is not left as an assumption — the gate asserts that no bare
guid is shared by two `subject_ref`s, because the alias UNION (migration 101) attaches one
`source_url` to two refs by design and is the one thing that could break it.

`scripts/db/tests/person_register_guid.data.test.ts` runs both implementations over every
`declaration.source_url` and fails on drift, on the bare-guid filings disappearing (which
would make the test vacuous), and on the real-collision count creeping back toward the
naive one.

Direct yield on the 172 is 1 pair (Зафиров), because only one pair has a GUID on both sides
at all (§4). The other 57 refs are a different, larger win: officials whose several postings
now key to one person.

## 4. Lever C — the register gold key is exhausted for this population. **1 of 172.**

Cross-checking every officials-side GUID against the MP-category cache
(`raw_data/declarations/`, 783 distinct GUIDs): **1 of 172** appears in both, and that one
is the Зафиров collision above.

These people left parliament before the register covered MPs. MP-category cache years are
`2021_nc, 2022, 2023, 2024, 2025`; the officials cache runs `2015…2025`. Backfilling MP
register years 2015-2020 is worth doing — it is the audit's D5/D7 — but only ~2 of the 172
sat in the 44th NS, so **it is not the lever for this population.** Do not size it as one.

## 5. Lever D — the MP biography is a scrape gap, not a data gap. Potential, unmeasured.

`data/parliament/profiles/*.json` carries `A_ns_MPL_CV`, parliament.bg's own biography for
that mpId. It is populated on **8 of 4,284 profiles**. Where it is populated it names
precisely the institutions these declarations were filed for — profile 1 (Любен Корнезов):
"Съдия в Конституционния съд (1991 – 1994 г.)", "заместник-министър на правосъдието",
"председател на Търговишкия и Ямболския окръжен съд".

That is **parliament.bg asserting, about a specific mpId, that this person held that post**
— name-independent evidence of exactly the kind Tier 1 wants, and it would corroborate a
share of the 88 residual pairs that no uniqueness test can reach. Matching declaration
`institution` against the CV today yields **0 of 172**, purely because the field is empty.

Filling it is a `parliament-scrape` change. Until then this lever is worth nothing, and the
memo should not pretend otherwise.

## 6. Lever E — birth date is dead on the declaration side.

`A_ns_MP_BDate` is populated on **4,284 / 4,284** MP profiles and is already wired as a
STRONG corroborant (`cBirth`). The cacbg declaration XML publishes `<EGN>` **empty** and no
birth date at all — verified on the raw filings. There is nothing to join to. Closed.

## 7. The 88 residual — a scoped review queue, not a rule

For folds the register knows ≥2 declarants of, no strong local corroborant exists, and none
of the levers above reaches them. They are correctly split.

They are already review candidates — and that is the problem. `person_review_candidate`
holds **12,663** rows (5,316 `twopart_block`, 7,347 `identical_fullname`) and all 172 of
these sit in it undifferentiated. A scoped report — *MPs with a same-name declarant, ranked
by evidence* — is 172 rows, and the adjudication path already exists end to end
(`person_link_override` → Tier 4, `scripts/person/add_override.ts`). The 11 merges from §1
belong in the same queue, as splits rather than merges.

---

## Recommended order

1. **Lever B — SHIPPED.** Not curation in the end: 68 of the 70 "collisions" were the
   resolver reading a per-document guid as a person id. No gate change, and it fixes a
   class well beyond MPs.
2. **Lever A — replace `namesakeRisk` in the Tier-2 test with the two-register people
   count**, conservative variant first (42), standard (84) once the 11 §1 cases have been
   re-decided. Pin both directions with a data test: no Tier-2 merge on a fold the register
   knows ≥2 declarants for, and no split where both registers know exactly one.
3. **§7 — mint the scoped review report** (172 rows + the 11 splits). This is what carries
   the residual, and it needs no resolver change at all.
4. **Lever D — fill `A_ns_MPL_CV` in the parliament scrape.** Unblocks a corroborant for
   the residual; measure the yield before writing a rule around it.
5. **Lever C — backfill MP register years 2015-2020.** Do it for the corpus (audit D5/D7),
   not for this number.

## Not levers

- **Birth date** (§6) — the declaration side publishes none.
- **Shared declared EIK** — `company_politicians` holds only 68 mp-ref and 454
  officials-ref links, and the TR footprint is fold-keyed, so both sides of a pair get the
  *same* company set. It cannot discriminate.
- **`weakBoth` (party AND place)** — an `official_exec` mention carries no `cPlace` at all,
  and `cParty` only for the party-office holders. The MP side's `cPlace` is
  `currentRegion`, populated for the ~240 sitting MPs only. Both halves are missing for
  this population; widening them is a separate piece of work with its own risk.
