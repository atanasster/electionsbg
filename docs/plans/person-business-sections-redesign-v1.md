# Person page: business + connections sections redesign

**Status:** design/plan only — no code changed. Written from a live codebase audit
(2026-08-25); every path, line and constant below was read from the current tree, not
recalled.

## 0. The thing to know before reading anything else

**The page in the screenshots is the LEGACY screen, `src/screens/dev/PersonScreen.tsx` — not
the `PersonProfileScreen` the election/voting redesign (`person-election-voting-redesign-v1`)
just went through.** The URL `/person/Явор%20Чавдаров%20Стефанов` carries a bare three-part
NAME, not a person slug. `routes.tsx:4616-4623` mounts what looks like `PersonScreen` but is
actually a lazy alias for `PersonProfileScreen` (`routes.tsx:156-160`), and that component
dispatches:

```
PersonProfileScreen.tsx:776-798
  state.status === "missing"  →  <PersonScreen />     // @/screens/dev/PersonScreen
```

`/api/db/person-profile` tries `person_by_slug` then `person_by_name`, and `person_by_name`
returns null for a 0-match or >1-match name fold — so an unresolved name falls through here.
The page is `useNoindex()`-marked (`PersonScreen.tsx:166`) precisely because it is a **name
match, not an identity**.

Three consequences that shape the whole plan:

1. This page and the modern dashboard are **different code with no shared layout**. Nothing
   from the previous redesign carries over automatically.
2. Several of its tiles are **shared with other screens** — redesigning them lands on
   `/company/:eik` too, and one lands on the *modern* person page. Blast radius is real and
   is enumerated in §5.
3. Every framing decision here is constrained by the name-match caveat. This is the page
   where a wrong-looking claim is most likely to be about the wrong human.

## 1. What is wrong today

**Structure.** Fourteen blocks render as flat siblings inside one `<div className="space-y-6">`
(`PersonScreen.tsx:475`), organised only by two bare `<h2>`s. The file **never imports
`DashboardSection`** — so unlike every modern screen there are no section ids, no anchors, no
uppercase kickers, and no way to link to a part of the page. Two `xl:grid-cols-2` grids pair
four of the blocks; the rest are full-width singletons in source order.

**Duplication the reader has to reconcile.** „Участия" (`:613-653`) and „Хронология на
участията" (`PersonTimelineTile.tsx`) render **the same `person_roles` rows** — one as two
tables, one as a gantt — a hundred lines apart, with nothing saying they are the same ten
facts.

**Inconsistent caps.** „Топ възложители" caps at 10 and passes `seeAllHref={null}`
(`CompanyTopAwardersTile.tsx:13`) — the SQL returns 50, so 40 are unreachable with no link.
„Кръг от партньори" is `LIMIT 20` in SQL with no see-all either. „Участия" is **uncapped** and
renders every role. Three different answers to one question.

**And the finding that matters most — see §3 — is that two adjacent blocks can contradict
each other about the same named person.**

## 2. The proposed structure: 14 flat blocks → 4 labelled sections

Wrap the page in `DashboardSection` (`src/screens/dashboard/DashboardSection.tsx`), the shell
every modern screen uses, giving each group an id, an anchor and a kicker. A mockup of the
result was shown inline in this conversation.

| Section | `id` | Contents |
| --- | --- | --- |
| **Фирми** | `person-portfolio` | Участия (one table, ownership + management merged and tagged) + Хронология, stated as the same ten facts |
| **Обществени поръчки** | `person-procurement` | The 4 headline stat cards + Топ договори |
| **Профил на възлагането** | `person-procurement-profile` | Топ възложители, По фирма, По населено място, CPV/Как печели, По години, По правителства |
| **Връзки** | `person-connections` | Кръг от партньори, Политически връзки, Проверка на връзка |

Two consolidations inside that:

- **Участия becomes one list, not two tables.** Ownership and management are the same
  relationship to the same company; splitting them into „Собственост (8)" and „Управление (2)"
  forces a reader to scan twice to answer "what is this person to ИНВЕНТИКС". One list, each
  row tagged `съдружник 16%` / `управител`, former roles dimmed with their end date, sorted
  newest-first, capped with a see-all — which also fixes the uncapped-list inconsistency.
