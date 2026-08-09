# MP party affiliation in `person_role` (v1)

**Status:** ready to implement — all decisions approved 2026-08-08 (§7), nothing blocking T1.
Design 2026-08-07, audited twice and corrected 2026-08-08. Goal:
`person_role.party` stops being unconditionally NULL for `role = 'mp'`, and MP rows carry the
**parliamentary group they actually sat in, per parliament**, in the same canonical vocabulary
every other role already speaks.

Builds on / does not duplicate:
- [person-identity-v1.md](person-identity-v1.md) — the `person_role` model (§2), the resolver
  tiers (§3), the source catalog (§5).
- [person-role-place-consolidation-v1.md](person-role-place-consolidation-v1.md) — the
  precedent for this exact shape of defect: one `text` column carrying several incompatible
  namespaces, fixed by typing it rather than by filling it.
- [persons-browser-v1.md](persons-browser-v1.md) — `party_primary` vs `party_codes` (F6, F10).

> **Audit note (2026-08-07).** The first draft of this plan measured coverage by joining
> `person_role.ref = mp_seat.mp_id::text`. That join is invalid (§0f) and every headline number
> derived from it was wrong: coverage 843 → **563**, blanks filled 149 → **0**, multi-party
> careers 158 → **132**. The design decision in §2 survives unchanged; the *reason to do the
> work* changed.
>
> **Second audit (2026-08-08).** Re-measured with the class-B aliases actually RESOLVED
> (§1b) rather than guessed: the flip count is **124**, not the 224 the first audit reported —
> mapping `ПБ` to its real id `p_20` instead of a placeholder `p_6` halved it, because 97 of the
> 130 ПБ members already display `p_20` from their candidacy. Four further gaps found, all in
> §2b/§2d/§5.7 and none of them party columns: migration 120 **does** need edits under T3, a
> `functions/` route breaks, `independent` renders as a raw Latin token, and the crosswalk
> already exists client-side. Numbers below are the corrected ones, all measured against local
> PG :5433.

---

## 0. What is actually true today (measured, local PG :5433, 2026-08-07)

### 0a. The NULL is deliberate, not an omission

[`resolve_persons.ts:1643-1650`](../../scripts/person/resolve_persons.ts) writes it explicitly:

```ts
// The CANONICAL party id behind this role, when the source speaks that namespace
// (candidacies, local mandates, donations, and a party officer's institution all
// resolve through canonical_parties.json). `mp` is excluded: its party corroborant
// is a parliamentary-GROUP short name, not a party id, and mixing the two in one
// column would make them look comparable. …
m.source === "mp" ? null : m.raw.cParty,
```

The MP corroborant **is** computed — [`:674`](../../scripts/person/resolve_persons.ts) sets
`cParty: mp.currentPartyGroupShort` — and then dropped at write. So this plan is not "find the
missing data"; it is **"earn the right to persist a value that was correctly refused"**. The
comment states the precondition: a group short name is not a canonical party id. Meeting that
precondition is the whole job.

### 0b. Party fill by role — and why the headline "48% of councillors" is an artifact

| role | source | rows | with party |
|---|---|---|---|
| `candidate` | `candidate` | 67,065 | 50,919 (75.9%) |
| `councillor` | `local` | 15,530 | 9,832 (63.3%) |
| `councillor` | `official_muni` | 4,822 | **0** |
| `village_mayor` | `local` | 8,301 | 5,336 (64.3%) |
| `mayor` | `local` | 1,442 | 963 (66.8%) |
| `donor` | `donor` | 1,283 | 1,283 (100%) |
| **`mp`** | **`mp`** | **2,122** | **0** |

`councillor` is not 48%-covered; it is **two sources**, one of which (`official_muni`, the
Сметна палата municipal filings) speaks no party namespace at all and never did. Aggregating
by `role` alone hides that. The rule that actually holds is: **a role carries a party iff its
source speaks the `canonical_parties.json` namespace** — and `mp` is the only source that has
a party in hand and refuses it.

### 0c. Four defects, and only one of them is the one in the ticket

**The premise "every MP shows „—" and `?party=` matches no MP" is false.** Measured:

| | MP-persons |
|---|---|
| total with an `mp` role | 2,120 |
| `party_primary` non-NULL **today** | **1,396 (65.8%)** |
| `party_primary` NULL today | 724 (34.2%) |
| matched by `?party=gerb` today | **339** |

`party_codes`/`party_primary` are grouped **per person across all roles**, so an MP who also
stood as a candidate already inherits a party from the `candidate` row. The browser is not
blank; it is **wrong in a way that looks right**, which is worse. The real defects:

1. **The party shown for an MP is their BALLOT party, never their parliamentary group.** A
   member who was elected on the ГЕРБ list and left the group for НЕЗ still reads `gerb`,
   because the only party-bearing row is the candidacy. **179 of 2,366 seats (7.57%) change
   party mid-term** — that fact is in `vote_cast` and exists **nowhere** in `person_role`.
   **This is the whole plan.** After the corrections in §0f it is the *only* defect this work
   fixes, and it is worth fixing on its own.

   **Defection is not even the sharpest case — a COALITION SPLITTING is** (confirmed by the
   operator 2026-08-08). One ballot entity can become several parliamentary groups, and
   `party_dim` records ПП-ДБ doing exactly that:

   | NS | how ПП-ДБ sat |
   |---|---|
   | 49, 50 | **one** group, `ПП-ДБ` (74 seats in the 49th) |
   | 51 | one group (both spacings of the same short) |
   | 52 | **two** groups — `ДБ` 33 seats, `ПП` 18 |

   For those 51 members of the 52nd, the ballot label cannot answer which group they sit in,
   because it is the same label for both. Measured against what `/persons` shows them as today:
   11 display `p_6`, the coalition (they will correctly become `p_72`/`p_67`); 7 display a
   *component* party (`p_103`, `p_97`, `p_113`, `p_52`); and **3 members who sit in the ДБ
   group display `p_67` — ПП, the OTHER group of their own coalition**: Богомил Иванов Петков,
   Татяна Славова Султанова-Сивева, Бойко Илиев Рашков. That is not a coarse label, it is the
   wrong one, and no amount of ballot data fixes it.
2. **724 MPs show a blank ПАРТИЯ, and NONE of them are fixable.** The first draft claimed 149
   were. They are not: every MP whose seat can be honestly confirmed already carries a ballot
   party from a candidacy (§0f). A plan that promises to fill this column is promising
   something the corpus cannot deliver — see §1c.
3. **`party_primary` will change for 124 people the moment MP party is populated.**
   `role_prominence('mp', …) = 100`, the highest value in the function — above
   `official_exec` (90) and far above `candidate` (30) — and `top_party` is
   `DISTINCT ON (person_id) … ORDER BY prom DESC, …`. So an MP-sourced party **always** wins.
   562 MPs gain an mp-sourced party; for 438 of them it folds to the same canonical id they
   already display, so **124 visibly change**. This is the largest silent-change risk in the
   plan and §5 gates it. (The first draft said ~1,396, which is simply the count of MPs holding
   any party at all — not the set that changes.)
