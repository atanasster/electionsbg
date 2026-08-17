# РНФЛ (личен фалит): watch it now, aggregate it later, never name-match it — v1

**Status:** T1 (watch source) SHIPPED 2026-08-17 — `scripts/watch/sources/rnfl_insolvency.ts`,
registered in `scripts/watch/sources/index.ts`, tests in `rnfl_insolvency.test.ts`. T2 and T3
remain gated and unimplemented; nothing is ingested and no table exists.
**Date:** 2026-08-03 — the day the register went live, which is why §2's answer to
"can we ingest it" is "there is nothing in it yet".

**Trigger:** ЗНФЛ (Закон за несъстоятелност на физическите лица) took effect 2026-08-03 and
the Minister of Justice's order activated the **Регистър на физическите лица в
несъстоятелност (РНФЛ)**, run by Агенция по вписванията.

**Owner surface if built:** a new aggregate indicator (filings over time, by court/oblast).
**Not** `/person`, and §4 explains why that is a design decision rather than a phasing one.

---

## 1. What the register actually is — verified 2026-08-03

Everything in this section was probed directly, not read off a press release. A future
reader should not have to re-derive it.

| Fact | Value |
|---|---|
| Portal | `https://portal.registryagency.bg/home-rnfl` (React SPA under `/RNFL/`) |
| Backend | ASP.NET Core JSON API under `/RNFL/api/`, returns `application/problem+json` on 404 |
| Auth | **None** for the report + nomenclature endpoints below |
| Cloudflare | **Not walled.** Plain `curl` from our egress gets a 200 |
| Records today | **Zero** |

**Reachability is the pleasant surprise.** The Търговски регистър side of the same portal
needs headed Playwright (see `docs/plans/cr-deeds-capture-v1.md`); РНФЛ answers a bare
`curl` with a stock User-Agent. Do not assume this survives the register getting popular.

### The public endpoints

```
GET /RNFL/api/Reports/{fileNumber}/Deed                                → 204 today
GET /RNFL/api/Reports/ObjectType/{objectType}/Ident/{ident}/History    → 500 on a bogus ident
GET /RNFL/api/Reports/ObjectType/{objectType}/Ident/{ident}/Documents
GET /RNFL/api/Reports/{actId}/Appeals
GET /RNFL/api/Nomenclatures/courts        → [{"code":"211","label":"Районен съд – Айтос"},…]
GET /RNFL/api/Nomenclatures/actTypes      → [{"code":"107","label":"Решение за обявяване в
                                              несъстоятелност и прекратяване на произво…"},…]
GET /RNFL/api/Nomenclatures/ekatte/{areas|districts|municipalities|settlements}
GET /RNFL/api/Nomenclatures/{processTypes|legalBaseTypes|appealTypes|documentTypes}
```

`/Reports/1/Deed` and `/Reports/20260803000001/Deed` both return **204 No Content** — the
register is empty, and it accepts arbitrary file-number shapes without validating them.

### The structural fact that governs this whole plan

**There is no list, search or export endpoint.** The full route table was extracted from the
bundle (`/RNFL/static/js/main.5ee89b5a.chunk.js`); every read route is a *lookup* keyed by
`fileNumber`, by an act id, or by a personal identifier. There is no "give me all files",
no paging, no open-data dump on data.egov.bg.

So the register is designed to answer *"is **this** named person bankrupt?"* — the question
a creditor asks — and not *"who is bankrupt?"*, which is the only question we'd want.

### The aggregate that does not exist yet

The portal's other three registers each have a statistics page — `/statistic-cr`,
`/statistic-croz`, `/statistic-pr`, all 200. **`/statistic-rnfl` is a 404.** When the agency
turns it on, that page is both the honest aggregate source for §T2 and the cleanest possible
trigger for it. (Do not assume it will come with a JSON API: `/CR/api/Statistics` returns the
SPA shell, i.e. the CR statistics page is server-rendered, not API-backed.)

### Unverified

- **Threshold to file** — the faktor.bg piece says debt over 10 minimum monthly salaries
  (~€6,202) overdue 12+ months. Not checked against the ЗНФЛ text. Verify before publishing
  any number derived from it.
- **Is `fileNumber` sequential?** Unknown, and §T1 depends on not assuming it is.
- **What `objectType` values mean**, and whether `ident` is ЕГН. We will not find out by
  submitting one — see §4.

---

## 2. Can we ingest it? Not yet, and then only in one shape

Two independent blockers, and they fail at different times:

1. **Nothing to ingest.** Filing needs a qualifying debt overdue 12 months, then a court
   proceeding. First entries are weeks out; a corpus worth aggregating is months out.
2. **No enumeration.** Even when full, §1 says there is no route that lists files. The only
   mechanical way to build a corpus would be to probe `{fileNumber}` over a guessed integer
   range until 204s turn into records — brute-force enumeration of a register of private
   individuals' bankruptcies. We are not doing that. It is hostile to the upstream, it
   depends on an unverified assumption about the id space, and it manufactures a dataset the
   legislator deliberately did not publish in bulk.

That leaves the shape §T2 builds: **the official aggregate**, whenever the agency publishes
one.

---

## 3. Why the aggregate is the interesting half anyway

"How many Bulgarians entered personal insolvency this quarter, in which courts" is a real
macro indicator with no identity join, no privacy exposure, and no false-positive risk. It
sits naturally next to the existing indicator surfaces. The per-person half adds risk and
subtracts nothing from that story.

---

## 4. Why we will not name-match РНФЛ to `person` — a rule, not a phase

Every dataset currently folded into the person layer joins on a **hard key**: EIK for TR
officers, the officials slug for declarations, `mpId` for MPs. РНФЛ would offer none. The
only available join is a **name**, against a fold that deliberately collapses hyphens,
whitespace and transliteration variants (`reference_person_fold_and_bridgeb`) across ~56.8k
people, in a country with heavily repeated names.

