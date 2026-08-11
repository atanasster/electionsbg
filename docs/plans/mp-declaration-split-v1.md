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

### SHIPPED — and the licence is narrower than this section first assumed

| | before | after |
|---|---:|---:|
| MP↔declarant split pairs | 172 | **132** |
| MPs affected | 119 | **80** |
| declarations reunited with their MP | — | **135** |
| MP↔official name-merges above the mass-name cap | 8 | **0** |

**Four corrections the repo's own gates and a review forced, all worth keeping written
down — every one of them a version of "absence of evidence read as evidence".**

**`registerPeople = 1` is evidence about the REGISTER, not about the name.** It means one
person of that name has ever *filed* — which says nothing about how many exist outside it.
A ЦИК candidate row is a name on a ballot list and a `local` row a name on a council roll;
neither implies a filing, so a namesake who never declared is invisible to the count. The
first cut let that licence any source and produced **145 unlicensed cross-source merges** —
none of them MPs — including „Александър Иванов Иванов" (a mass name, 47 companies) folded
across `candidate` + `official_exec`. `person_resolve.data.test.ts`'s cross-source
invariant caught every one. The arm now merges only sources its counts COVER: `mp` (via
`mpPeople`) and the Court-of-Audit roster sources (via `registerPeople`), the latter read
from `OFFICIAL_DECLARATION_SOURCES` rather than restated, so `president` / `mep` /
`diplomat` cannot fall out of the licence the way they once fell out of
`startsWith("official")`.

**The anchor is per IDENTITY, not per row.** Requiring every *mention* to be from a counted
source rejected the target population itself — nearly every MP also holds candidacies,
gold-keyed to the same mp id by Tier 0 — and took the arm from 42 merged pairs to **2**. A
row inside a component is there because a gold key or corroborant put it there, so it adds
no unvouched-for identity; what must be anchored is each of the two components being
joined. A candidate-only or local-only component still has no anchor and is still refused.

**The count itself went blind exactly where it mattered.** `registerPeople` counted distinct
GUIDs, but a `subject_ref` whose filings ALL carry bare per-document guids contributes
nothing to that count — so a fold with two declarants, one of them guid-less, scored 1 and
read as unique. Same defect as §3, one level down: 11 folds were in that state. It now counts
per IDENTITY — distinct person-guids plus one for each guid-less ref — so a declarant we
cannot name refuses the merge instead of vanishing from it.

**2b was the only name-based rule in `cluster.ts` with no mass-name cap.** `samePartyOffice`
and councillor-`sameLocalSeat` both cap at 12; the mayor exemption does not transfer, since
it rests on one village having one mayor and no seat is exclusive here. Live merges ran to
`namesake_risk` **70**. A cap is not a return to the proxy — 2a asks `<= 1` and refuses a man
for sitting on two boards, while `<= 12` asks only "is this a mass collision", which is the
one question the number can answer. Cost: 3 pairs.

**The gate cited as safety evidence is blind to this population.**
`person_resolve.data.test.ts`'s cross-source invariant exempts any person holding an
`exact_id` role, and `confidence` is written per PERSON rather than per role — so an MP, whose
candidacies are gold-keyed, is exempt for every other role they carry. All **136** MP↔official
common-name persons are invisible to it. Its green says nothing about Tier 2b, and an earlier
draft of this section read it as though it did. The two bounding conditions are now asserted
directly on the merged population instead.

`scripts/person/cluster.test.ts` covers the rule hermetically (48 tests, no database),
including the mass-name cap and an order-independence check — 2b's own unions change what
`find()` returns and the iteration order descends from unordered `SELECT`s, so the component
split is snapshot before any 2b union rather than read live.
`scripts/db/tests/person_tier2_people_count.data.test.ts` pins the OUTCOME rather than
re-deriving the rule in SQL — a second dialect of a merge rule is the drift this repo keeps
paying for (`shlyo_query_fold`, the vote-outcome bucketing) — plus the two over-merge
assertions above, which returned 8 before the cap and 0 after.

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

## 4. Lever C — sized exactly, and NOT run. **8 of the residual 132.**