4. **The `top_party` tiebreaker is dead.** `ORDER BY person_id, prom DESC, start_date DESC
   NULLS LAST, ref` — but `start_date` and `end_date` are **100% NULL across all 310,193
   `person_role` rows**. The ordering is really `prom DESC, ref`, i.e. lexicographic on an
   opaque key. Any design that puts two party-bearing MP rows on one person **must** fill
   `start_date` or it picks a representative party at random and the determinism gate
   ([`person_browse.data.test.ts:754-770`](../../scripts/db/tests/person_browse.data.test.ts))
   still passes, because an arbitrary choice is stable.

### 0d. Blast radius of the VALUE: `person_role.party` has exactly ONE production reader

| consumer | reads `person_role.party`? | effect |
|---|---|---|
| **120 `person_browse_table`** | **YES** — [`:145,162-166,211-216`](../../scripts/db/schema/pg/120_person_browse.sql) | `party_primary` (scalar) + `party_codes` (padded set) + `parties_n`. **The only one.** |
| 126 `person_search` | transitively — [`load_person_search_pg.ts:61,68`](../../scripts/db/load_person_search_pg.ts) copies `party_primary` | loaded, **never rendered** ([`personSearchGroups.ts:106`](../../src/screens/components/procurement/personSearchGroups.ts)) |
| 127/128/129 the graph | **NO** — `graph_person_node.party` comes from `person_election_stats.party_nick` ([`load_graph_pg.ts:256-258`](../../scripts/db/load_graph_pg.ts)) | unaffected |
| 082 `person_by_slug` (`/person`) | **NO** — the roles array omits `party`; the header badge is `person_election_stats.party_nick` ([`082:364-380`](../../scripts/db/schema/pg/082_person_api.sql)) | unaffected |
| `person_resolve.data.test.ts:79-82` | **YES** — the party-office merge-licence gate | see §5.4 — this one is a *hazard*, not a consumer |

Both 120 columns are built from `person_role.party` with **no MP-specific branch**, so they
pick up the change automatically and **migration 120 needs no edit for the party work**.

**Read that last clause narrowly. This table covers T1/T2 only** — the change to the VALUE.
T3 changes the `ref` FORMAT and the ROW COUNT, and under T3 **migration 120 DOES need two
edits**, neither of them a party column: the photo join (`:250`) and the company bridge
(`:314`), both of which key on the bare ref and both of which fail silently. Full list in §2b.

### 0e. Five party vocabularies, and only one is the target

| # | Where | Example values | Grain |
|---|---|---|---|
| 1 | **`person_role.party`** — `canonical_parties.json` `id` | `gerb`, `bsp`, `p_16`, `p_6`, `ataka` | the target |
| 2 | `party_dim.short` / session `mpParty` | `ГЕРБ-СДС`, `ГЕРБ - СДС`, `НЕЗ`, `ПБ` | per-NS, **unnormalised** |
| 3 | `index.json.currentPartyGroupShort` | `ПГ на ВЪЗРАЖДАНЕ`, `ПГ "Прогресивна България"` | current NS only |
| 4 | `data/procurement/derived/mp_party.json` | `ПрБ`, `Възраждане`, `Величие` | CIK nicknames, global |
| 5 | `person_election_stats.party_nick` | `ГЕРБ-СДС`, `Възраждане` | per-election ballot |

Vocabulary 1 is not negotiable: the ПАРТИЯ column renders
`displayNameForId(p.partyPrimary)` ([`PersonsBrowserScreen.tsx:515`](../../src/screens/persons/PersonsBrowserScreen.tsx))
and colours the row with `colorFor(...)`, both keyed on canonical ids. Writing vocabulary 2
into the column would render the raw Cyrillic string through the `|| p.partyPrimary` fallback,
fail to colour it, **and split the facet dropdown into `gerb` and `ГЕРБ - СДС` as two separate
options for the same party** — the exact "makes them look comparable" failure
[`:1647`](../../scripts/person/resolve_persons.ts) refuses.

Note two ids already live in the column that are **not** in `canonical_parties.json` —
`independent` (517 rows) and `vmro` (424), both minted by
[`local_coalitions.ts:21`](../../scripts/parsers_local/local_coalitions.ts). There is
precedent for an out-of-file id, and §1b uses it — **but the precedent is a BROKEN one, and
§1b inherits the breakage.** See §0g.

### 0f. THE BLOCKER — `person_role.ref` and `mp_seat.mp_id` are different id spaces

This is the finding that rewrote the plan. **Read it before writing any code.**

- `person_role.ref` for `source='mp'` is a parliament.bg **profile** id: person-scoped, one row
  per human, sourced from `data/parliament/index.json`, whose `nsFolders` field lists exactly
  the parliaments that person sat in.
- `mp_seat.mp_id` is a **per-parliament seat** id. It is unique only within `(ns, mp_id)` —
  that composite is its PK, and [`134_rollcall.sql`](../../scripts/db/schema/pg/134_rollcall.sql)
  calls it "the (ns, mp_id) dimension the id recycling forces".

They are **not the same key space**, and joining them bare attributes one person's parliamentary
group to another person. Measured:

| join | pairs | name agreement |
|---|---|---|
| `person_role.ref = mp_seat.mp_id::text` (bare) | 1,831 | 82.7% — **316 pairs name a different person** |
| …restricted to NS **in** that MP's `nsFolders` | 1,522 | **99.4%** |
| …NS **not in** `nsFolders` | 309 | **0.6%** |

The 9 in-folder residuals are benign — one Latin-`a` homoglyph (`Радослaвов`) and two
maiden/married pairs (`Сачева` / `Сачева-Атанасова`, `Желязкова` / `Василева`). Everything
*outside* the guard is a different human. Worked example:

```
person_role ref 3103  → Димитър Бойчев Петров      (index.json nsFolders 41,42,43,44)
mp_seat (44, 3103)    → ДИМИТЪР БОЙЧЕВ ПЕТРОВ      ✓ same person
mp_seat (51, 3103)    → ДЕНИЦА ДИМИТРОВА СИМЕОНОВА ✗ a different member entirely
```

**The guard is `nsFolders`**, available two ways — as `nsFolders` on `data/parliament/index.json`
(which the resolver already opens, and which is the only one available at resolve time, §2c),
and as `mp_profile.ns_folders` in Postgres (migration 104) for gates and tests.

**Why `rollcall.data.test.ts` did not catch this.** Its gate at `:96` finds exactly 26 recycled
ids, but it looks *within* `mp_seat`, where `(ns, mp_id)` is the PK and the name is stored per
seat — it structurally cannot see a divergence between `mp_seat` and `person_role`. Its own
comment already anticipated the exposure: a recycled id "IS a new person whose votes could be
attributed to someone else by anything keying on mp_id alone, **which person_role currently
does**." The real exposure is not 26 rows; it is 309 of 1,831 pairs.

**Every number in the first draft that came from the bare join:**