A false positive here labels the wrong named person bankrupt. That is the same class of
error the repo already refuses to risk for the three curated registers — `sanctions.json`,
`ds.json`, `regulators.json` are hand-verified precisely because name-matching is not good
enough, and `update-persons` carries an explicit defamation rule for them. РНФЛ is squarely
inside that rule.

Two hard constraints follow, and they bind every later phase:

- **Never submit a personal identifier to `/Ident/{ident}/`.** We do not hold ЕГН, must not
  acquire it, and a lookup-by-ЕГН crawl is exactly the compilation of personal data the
  instruction-boundary and privacy rules forbid.
- **No automatic attachment, ever.** If a public figure's insolvency is ever published on
  this site it arrives the way a sanctions designation does: one hand-verified curated row,
  `resolved:false` unless the identity is unambiguous.

---

## 5. Phases

### T1 — watch source (implementable today)

The only step that can be built now. Tells us when the register stops being empty and when
the agency publishes statistics — i.e. when T2 becomes possible.

**Deliverables**

1. `scripts/watch/sources/rnfl_insolvency.ts`
   - `id: "rnfl_insolvency"`, label `"Регистър на физическите лица в несъстоятелност (РНФЛ)"`,
     `url: "https://portal.registryagency.bg/home-rnfl"`.
   - `cadence: "weekly"`, `publishes: "irregular"`. `irregular` is honest here rather than a
     way to dodge `cadenceViolation` — this is literally `types.ts`'s own example, "a
     register that changes when someone files something". Weekly, not daily: nothing is
     expected for weeks and the probe is a courtesy request to a brand-new public service.
   - Fingerprint composed of three independent probes, so one going quiet does not mask the
     others:
     | probe | today | meaning when it moves |
     |---|---|---|
     | `GET /statistic-rnfl` status | `404` | **the T2 trigger** — an official aggregate exists |
     | `GET /RNFL/api/Reports/1/Deed` status | `204` | possibly the first filings (see caveat) |
     | hash of `courts` + `actTypes` nomenclatures | stable | the register's schema moved |
   - **The `Deed` probe is advisory and must be labelled as such in `detail`.** If
     `fileNumber` is not sequential it will read `204` for ever while the register fills.
     It may never flip; it must never be the thing we rely on. `/statistic-rnfl` is the
     primary signal because the agency, not our guess, controls it.
   - Probe **only file number 1**. Not a range — a range is the enumeration §2 rejects.
   - On a failed probe, **throw** — do not degrade to a `comdos_ds`-style sentinel. The
     runner reports the source as `error` and leaves its previous state intact
     (`scripts/watch/index.ts`), so an outage costs a week of detection latency and
     produces no false "changed" line. A sentinel is right for `comdos_ds` only because
     that upstream is unreachable from our egress *always*, making `"manual"` a stable
     value; this portal answers a plain `curl`, so a sentinel would flip the fingerprint
     on the way into an outage and again on the way back out.

2. Register it in `scripts/watch/sources/index.ts`, next to the person-layer curated
   sources (`ofacSanctions` / `comdosDs` / `regulatorRosters`) — same "operator reviews,
   nothing auto-ingests" character.

3. `scripts/watch/sources/rnfl_insolvency.test.ts` — stubbed `fetch`, per
   `docs/testing-standards.md` (unit tests never touch the network). Cover: the all-quiet
   baseline; `/statistic-rnfl` flipping to 200; a `Deed` flipping to 200; nomenclature
   drift; and that a failed probe THROWS (no sentinel — see deliverable 1), so the runner
   keeps the previous state and emits no false "changed".

4. A mapping row in `.claude/skills/process-watch-report/SKILL.md`. **It maps to no skill.**
   Like `comdos_ds`, a flip means *an operator reads this plan's §T2 and decides*, because
   there is no ingest to run. Say that explicitly in the row so a future orchestrator does
   not go looking for an `update-*` skill that was never written.

**Not in T1:** any Postgres table, any serving surface, any `recent_updates` row. There is
no data.

### T2 — the aggregate (gated)

**Trigger:** `/statistic-rnfl` returns 200, *or* the agency publishes a bulk export (watch
data.egov.bg — the Registry Agency already publishes the Commerce Register there, so an
РНФЛ dataset appearing under the same org is plausible and would be the better source).

**Shape:** filings and outcome acts over time, split by court (the `courts` nomenclature is
already a clean dimension, and its `Районен съд – X` labels map to place) and by act type.
Postgres table + a small indicator surface. No person join. No name column served.

**Open before building:** whether the published aggregate is granular enough to be worth a
table at all, or whether it is three national totals better handled as a curated indicator
row. Decide against the actual page, not now.

### T3 — curated public-figure intersection (gated, curated only)

**Trigger:** T2 shipped, *and* a specific public figure's insolvency is independently
reported. This phase is reactive by construction — it is never a crawl.

**Shape:** exactly the `sanctions.json` pattern. A hand-written register entry, attached
only via a stable `mpId` or a name confirmed globally unique, verified against the register's
own per-file record, `resolved:false` otherwise. Restricted to people who already file a
Сметна палата declaration, where an insolvency is materially relevant to a published office.

**If this phase ever feels mechanical, it is being done wrong.**

---

## 6. Explicitly out of scope

- Bulk enumeration of `{fileNumber}` (§2).
- Any request to `/Ident/{ident}/` (§4).
- Any per-person surface on `/person`, `/persons` facets, or the connections graph.
- Publishing the name of a private individual who holds no public office. This is the
  boundary the whole plan is organised around.