> **Measured 2026-08-11 from the register's own year listings** — no crawl needed, because a
> declaration's filename carries its person GUID, so `list.xml` alone answers what the
> backfill would yield.
>
> | register year | MP filings we do not hold |
> |---|---:|
> | 2015 | 259 |
> | 2016 | 259 |
> | 2017 | 569 |
> | 2018 | 256 |
> | 2019 | 260 |
> | 2020 | 256 |
> | **total** | **1,859** over **431 distinct declarants** |
>
> **202 of those 431 GUIDs already sit on an officials slug**, so the backfill would mint
> 202 Tier-0 gold unions — the strongest kind, needing no gate change at all. Its effect on
> *this* plan's problem is **8 of the 132 residual pairs**; the rest of the value is the
> audit's D5, an MP wealth history the corpus simply does not have.
>
> **The two prerequisites are verified.** D7 is already fixed — the year comes from
> `latestRegisterYear()` with `DECL_YEARS` as the documented override, not a literal. And
> D5's destructive overwrite is fixed too: the writer now calls `mergeDeclarations(existing,
> decls, targetFolders)`, authoritative for its target year and additive elsewhere, so a
> 2015-2020 run cannot destroy the 2021-2025 filings. That was worth checking before
> proposing the command rather than after.
>
> ```bash
> DECL_YEARS=2015,2016,2017,2018,2019,2020 npm run data -- --declarations
> npm run db:load:declarations:pg && npm run db:resolve:persons \
>   && npm run db:load:declarations:pg -- --resolve
> ```
>
> **Left un-run, deliberately, and this is a scope call rather than a blocker.**
> `parseFinancialDeclarations` does not stop after writing the per-MP files — it goes on to
> rebuild the company index and run the TR integration, so the command above is ~1,859
> fetches plus a multi-stage rebuild that rewrites a wide set of committed files. Firing
> that autonomously for 8 pairs, in a repo where another session was committing throughout,
> is the wrong side of the line; and one-off backfills are an operator action here by
> convention. The measurement is the deliverable, so the decision can be made on numbers
> instead of on a guess.

## 4a. Why the gold key is otherwise exhausted for this population. **1 of 172.**

Cross-checking every officials-side GUID against the MP-category cache
(`raw_data/declarations/`, 783 distinct GUIDs): **1 of 172** appears in both, and that one
is the Зафиров collision above.

These people left parliament before the register covered MPs. MP-category cache years are
`2021_nc, 2022, 2023, 2024, 2025`; the officials cache runs `2015…2025`. Backfilling MP
register years 2015-2020 is worth doing — it is the audit's D5/D7 — but only ~2 of the 172
sat in the 44th NS, so **it is not the lever for this population.** Do not size it as one.

## 5. Lever D — NOT a scrape gap. The premise below is refuted; see the box first.

> **Measured 2026-08-11, and this section's original claim is wrong.** The scraper already
> reads `A_ns_MPL_CV` and already keeps it (`scrape_mps.ts`'s trim list). The field is empty
> because **parliament.bg's `/api/v1/mp-profile/bg/{id}` does not return one** for all but a
> handful of MPs — not because we discard it.
>
> The evidence is the cache vintage. If this were a scrape or cache-reuse artefact, the 8
> populated profiles would be a different generation from the rest. They are not:
>
> | | profiles | fetched |
> |---|---:|---|
> | with a CV | 8 | 2026-05-05 (7), 2026-07-28 (1) |
> | without | 4,276 | 2026-05-05 (3,314), 2026-07-28 (610), 2026-06-28 (240), … |
>
> Same dates, same code path, same result. Re-running the scraper changes nothing, and a
> change written against the premise below would have been unverifiable work on a
> non-existent defect.
>
> **What remains open, and is untested:** parliament.bg renders a biography on the HTML page
> `/bg/MP/{id}`, which is a different surface from the JSON API. Whether it carries prose the
> API omits is not established — the host was unreachable from here throughout (connection
> reset on every attempt; see the VPN source-split note, parliament.bg needs the BG VPN OFF).
> That probe is the whole of the remaining work on this lever, and it must come **before**
> any parser change: if the HTML carries no more than the API, the lever is dead.
>
> Everything below is the original analysis, kept because the *value* of a CV — if one can be
> obtained — is unchanged.

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
4. **Lever D — CLOSED as specified; one probe left.** Not a scrape gap: the API returns no
   CV for 4,276 of 4,284 MPs and our scraper already keeps the field (§5). The only open
   question is whether the HTML page `/bg/MP/{id}` carries a biography the JSON API omits —
   untested, because parliament.bg was unreachable. Probe first; write nothing until it
   answers.
5. **Lever C — sized, not run.** 1,859 MP filings across 2015-2020 over 431 declarants, of
   whom **202 already sit on an officials slug** (→ 202 Tier-0 gold unions). Worth **8** of
   the residual 132 here; the rest of the value is the audit's D5. Both prerequisites are
   verified fixed (§4). Not fired autonomously — the command drags a full company-index and
   TR rebuild behind it, and one-off backfills are an operator action here.

## Not levers

- **Birth date** (§6) — the declaration side publishes none.
- **Shared declared EIK** — `company_politicians` holds only 68 mp-ref and 454
  officials-ref links, and the TR footprint is fold-keyed, so both sides of a pair get the
  *same* company set. It cannot discriminate.
- **`weakBoth` (party AND place)** — an `official_exec` mention carries no `cPlace` at all,
  and `cParty` only for the party-office holders. The MP side's `cPlace` is
  `currentRegion`, populated for the ~240 sitting MPs only. Both halves are missing for
  this population; widening them is a separate piece of work with its own risk.