| first draft | corrected | what it is |
|---|---|---|
| 843 MP roles covered | **563** | 280 refs were "covered" only via another person's seats |
| 149 blanks filled (724 → 575) | **0** (stays 724) | 100% artifact — see §1c |
| ~1,396 `party_primary` flips | **124** visible (562 gain a party, 438 identical) | |
| 158 multi-party careers | **132** | separate error — §2 |
| §5.1 gate floor `≥ 843` | **`≥ 563`** | the old floor *fails* a correct build and *passes* the broken one |

---

### 0g. `independent` renders as the literal string "independent"

`displayNameForId(id)` is `byId.get(id)` over `canonical_parties.json`
([`useCanonicalParties.tsx:140`](../../src/data/parties/useCanonicalParties.tsx)), and neither
`independent` nor `vmro` is in that file — verified, both absent from `parties[]` and from
`byNickName`. So:

- **The cell** renders `displayNameForId(p.partyPrimary) || p.partyPrimary`
  ([`PersonsBrowserScreen.tsx:515`](../../src/screens/persons/PersonsBrowserScreen.tsx)) →
  falls through to the raw value: a Latin-script **"independent"** in a Bulgarian UI.
- **The colour dot** is `colorFor(...)` → `byId.get()` then `resolveCanonicalId()`, both miss →
  no dot, so the row also loses the visual party cue every other row has.
- **The facet dropdown** builds `partyOptions` from `facets.party_primary` — the real data —
  with `label: displayNameForId(o.value) || o.value`
  ([`PersonsBrowserScreen.tsx:319-325`](../../src/screens/persons/PersonsBrowserScreen.tsx)),
  so `independent` and `vmro` already appear as options **labelled in Latin**.

This is **live today for 879 people** (`party_primary`: `independent` 484, `vmro` 395) and is
therefore a pre-existing defect, not one this plan creates. But §1b deliberately routes the
three class-A sentinels into `independent` at `role_prominence = 100` — the highest value in
the function — so it puts **21 more people** there, and puts them at the top of the ordering
where they cannot be outranked.

**Decision: fix the render before T2 ships, not after.** Two lines of work, in order of
preference:

1. Add `independent` (and `vmro`) to `canonical_parties.json` as real entries with
   `displayName: "Независим"` / `displayNameEn: "Independent"` and a neutral grey. That fixes
   all 879 existing rows, the dropdown, and the colour dot in one place, and makes §5.2's
   "documented exceptions" clause unnecessary.
2. Failing that, special-case the two ids in `displayNameForId`/`colorFor` — cheaper, but it
   puts a second party vocabulary in the client, which is the thing §0e exists to prevent.

Shipping T2 without this means 21 MPs — every defector, the most editorially interesting rows
in the dataset — display an English word where their party should be.

## 1. The crosswalk — group short name → canonical id

### 1a. It is mostly mechanical (measured)

Folding on `byNickName` from `canonical_parties.json` plus a whitespace/dash normalisation
(`replace(/[\s\-–—]+/g,'')`, uppercase) resolves **19 of the 26 distinct `party_dim.short`
values**:

```
АПС→p_10  БВ→p_39  БСП→bsp  БСП - ОЛ→bsp  ВЕЛИЧИЕ→p_13  ВОЛЯ→p_99  ВЪЗРАЖДАНЕ→p_7
ГЕРБ→gerb  ГЕРБ - СДС→gerb  ГЕРБ-СДС→gerb  ДБ→p_72  ДПС→p_16  ДПС - НН→p_29
ИТН→p_0  МЕЧ→p_3  ОП→p_104  ПП→p_67  ПП - ДБ→p_6  ПП-ДБ→p_6
```

The normalisation is load-bearing on its own: `ГЕРБ-СДС` and `ГЕРБ - СДС` are **separate
`party_dim` rows by design** (the key is `(ns, short)`), and any cross-NS series that joins on
`short` splits that party in two.

**DECIDED 2026-08-08 — the coalition fold stays exactly as `byNickName` has it.** The fold is
not internally consistent about coalitions, and that is approved rather than accidental:

| group short | → | and that id is |
|---|---|---|
| `ГЕРБ - СДС` | `gerb` | the **lead party**, coalition discarded |
| `БСП - ОЛ` | `bsp` | the **lead party**, coalition discarded |
| `ПП - ДБ` | `p_6` | the **coalition**, kept as itself |
| `ПБ` | `p_20` | the **coalition**, kept as itself |

The consequence to accept knowingly: `?party=gerb` returns ГЕРБ-СДС members. Do not "fix" this
asymmetry while implementing — it is the approved behaviour, it matches how the rest of the site
already reads these labels, and changing it would silently move every existing `?party=` deep
link.

**One thing the split (§0c-1) changes about how to read that.** Because `party_codes` is the
union over ALL roles, a member elected on the ПП-ДБ ballot who sits in the ПП group carries
**both** `p_6` (candidacy) and `p_67` (mp role) — so `?party=p_6` and `?party=p_67` both return
them, correctly. The multi-row design is what makes that work; a career-scalar row would have to
pick one and lose the other. The asymmetry above is only about the *representative* scalar
(`party_primary`), never about membership.