- **Хронология keeps its own card but states its relationship** ("същите 10 участия,
  подредени във времето") and its own omission: roles with no `added_at` are silently dropped
  today (`PersonTimelineTile.tsx` drops them), so a person can have 10 участия and 6 bars with
  nothing explaining the gap.

## 3. ⚠️ The connections merge — what the audit found, and why it is not a cosmetic change

The request was to put „Политически връзки" and „Проверка на връзка" in one section because
they are related. They should share a section, **but they are not the same kind of evidence,
and the audit turned up a specific way the merge can make the page contradict itself.**

The three blocks read three different things:

| Block | Source | Population |
| --- | --- | --- |
| Кръг от партньори | `person_associates` → `tr_officers` self-join | Co-officers in the registry |
| Проверка на връзка | `connection_between(a,b)` → **the same `tr_officers` self-join** | Co-officers in the registry |
| Политически връзки | `person_politicians` → curated `company_politicians` | Registry roles **∪ declared stakes**, and **only companies with procurement** |

**The true sibling of Проверка is Кръг от партньори, not Политически връзки** — they are
literally the same edge, one as a ranked top-N and one as a single-name lookup. That is the
non-obvious finding, and it inverts the intuition the request was built on.

**The contradiction it creates.** Because `company_politicians` includes *declared* stakes and
`tr_officers` does not:

- a politician listed in Политически връзки via a declared stake, typed into the Проверка box
  directly beneath it, returns **„Няма общи фирми"** — the page denying, in one card, what it
  asserted in the card above;
- conversely Проверка finds companies with no procurement at all, which Политически връзки
  excludes by construction.

Today these two sit ~40 lines apart with a timeline between them and the collision is
unlikely to be noticed. **Putting them in one section makes it adjacent and obvious**, so the
merge is only safe if it ships with the disambiguation. Three requirements, all visible in the
mockup:

1. **Each block states its basis in one line, in the card.** Not a tooltip — this repo's own
   convention (`attendanceBasis` / `dissentBasis` in the council work) is that a claim of this
   kind travels with its basis or not at all.
2. **Order by basis, not by topic**: партньори → проверка (same edge, adjacent) → политически
   връзки (different edge, explicitly labelled as such).
3. **A negative result from Проверка must not read as "no connection".** When the check
   returns nothing it must say what it searched — registry co-officership — and point at the
   political block rather than implying absence. This is the one change that is a correctness
   fix rather than a layout improvement.

A fourth difference worth stating in the партньори basis line: `person_associates` drops
mega-hubs (`company_count <= 300`) and entity-looking names, while `connection_between`
applies neither filter — so the check can legitimately find a link the list above does not
show.

## 4. Tier plan

Each tier is independently shippable, reviewable and testable.

**Tier 1 — the section shell.** Wrap the page in `DashboardSection`s per §2, delete the two
bare `<h2>`s, keep every block's current internals. Pure structure: no data, no tile changes.
Smallest diff, biggest legibility win, and it gives the later tiers anchors to link to.

**Tier 2 — Фирми.** Merge Собственост/Управление into one tagged, sorted, capped list with a
see-all; tie Хронология to it in copy; surface the dropped-undated-roles omission.

**Tier 3 — Връзки.** The §3 work: one section, three blocks, per-block basis lines, ordering
by basis, and the negative-result guard on Проверка. Ships the correctness fix.

**Tier 4 — procurement tiles.** Consistent top-N + see-all across the five shared tiles,
including the missing see-all on Топ възложители; row spacing/typography brought to the same
scale Tier 1 of the previous plan established. ⚠️ Read §5 first — this tier is the one with
blast radius.

**Tier 5 (optional, decide at the time) — headline stat cards.** The current four are Общо
възложени / Договори / Възложители / Фирми в портфейла. „Възложители 20" beside „Договори 20"
is a coincidence of this dataset, not a designed pairing, and „Фирми в портфейла 9" answers a
Фирми-section question from inside the procurement section. The mockup proposes replacing the
latter two with **„Печели пряко 95,6%"** (currently buried in a sub-line of the CPV tile,
and the single most interesting number on the page) and **„Фирми с поръчки 1 от 9"** (which
says how concentrated the portfolio's procurement actually is). Worth doing, but it is a
content judgement rather than a structural fix — hence separable.

## 5. ⚠️ Blast radius — the tiles are shared

Five of the procurement tiles are **also rendered by `/company/:eik`**
(`src/screens/dev/CompanyDbScreen.tsx`), and one is also rendered by the **modern** person
page:

| Tile | Also used by |
| --- | --- |
| `CompanyTopContractsTile` | `CompanyDbScreen:1312, :1656` |
| `CompanyTopAwardersTile` | `CompanyDbScreen:1663` |
| `ProcurementBreakdownTile` | `CompanyDbScreen:1326` |
| `CabinetTimelineTile` | `CompanyDbScreen:1703` |
| `CompanyByYearChart` | `CompanyDbScreen:1366, :1695` |
| `PersonProcurementBreakdownTile` | **`src/screens/person/PersonProcurementSection.tsx:59,64`** — the modern screen |

A tile edit therefore lands on up to three screens. That is mostly a *benefit* — the same
improvement everywhere — but it means Tier 4 must be verified on `/company/:eik` and on a
resolved `/person/:slug`, not only on the page in the screenshots. `PersonAssociatesTile` and
`PersonTimelineTile`, by contrast, have exactly one render site each.

## 6. What this plan deliberately does NOT do

- **It does not converge the legacy and modern screens.** The modern page has its own
  connections surface (`src/screens/person/PersonConnections.tsx`, `DashboardSection`-based,
  `/api/db/person-connections`) which never renders on this URL. Making one serve both is a
  much larger identity-layer question and is out of scope here.
- **It does not change any SQL or add a route.** Every number stays exactly the number it is
  today; this is presentation, grouping and framing only. The one behavioural change is the
  negative-result copy on Проверка (§3), which changes what is *said* about an existing
  result, not the result.
- **It does not touch the page-level namesake disclosure** (`person_namesake_disclosure`,
  `PersonScreen.tsx:460-463`) or the `useNoindex()` call. Both are load-bearing for a page
  that identifies people by name.

## 7. Suggested order

1 (shell) → 3 (Връзки, because it carries the correctness fix) → 2 (Фирми) → 4 (tiles, with
the cross-screen verification) → 5 (stat cards, if wanted).

Tiers 2, 3 and 4 are independent of one another; only Tier 1 should come first, since it
creates the sections the rest slot into.