Note this is a different question from the one [`620df404bd`](../../) settled („a coalition is
not a party"). That commit was about *evidence* — treating a coalition as the holder of a ЗПП
filing obligation it does not have. This column is *membership*, where naming the group a member
actually sat in is the point, so the same phrase does not carry over. T2's hand-review judges
the entry-vs-ballot rule only; the coalition fold is settled and not up for review there.

### 1b. The 7 that miss split into two classes — and conflating them is a defect

**Class A — not a party. Must map to a sentinel, never to a party id.**

| value | meaning |
|---|---|
| `НЕЗ` | независим — left their group, sits unaffiliated |
| `НЕЧЛ В ПГ`, `НЕЧЛ ПГ` | нечленуващ в ПГ — seated but in no group |

These are the **absence** of affiliation. Mapping them to any party id would invent a
membership; mapping them to NULL would erase the defection, which is the most editorially
interesting fact in the whole dataset. **Decision: map all three to `independent`** — the id
`local_coalitions.ts` already mints for exactly this meaning, so `?party=independent` becomes
one coherent set across MPs and councillors instead of two half-sets.

**Class B — real parties needing a hand-authored alias (4 values).** All four now RESOLVED
against `canonical_parties.json`; this is the literal override map to ship:

| `party_dim.short` | canonical id | `displayName` | how it was found |
|---|---|---|---|
| `ПБ` | **`p_20`** | ПрБ | Прогресивна България — the 52nd NS's largest group (143 seats); `byNickName['ПрБ']` |
| `ИБГНИ` | **`p_49`** | Идваме | Изправи се.БГ! Ние Идваме!; `byNickName['Идваме']` |
| `ИСМВ` | **`p_81`** | ПП ИСМВ | `byNickName['ПП ИСМВ']` |
| `ДПС - ДПС` | **`p_16`** | ДПС | same party, doubled short; `byNickName['ДПС']` |

Do **not** reach them by loosening the normaliser — each is a genuine alias, and a looser fold
would start colliding real parties.

**Where the map lives is a decision, and the obvious answer is wrong.** A parliament-group
alias table **already exists** —
[`PARLIAMENT_GROUP_ALIASES` in `useCanonicalParties.tsx:20-25`](../../src/data/parties/useCanonicalParties.tsx):

```ts
const PARLIAMENT_GROUP_ALIASES: Record<string, string> = {
  ПБ: "ПрБ",
  "Демократична България": "ДБ",
  "Прогресивна България": "ПрБ",
  "Продължаваме Промяната": "ПП",
};
```

It already carries `ПБ`, one of the four, and `resolveCanonicalId` consults it. Authoring a
second map server-side would put the same knowledge in two places that can drift — and this
repo has a documented, named precedent for why that is a defect: `shlyo_query_fold()` is
**generated** from `src/lib/shlyoRules.ts` by `npm run gen:shlyo-sql`, with a test that fails
on drift, precisely so "the browser finds „6umen" and the server does not" cannot happen. The
same failure here is quieter: the client resolves a group to a party for the `/party/<nick>`
link while the resolver writes NULL into the ПАРТИЯ column, and both look like they work.

**Decision: one table, in `scripts/person/partyGroups.ts`, and `useCanonicalParties.tsx`
imports it** (it is plain data, no server deps). If that import proves awkward, generate one
from the other and gate it with a lockstep test — but do not hand-maintain two. The three
class-A sentinels stay server-side only: they are not display aliases and the client has no
use for them.

**The map must be exhaustive and must fail loudly.** An unmapped group short name silently
becomes NULL, which is indistinguishable from "this parliament predates the corpus" — so the
builder throws on any `party_dim.short` it cannot resolve. That is the gate in §5.1.

### 1c. The coverage ceiling is 563 of 2,122, and it fills ZERO blanks

Per-NS party exists only where roll-call sessions exist, **and only where the seat can be tied
to the right person** (§0f). Measured:

| source | MP roles covered |
|---|---|
| `mp_seat` seats confirmable via `nsFolders` | **563** |
| ~~bare `mp_seat` join~~ | ~~843~~ — 280 of those are other people's seats |
| `mp_party.json` (CIK name-match fallback) | not usable — see below |
| **no confirmable group in any source** | **1,559** |

MP roles span **NS 39–52** (`nsFolders`); the roll-call corpus starts at NS 44 (2020-10-28).
For NS 39–43 there is **no parliamentary-group data anywhere in this repo**: the per-MP profile
shards (`data/parliament/profiles/*.json`, 4,284 files) carry `oldnsList` but **no party field
at all**, and `scrape_mps.ts` only ever calls `/coll-list-ns/bg` — the **current** NS. The
obvious per-NS variant (`/coll-list-ns/bg/{44,47,51}`) returns the site's HTML shell, not JSON.
**Whether parliament.bg exposes historical group rosters at some other endpoint is genuinely
unknown and is the one open question worth a spike** (§3, T0).

`mp_party.json` closes more roles but **only by name-matching CIK candidacies** — i.e. it
recovers the *ballot* party, which is defect 0c-1, not the parliamentary group. It must not be
used to fill this column. It is the right fallback for a *display* label and the wrong one for
a fact column.

**So the honest outcome of this plan is:**

> Blanks on `/persons` stay at **724**. Not one is filled. 562 MPs gain a **time-correct
> parliamentary group** where they previously showed a ballot list, of which **124 visibly
> change**. The group-switch signal enters the corpus for the first time.

That is the win. "Fills the column" is not, and never was — the first draft's 149 filled blanks
were entirely an artifact of the bad join: **every** MP whose seat is honestly confirmable is a
recent member who already carries a ballot party from a candidacy. The two populations do not
overlap at all, which is why the corrected figure is exactly zero rather than merely smaller.

---

## 2. DECISION — one row per (person, parliament), not one per person

**Chosen: multi-row. The resolver emits one `person_role` row per (person, NS) seat, with
`ref = '<mpId>:<ns>'`, that NS's ENTRY group in `party`, and `start_date` / `end_date` set to
the parliament's term bounds.**

### Why

1. **It is what `candidate` already does.** `candidate.ref` is `'{election}:{slug}'` — verified,
   e.g. `2024_10_27:c-22-abdurahman-abdurahmanov-shamov` — one row per election, carrying
   several party values over a career. `councillor`/`local` is the same shape per mandate. A
   career-scalar MP row would be the **only** electoral role in the table that collapses a
   multi-mandate history into one value.
2. **It is the only shape where both 120 columns are correct simultaneously.** `party_codes` is
   defined as "ever affiliated" and wants every group; `party_primary` is "representative" and
   wants one. With one row per NS and `start_date` filled, `top_party`'s existing
   `ORDER BY prom DESC, start_date DESC NULLS LAST` yields **the most recent parliamentary
   group** with no change to migration 120 — and simultaneously **repairs the dead tiebreaker**
   of defect 0c-4 for every role, not just MPs.
3. **A scalar would be wrong for 15.7% of the people it covers.** Of the 842 MP-persons present
   in `mp_seat`, **132** hold more than one distinct group across their career.
   *(The first draft said 158 / 18.8%. That count was taken on the RAW `party_dim.short`, so it
   counted `ГЕРБ-СДС` → `ГЕРБ - СДС` as a party change for 26 people who never left ГЕРБ — the
   exact splitting artifact §1a warns about and §6.7 lists as a failure mode. Use 132.)*
4. **It is the shape that structurally removes the §0f exposure.** A row keyed `'<mpId>:<ns>'`
   and minted only for an in-`nsFolders` seat cannot carry another person's group, because the
   NS is part of the key and the guard is applied at mint time. The career-scalar shape has to
   re-apply the guard on every read.

### Rejected: a single scalar party on the existing `ref = '<mpId>'` row

Cheaper — a pure `UPDATE`, no ref migration, no consumer touched. Rejected because it forces a
choice between two wrong answers for the 132 multi-party careers (last-seen attributes a
defection backwards over a decade; first-seen hides it), and because `party_codes` would then
under-report affiliations the corpus actually knows. It is retained as the **T2 measurement
shape** and as the shape of the emergency patch in §4b.

**A note on the PK.** `person_role`'s PK is `(person_id, source, ref, role)` — verified — and
`party` is not in it. There are currently **zero** duplicate `(person_id, role, ref)` triples
(2,122 rows, 2,122 distinct refs, 2,120 persons). Two MP rows differing only in party are
therefore **impossible** without the ref widening. That is a constraint on the design, not a
detail: it is why "just add another row" is not available as a cheap option, and why T3 cannot
be skipped.

### 2b. The T3 blast radius — ref FORMAT and ROW COUNT, and it is all silent

§0d covers readers of the *value*. T3 changes the *key* and the *cardinality*, and this is the
part the first draft under-scoped ("~10 places, mechanical `split_part`"). **Every numeric-cast
site in the repo is guarded by `ref ~ '^[0-9]+$'`, so T3 breaks them all SILENTLY — not one
throws.** The single loud tripwire is a test.

| site | shape | effect under `'<mpId>:<ns>'` |
|---|---|---|
| [`105_mp_serving.sql:96-105`](../../scripts/db/schema/pg/105_mp_serving.sql) `mp_person_link` | guarded `r.ref::integer` | **view goes EMPTY.** It is "the ONE definition of which person holds this mp id" (`:70`) — dependents at `:141`, `:255`, `:333` (`personSlug`) all lose their person link |
| [`082_person_api.sql:370-372`](../../scripts/db/schema/pg/082_person_api.sql) `mpId` in search | guarded `r.ref::bigint` | returns NULL → **every MP avatar disappears from header search** |
| [`105_mp_serving.sql:466-472`](../../scripts/db/schema/pg/105_mp_serving.sql) | guarded join to `mp_profile` | silently no rows |
| [`104_mp_roster.sql:37,83`](../../scripts/db/schema/pg/104_mp_roster.sql) | `idx_mp_profile_ref ON ((mp_id::text))` + the comment asserting `ref = mp_id::text` | index no longer serves the join |
| [`load_graph_pg.ts:166-178,292`](../../scripts/db/load_graph_pg.ts) | `pr.source='mp'` joins | MP arm of the graph loses rows |
| `mp_serving.data.test.ts:96,109` | guarded, then `assert rows.length > 500` | **FAILS LOUDLY — the one real tripwire** |
| `mp_serving.data.test.ts:305,312` | excludes people with `count(*) mp roles ≠ 1` | under T3 that excludes **every multi-term MP**; `rows.length > 100` still passes, so the test's scope collapses silently |
| `mp_declarations_assets.data.test.ts:73,154`, `graph.data.test.ts:101`, `person_browse.data.test.ts:479,519,596,602`, `person_role_place.data.test.ts:252` | `ref = m.mp_id::text` or `source='mp'` | row-count changes |
| **120 `roles_n`** | `count(*)` over roles | **inflates for every multi-term MP** — a visible `/persons` column, not mentioned in the first draft |
| **[`120_person_browse.sql:250`](../../scripts/db/schema/pg/120_person_browse.sql)** `photo` CTE | `JOIN mp_profile m ON r.source='mp' AND m.mp_id::text = r.ref` | **no match → `photo_url` NULL for all 2,120 MPs.** Every MP photo disappears from `/persons` |
| **[`120_person_browse.sql:314-315`](../../scripts/db/schema/pg/120_person_browse.sql)** `bridge_a` | `pr.ref = replace(cp.ref, '/candidate/mp-', '')` | MP arm of the company bridge breaks → MP↔company links drop out of the browser |
| **[`functions/db_routes.js:394`](../../functions/db_routes.js)** `mpSlugFromQuery` | `r.source='mp' AND r.ref = $1` (bare id) | returns null → the candidate screens' **assets / declarations panels serve their empty body** |
| [`105_mp_serving.sql:298`](../../scripts/db/schema/pg/105_mp_serving.sql) | `r.ref = m.mp_id::text AND p.slug = p_slug` | bare equality, no match |

`097_cohort_benchmark.sql:71,80` and `accountability_gate.data.test.ts:48,75` key on
`source='mp'` only, never on the ref shape, so they are unaffected by the format change (but do
see more rows).

**Two corrections to §0d this forces, both worth stating loudly:**

- **"Migration 120 needs no edit" is true for T1/T2 and FALSE for T3.** 120 joins
  `mp_profile` on the bare ref for photos and `company_politicians` on it for the company
  bridge. Neither is a party column, so nothing about the ПАРТИЯ work points at them, and both
  fail silently: missing photos and missing company links, on the very page this plan is for.
- **T3 changes `functions/` code, so it needs `npm run deploy:db`.** §4a lists only `db:load:*`
  loaders. A T3 publish that runs the whole loader chain and skips `deploy:db` leaves the route
  keyed on the old ref format against a database that no longer has it.

### 2c. The writer cannot read `mp_seat` — an ordering constraint

In `db:refresh`, the steps are:

```
37  npm run db:resolve:persons        ← writes person_role
38  npm run db:load:declarations:pg -- --resolve
39  npm run db:load:person-elections:pg
40  npm run db:load:mp-roster:pg      ← builds mp_profile (+ ns_folders)
41  npm run db:load:rollcall:pg       ← builds mp_seat / vote_cast / party_dim
```

The resolver runs at **37**; every table this plan wants to read is built at **40–41**. On a
fresh database it would read nothing and write NULL for every MP (coverage 0, §5.1 fails the
build). On a warm database it would read the **previous vintage** — so the run after a new
parliament is ingested publishes the *prior* parliament's groups, and the next `db:refresh`
silently corrects it. Invisible to every row count.

**This repo has already solved this exact problem once**, and the fix is written into the
resolver: `seatedRegion` is read from `index.json` rather than from `mp_profile` precisely
because "db:refresh loads that table TWO STEPS AFTER this resolver runs"
([`resolve_persons.ts:650`](../../scripts/person/resolve_persons.ts)).

**Decision: the writer reads FILES, not Postgres.** Both inputs it needs are on disk and are
the very inputs `db:load:rollcall:pg` itself consumes:

- `data/parliament/index.json` → `nsFolders` per mp id (the §0f guard). Already opened by the
  resolver.
- `data/parliament/votes/sessions/*.json` → each file carries `ns`, `date`, and
  `mpParty` (`{"4162":"ПБ","5061":"ГЕРБ - СДС",…}`). The **entry group** for `(ns, mpId)` is
  that mp's `mpParty` in the earliest-dated session file of that NS.

Do not move `db:load:rollcall:pg` ahead of the resolver to avoid this. That reorders a 53-step
chain whose ordering is separately gated by `refresh_coverage.test.ts`'s `ORDER_PAIRS`, to buy
nothing the file read does not already give.

### 2d. T3 and the МИР place column — one seat, N parliaments

`person_role` for MPs is **100% populated** with `place_kind='mir'` (2,122 of 2,122), and
[`person_role_place.data.test.ts:244-262`](../../scripts/db/tests/person_role_place.data.test.ts)
asserts exactly that: `coded === total`, on the argument that "parliament.bg carries a seat on
every profile it holds".

But the МИР comes from `seatedMirByMpId`, built from `index.json`'s **`seatedRegion` — a single
object per mp id, with no per-NS variant** (the file's fields are `currentRegion`,
`seatedRegion`, `nsFolders`; only `nsFolders` is per-parliament). So under T3 every one of a
person's N seat rows gets the **same** МИР, including for a member who was seated from a
different МИР in a different parliament.

The gate still passes green — every row has a code, it is just the same code N times. Decide
explicitly and write it into the code:

- **replicate** the single МИР across all NS rows (keeps the 100% gate, knowingly wrong for
  movers, and `?oblast=` gains nothing from the extra rows); or
- **populate only the row matching `isCurrent`** and leave historical rows' place NULL (honest,
  but breaks the `coded === total` gate, which then needs re-scoping to one row per person).

Whichever is chosen, `person_role_place.data.test.ts` must be updated deliberately rather than
left to pass by accident — a gate that cannot distinguish "seated there" from "replicated
there" is not testing the thing its name claims.

T3's migration is therefore **not** "add `split_part` in ~10 places". It is: decide per site
whether it wants the *person's mp id* (`split_part(ref,':',1)`) or the *seat*, then fix the
`^[0-9]+$` guards, then re-assert cardinality everywhere that assumed one MP row per person.

### Deliberately out of scope

Splitting a *mid-term* switch into two dated spans within one NS. `vote_cast` can date it
precisely, but it would put two rows on one (person, NS) and re-open the ref question one level
down. v1 stores the **entry** group per NS (§5.3) and leaves the mid-term span model to v2. The
switch is still visible: an MP who left ГЕРБ for НЕЗ in the 47th and returned in the 48th gets
three rows with three parties.

---

## 3. Phases

Each phase is independently shippable and separately verifiable.

### T0 — spike: is there a historical group roster? (½ day, no code shipped)

Probe parliament.bg for a per-NS roster endpoint carrying `A_ns_CL_value_short`. **Decides
nothing else in the plan** — every later phase is written against the 563 that exist today.

**Its upside is now measurable, and it is capped harder than it looks.** `nsFolders` enumerates
NS 39–52 for **859** MPs (2,207 `(mpId, ns)` pairs), of which **685 have no `mp_seat` row** —
those 685 seats are exactly what a historical roster would light up, and the same crosswalk
consumes them unchanged. Best case:

| | today | T0 succeeds |
|---|---|---|
| MP roles with a group | 563 | **859** (the `nsFolders` ceiling) |
| confirmable seats | 1,522 | 2,207 |
| blank ПАРТИЯ on `/persons` | 724 | **633** |

So even a perfect historical roster fills only **91** of the 724 blanks: the other **633 blank
MPs have no `nsFolders` at all**, meaning `index.json` does not say which parliament they sat
in, so there is nothing to look a group up *by*. Reaching them is a different and larger problem
(recovering per-NS membership for pre-2017 MPs), not this spike. Size T0 accordingly — its real
prize is the 296 roles that gain a *correct* group, not the blanks.

**Verify:** a written answer in this file, with the endpoint or the evidence there isn't one.
Timebox hard; do not let it block T1.

### T1 — the crosswalk AND the seat resolver, standalone and testable (1–1.5 days)

Two pure modules, no DB, no writes.

**`scripts/person/partyGroups.ts`** — `groupShortToCanonical(short): string`:
`byNickName` → normalised `byNickName` → the §1b class-B override map → `independent` for the
three class-A sentinels → **throw** on anything else.

**`scripts/person/mpSeats.ts`** — `seatsForMp(mpId): {ns, entryGroupShort}[]`, reading
`index.json` `nsFolders` + the session tree per §2c, and **returning only seats whose NS is in
that mp's `nsFolders`**. This module is where §0f is fixed once, for every consumer.

**Verify:**
- all 26 live `party_dim.short` values resolve to a non-null id; the four class-B aliases
  (`ПБ`→`p_20`, `ИБГНИ`→`p_49`, `ИСМВ`→`p_81`, `ДПС - ДПС`→`p_16`) and three class-A sentinels
  asserted by name; an invented short name throws.
- `seatsForMp` returns **563** covered roles in total, **0** out-of-`nsFolders` seats, and
  specifically returns `[44]` — not `[44, 51]` — for mpId **3103**.
- Ships nothing to any database. The browser is untouched.

### T2 — populate, career-scalar, as a measurement (1 day)

Wire T1 into the resolver behind `m.source === 'mp'`, still writing **one row per person** with
the **most recent in-`nsFolders` NS's entry group**. Deliberately the *rejected* design —
shipped because it is a small change at
[`:1650`](../../scripts/person/resolve_persons.ts), needs no ref migration, and produces the
real before/after distribution against a live `person_browse_table` rather than an estimate.

**Verify:**
- `mp` roles with party = **563** (not ≥843);
- blanks stay at **724** — assert *no* MP gains a party from blank, which is the corrected
  §1c prediction and the cheapest possible check that the §0f guard is actually on;
- `party_primary` diff before/after: **124** people change, 438 unchanged. Hand-review a sample
  of 30 of the 124 — every one should be defensible as "their parliamentary group rather than
  their ballot list".
- **§0g is done first**: the 21 MPs landing on `independent` render „Независим" with a colour
  dot, not a Latin token. Gate 5.8 is green — which means `vmro`'s 395 existing rows are fixed
  too, since the same gate covers them.

The hand-review judges **only** the entry-vs-ballot rule. The coalition fold is settled (§1a,
decided 2026-08-08) — a reviewer who flags `?party=gerb` matching ГЕРБ-СДС members is
re-opening an approved decision, not finding a defect.

**Stop here and look at that diff before starting T3.** If the flip reads worse than the status
quo to a human, the vocabulary or the entry rule is wrong, and T3 would multiply the error by
2,366. 124 is a reviewable number; the first draft's ~1,396 was not, which is part of why this
gate was theatre before.

### T3 — the ref widening and per-NS rows (3–4 days)

`ref` becomes `'<mpId>:<ns>'`; one row per in-`nsFolders` seat; `start_date`/`end_date` from the
NS term bounds. Work through **every** site in §2b — the format change, the `^[0-9]+$` guards,
and the cardinality assumptions — not just a `split_part` sweep.

**The NS term bounds are NOT `min(vote_item.date)`.** Measured: NS 44's first roll-call in the
corpus is `2020-10-28`, but the 44th NS convened in **2017** — the corpus starts mid-term.
Deriving `start_date` from the votes would date every NS-44 seat three years late and make
`top_party`'s `start_date DESC` order careers wrongly. Bounds come from the election calendar
(`src/data/json/elections.json` + the NS mapping), not from the votes. Small task, sharp edge.

**Verify:**
- row count rises from 2,122 to 2,122 + (in-`nsFolders` seats − 1 per multi-NS MP);
- every widened ref's `split_part(ref,':',1)` matches the old value, and row counts on all
  affected data tests move only as predicted;
- every row of §2b's table has an assertion behind it (gate 5.6) — in particular
  `person_browse_table.photo_url` is still non-NULL for ≥ 2,000 MPs and `mpSlugFromQuery`
  still resolves, the two that §0d's "120 needs no edit" points away from;
- §2d's МИР decision is implemented and `person_role_place.data.test.ts` re-scoped to match it;
- `start_date` is non-NULL on every MP row and no NS's start precedes its election.

**T3 ships `functions/` code**, so its publish is `deploy:db` **then** the loader chain in §4a
— not §4a alone.

### T4 — publish (see §4)

---

## 4. Rebuild cost

### 4a. The full cloud chain

`person_role` is written only by `resolve_persons.ts`, so the canonical path is a resolve plus
every downstream that folds it:

```bash
npm run db:resolve:persons:cloud                       # ~5m22s
npm run db:load:declarations:pg:cloud                  # phase 1, ~1 min
npm run db:load:declarations:pg:cloud -- --resolve     # ~11m09s — EXCEEDS the 10-min
                                                       #   Bash ceiling; run detached
npm run db:load:official-candidate-links:pg:cloud      # ┐
npm run db:load:person-elections:pg:cloud              # │ ~22 min
npm run db:load:persons-browse:pg:cloud                # │ together
npm run db:load:person-search:pg:cloud                 # │
npm run db:load:graph:pg:cloud                         # ┘
npm run person:slugs:cloud                             # ~1 min
```

**Realistic wall clock: ~40 minutes**, of which ~11 must run detached.

**Correction to CLAUDE.md.** It calls `db:resolve:persons:cloud` "a multi-hour rebuild"; it was
**measured at 5m22s on 2026-08-05**. The advice that rests on that framing — ship a
function-body change via `apply_functions.ts` instead — still holds, because a resolve
re-derives the entire identity layer as a side effect, but not for the stated reason. Worth
fixing in CLAUDE.md while this work is in flight.

### 4b. The narrow path — viable for T2 only, and it does not persist

For the **career-scalar** shape (T2), the whole change is expressible as an `UPDATE` over
`person_role` plus a refresh:

```sql
UPDATE person_role SET party = :canonical WHERE source = 'mp' AND ref = :mpId;
```
then `db:load:persons-browse:pg:cloud` + `db:load:person-search:pg:cloud` (~10 min, no resolve).

**Safe on a live database** — an `UPDATE` of 2,122 rows takes RowExclusiveLock only, so readers
of `person_by_slug` / `person_connections` stay on their MVCC snapshot and are never blocked
(the hazard [[reference_stage_merge_reload]] warns about is `TRUNCATE`, not this).

**But it is a patch, not a publish.** The next `db:resolve:persons` DELETEs and rebuilds
`person_role` wholesale ([`:1704`](../../scripts/person/resolve_persons.ts)), silently reverting
it. Use it to get T2 in front of a human quickly; never as the shipping path. **T3 cannot use
it at all** — new refs are INSERTs, and the resolver is the only writer that can mint them
consistently.

---

## 5. Gates to add

All in `scripts/db/tests/*.data.test.ts`, auto-skipping when Postgres is down.

**5.0 — `mp_party.data.test.ts` (new). NO MP row carries another person's seat.**
The §0f gate, and the one that must be written FIRST because nothing else discriminates.
For every MP row, assert its `(mpId, ns)` is present in `mp_profile.ns_folders`, and — the
sharper form — that folding `person.display_name` and `mp_seat.name` agree on every joined
pair outside a named allowlist of the 3 known benign variants (homoglyph `Радослaвов`;
`Сачева`/`Сачева-Атанасова`; `Желязкова`/`Василева`). Assert **0** out-of-`nsFolders` pairs,
and assert mpId **3103** resolves to NS 44 only. Without this gate the bare join reappears
the first time someone writes a convenient `JOIN mp_seat ON mp_id::text = ref`.

**5.1 — coverage must not regress, and the floor is 563.**
Assert `count(*) FILTER (WHERE party IS NOT NULL)` on `role='mp'` is **≥ 563** — a floor, not an
equality, so a T0 win or a new parliament raises it without editing the test. Separately assert
**every distinct `party_dim.short` resolves** through the T1 crosswalk, so a new group short
name in a future NS fails the build instead of silently writing NULL. This is the gate that
makes §1b's "fail loudly" real.
*Do not write `≥ 843`.* That floor fails a correct implementation and passes the broken join —
it would have actively enforced the §0f defect.

**5.2 — vocabulary consistency across roles.** Assert `person_role.party` contains **no
Cyrillic** (`party ~ '[А-Яа-я]'` → 0 rows; verified true today across all 143 distinct values)
and that every MP party value is either in `canonical_parties.json`'s id set or in the two
documented exceptions (`independent` 517 rows, `vmro` 424). This is the one gate that directly
enforces [`:1647`](../../scripts/person/resolve_persons.ts)'s "would make them look comparable"
concern, and it is why that comment can be safely removed rather than merely overridden.

**5.3 — entry group, not last-seen (the anti-misattribution gate).** For every MP row, assert
the stored party equals the group the member held at their **first** cast in that NS
(`vote_cast` ordered by `vote_item.date`, `superseded_by IS NULL`), **not** `mp_seat.party_id`.
`mp_seat.party_id` is documented last-seen ([`134_rollcall.sql:54-59`](../../scripts/db/schema/pg/134_rollcall.sql))
and its own comment says any party derivation "MUST use vote_cast.party_id". It is the trap: it
would file a defector under the group they **left**, which is defamatory in exactly the way
[[feedback_name_match_not_identity]] is about. The two bases genuinely differ — NS 52 on the
entry basis is ДБ 33 / ПП 18, on the last-seen basis ДБ 28 / ПП 23, i.e. 5 members moved. Assert
explicitly that at least one of the 179 switchers is stored under their entry group and not
their exit group — a gate that cannot pass by accident.

**5.4 — the party-office merge licence must not widen.**
[`person_resolve.data.test.ts:79-82`](../../scripts/db/tests/person_resolve.data.test.ts) joins
`other.party = office.party` to re-check the `party_leader` merge licence against the data.
Populating MP party **adds rows to the left side of that join**, so two same-named people could
newly acquire a merge licence they did not have. The exposed set is now measured: **108
`party_leader` roles** exist (all `official_exec`), of which **61 people also hold an `mp`
role** — a party leader who is also an MP is the normal case, not the edge case. Assert the
licensed-merge count is unchanged across the change, or the identity layer can quietly merge two
different people. **This is the single most dangerous interaction in the plan** and the least
obvious: it is not a display bug, it is an identity bug, and nothing about the ПАРТИЯ column
points at it.

**5.5 — extend `person_browse.data.test.ts`.** It already asserts `party_primary ∈ party_codes`
(`:232-240`) and the padded-set invariant (`:273`). Add: `parties_n` for an MP equals the
distinct NS-group count **computed through the T1 seat resolver** (not a bare `mp_seat` join —
otherwise the gate re-derives the §0f defect and passes); `roles_n` accounts for the new per-NS
rows (§2b); and the determinism check at `:754-770` still holds with `start_date` populated —
that check passes today only because an arbitrary choice is *stable*, so it must be re-proved
once the ordering key actually changes.

**5.6 — T3 only: the ref format did not silently empty anything.**
Walk §2b's table and assert one thing per row. At minimum: `mp_person_link` is non-empty and its
row count matches distinct MP persons; `082`'s `mpId` is non-NULL for a sampled MP;
**`person_browse_table.photo_url` is non-NULL for ≥ 2,000 MPs** (120:250); the `bridge_a` MP arm
still yields its current company count (120:314); and `mpSlugFromQuery` resolves a known mp id
(`functions/db_routes.js:394` — a `node --test` case in the `functions/` gate, since the Vitest
suites do not cover that file). Also re-assert that `mp_serving.data.test.ts:312`'s
`count(*) = 1` exclusion has been rewritten — under T3 it silently narrows to single-term MPs
while still passing.

**5.7 — the group→party map has exactly one copy.**
Assert `PARLIAMENT_GROUP_ALIASES` and the server-side override map are the same table (§1b) —
either by importing one into the other, or, if they are generated, by a drift test in the shape
of [`gen_sql/shlyo_query_fold.test.ts`](../../scripts/db/tests). Without this the client can
resolve a group the resolver writes NULL for, and both look correct in isolation.

**5.8 — every value the ПАРТИЯ column can hold has a Bulgarian label.**
For every distinct `party_primary` in `person_browse_table`, assert `displayNameForId` resolves
it — i.e. it is in `canonical_parties.json`'s `byId`. This is the §0g gate. It **fails today**
on `independent` (484) and `vmro` (395), which is the point: it should fail until they are given
real entries, and it stops the class-A sentinels from quietly adding a 3rd Latin token later.

---

## 6. What can go wrong silently

Ordered by how long it would survive unnoticed. Every one of these is green on row counts.

1. **The bare `mp_id` join comes back (§0f).** 309 of 1,831 pairs attribute another person's
   parliamentary group. It is the *convenient* join, it looks correct, `mp_seat` is right there
   in Postgres, and the only thing standing against it is gate 5.0. It already got through one
   full plan review. **This is #1 for a reason.**
2. **The `party_primary` change (0c-3) goes unreviewed.** 124 people change displayed party from
   ballot list to parliamentary group in one deploy. Both values are "correct"; only one answers
   the question the column asks. No test can adjudicate this — **T2's hand-reviewed diff is the
   control**, which is why T2 exists as its own phase despite shipping a design this plan
   rejects.
3. **The writer reads `mp_seat` from Postgres (§2c).** Fresh DB → all NULL; warm DB → the
   previous parliament's groups, silently corrected on the next refresh. Read the files.
4. **`mp_seat.party_id` used instead of the entry group.** The convenient join is the wrong one
   and there is no type difference between them. Files 179 defectors under the group they left.
   Gate 5.3.
5. **The merge licence widens (5.4).** Wrong *people*, not wrong parties. 61 exposed. Survives
   indefinitely.
6. **T3 empties something that is not a party column (§2b).** Every numeric-cast site is guarded
   by `^[0-9]+$`, so nothing throws. The ones that bite hardest are the ones §0d's "migration 120
   needs no edit" actively points away from: **all 2,120 MP photos** (120:250) and the MP company
   bridge (120:314), plus `mp_person_link`, `082`'s `mpId`, and `mpSlugFromQuery` in
   `functions/`. Gate 5.6 — and remember T3 needs `deploy:db`, not just loaders.
7. **`independent` ships as an English word (§0g).** 21 defectors — the rows this plan exists to
   surface — render a Latin token with no colour dot, in a Bulgarian UI, at the top of the
   prominence order. Visible to anyone who looks, invisible to every test until gate 5.8 exists.
8. **The group→party map gets a second copy (§1b).** `PARLIAMENT_GROUP_ALIASES` already has `ПБ`.
   A divergent server map means the client links to `/party/ПрБ` while the column reads „—".
   Gate 5.7.
9. **T3 replicates one МИР across N parliaments (§2d).** The 100%-fill gate passes on N copies of
   the same code, so a member who changed МИР is silently filed under one of them.
10. **`НЕЗ` mapped to a party id, or to NULL.** To an id: invents a membership. To NULL:
    indistinguishable from "NS 39–43, no data", so the defection signal — arguably the most
    valuable thing this plan adds — vanishes into the 1,559 known-blank roles.
11. **Group shorts written raw (vocabulary 2).** Visible immediately in the facet dropdown as
    `gerb` and `ГЕРБ - СДС` side by side, but only to someone who opens it. Gate 5.2.
12. **`start_date` derived from `vote_item`.** Dates every NS-44 seat three years late; the only
    symptom is `top_party` picking the wrong parliament for multi-term MPs. §T3.
13. **`ГЕРБ-СДС` and `ГЕРБ - СДС` treated as two parties.** Halves both counts; each half looks
    plausible. This one already bit the first draft — it is what turned 132 multi-party careers
    into 158.
14. **A future NS introduces an unmapped group short.** Silent NULL for a whole parliament, in
    the one year nobody re-reads this file. Gate 5.1 is specifically shaped to catch this.

---

## 7. Decisions — all resolved, nothing blocking

Every editorial question this plan raised has an answer. **No decision is outstanding; T1 can
start.** Recorded here so the implementer does not re-open them, and so a future reader knows
they were chosen rather than defaulted into.

**D1 — the ПАРТИЯ column means the PARLIAMENTARY GROUP.** *(approved 2026-08-08.)*

> When an MP was elected on the ГЕРБ list and sat in the ГЕРБ-СДС group, `/persons` can show
> **one** party. Today it shows the ballot list (`gerb`, via the candidacy). After this change
> it shows the group.

Approved as the plan assumed. It is what `role_prominence` already encodes (`mp` = 100), and it
is what the person actually did rather than what a party list said. It changes **124** rows.

The operator's reason is stronger than the plan's original one and is now §0c-1: a coalition can
**split into several groups after entering parliament** — ПП-ДБ sat as one group in the 49th and
50th and as two (`ДБ` 33, `ПП` 18) in the 52nd. For those members the ballot label is *incapable*
of naming the group, since it is the same label for both, and three of them currently display
the sibling group's party outright. That is not a preference between two defensible readings; it
is one reading that can be wrong and one that cannot.

Consequence accepted: the ballot party is not lost. It stays in `party_codes` via the candidacy
row, so `?party=` still matches it — only the representative scalar changes.

**D2 — the coalition fold stays as `byNickName` has it.** *(approved 2026-08-08; full table and
rationale in §1a.)* `ГЕРБ - СДС`→`gerb` and `БСП - ОЛ`→`bsp` fold to the lead party while
`ПП - ДБ`→`p_6` and `ПБ`→`p_20` stay as the coalition. The asymmetry is deliberate. Do not
"fix" it during implementation.

**D3 — unfillable MPs render „—".** *(approved 2026-08-08.)* No „няма данни" variant, no second
empty state. The 724 blanks stay visually identical to a genuine absence of party.

Worth stating what is being accepted, since it does not go away: §1c fills **none** of the 724,
and **633 are permanent** even if T0 succeeds (§3, T0). After this change `independent` becomes a
real value in the column, so „—" and „независим" are two different things on the same page that a
reader cannot tell apart by their absence. That is the approved trade — a simpler column over a
more explicit one — and it is the reason gate 5.8 (§0g) matters more, not less: if „—" carries no
information, the values that DO appear must at least be legible.
