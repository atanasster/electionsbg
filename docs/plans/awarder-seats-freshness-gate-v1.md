# A gate for "the override map was rebuilt and never published" — v1

**Status:** SPEC, not implemented. Sizing and design only; nothing in this document has been built.
Successor to `docs/plans/egov-tierb-block-v1.md`, which closed the *tier-goes-dark* half of this
problem (§6.2 ratchet, §6.3 watcher) and left this half open in its own closing paragraph.

## 1. The gap

`data/procurement/awarder_geo_overrides.json` decides where an address-less procurement buyer sits.
It reaches the site through three hops, and **only the first two have a gate**:

```
awarder_geo_map.ts  →  awarder_geo_overrides.json   ← gated (awarder_geo_overrides.test.ts)
       ↓ buildRollups (rollups.ts: loadGeoOverrides, fill-missing)
data/procurement/awarders/*.json  (geo.ekatte)      ← gitignored, no gate
       ↓ db:load:awarder-seats:pg[:cloud]
awarder_seats (Postgres, local AND Cloud SQL)       ← NOTHING CHECKS THIS
```

So a rebuilt map that nobody published is invisible. Every existing gate passes: the artifact's own
invariants hold, the tiers all say `ok`, `lastFreshAt` is today, row counts reconcile everywhere.
The site simply keeps serving the previous placements at a 200.

That is not hypothetical — it is what happened on 2026-08-24. The map was rebuilt at 18:26 and
prod kept placing ЕИК `106633686` in Дърманци (ekatte 24668) instead of Мездра (47714) until
`db:load:awarder-seats:pg:cloud` was run by hand hours later. Nothing red in between.

**The failure is quiet in the worst way: it names a real place.** A stale placement does not blank a
page or throw — it attributes a named public buyer's money to the wrong municipality, and both the
wrong answer and the right one look equally plausible.

## 2. What the gate can assert — measured, not assumed

Measured 2026-08-24 against local Postgres, immediately after a clean publish:

| | |
| --- | --- |
| entries in the committed map | **2,174** |
| rows in `awarder_seats` | **3,881** |
| map ЕИК **with** a seats row | **2,174** |
| map ЕИК **missing** a seats row | **0** |
| joined, `ekatte` **agrees** | **2,174** |
| joined, `ekatte` **disagrees** | **0** |

So the invariant is exact and total: **every map entry has a seats row, and every one agrees.** The
gate is an equality assertion, not a statistical one — a single disagreement is a real defect, and
the 2026-08-24 stale state would have shown up as exactly `1`.

The 1,707 seats rows outside the map are address-derived or name-parsed buyers. They are **not** the
gate's business: the map is applied *fill-missing*, so it only ever speaks for buyers with no
address of their own.

⚠ **`awarder_seats` cannot tell you which geo tier produced a row.** Its `source` column is the
SEATS loader's own provenance — `geo` 3,831 / `name` 41 / `curated` 9 — and its `tier` column is the
buyer-TYPE classification (`school`, `hospital`, `municipal`…). All 2,174 map ЕИК land under
`source = 'geo'`, indistinguishable from the 1,657 address-derived rows that share it. Any design
that assumes PG can separate "came from the override map" from "came from a real address" is wrong.

## 3. Design — three pieces, one rule

The rule lives once, in a **pure** function, for the reason `awarder_geo_merge.ts` already exists in
that shape: the thing worth testing must not be welded to I/O.

### 3.1 `compareSeatsToMap()` — pure, no filesystem, no network, no argv

New export in `scripts/procurement/awarder_geo_merge.ts` (or a sibling if that file is felt to be
merge-only — it is the natural home, since `SOURCE_RANK` and `tierAgeDays` already live there):

```ts
export interface SeatsDrift {
  missing: string[];                                          // map ЕИК with no seats row
  disagreeing: { eik: string; map: string; seats: string }[];  // both present, ekatte differs
  checked: number;
}
export const compareSeatsToMap = (
  map: Record<string, GeoEntry>,
  seats: Map<string, string>,   // eik → ekatte, ONLY the rows whose eik is in the map
): SeatsDrift => { … };
```

It reports both arms separately because they mean different things and have different causes —
`missing` is "the loader never ran, or ran against a half-built awarders dir"; `disagreeing` is
"one side moved and the other did not".

### 3.2 The local gate — `scripts/db/tests/awarder_seats_freshness.data.test.ts`

A `.data.test.ts` so it joins `npm run test:data`, which is `db:refresh`'s final step, and
auto-skips when Postgres is down. It **must call `pinLocalDatabase()`** — `scripts/db/lib/pg.ts`
documents the recurring hazard of a cloud `DATABASE_URL` left in the shell, and `graph.data.test.ts`
has already produced one false "prod is broken" reading from exactly that.

Assertions:
1. `drift.missing` is empty.
2. `drift.disagreeing` is empty.
3. `drift.checked === Object.keys(map).length` — so a query that silently returned nothing cannot
   pass by vacuity. This is the one that matters: without it, an empty `awarder_seats` makes both
   arms trivially empty and the gate reports success on the worst possible state.

The failure message names the fix and both halves of it:

```
awarder_seats disagrees with the committed override map on 1 buyer:
  106633686  map 47714  seats 24668
The map has been rebuilt without publishing it, or vice versa. Re-run BOTH:
  npx tsx scripts/procurement/awarder_geo_map.ts && npx tsx scripts/procurement/rebuild_from_cache.ts
  npm run db:load:awarder-seats:pg
and for production: npm run db:load:awarder-seats:pg:cloud
```

### 3.3 The cloud half — `npm run proc:verify-seats[:cloud]`

The local gate cannot see prod, and **prod is where the 16-day incident lived**. So the same pure
comparator gets a thin CLI, `scripts/procurement/verify_awarder_seats.ts`, read-only, exiting
non-zero on drift:

```bash
npm run proc:verify-seats           # local
npm run proc:verify-seats:cloud     # DATABASE_URL=…:5434, matching the db:load:*:cloud twins
```

It **prints the host and database it actually dialled** (via `connectionUrl()`, never `DATABASE_URL`
— they disagree whenever anything pinned) so its output can never be misread as being about the
other database. Wire it into `.claude/skills/update-procurement/SKILL.md` as the last line of the
publish path, beside `db:load:awarder-seats:pg:cloud`.

## 4. The one benign divergence, and why the gate still fails on it

An awarder that **gains a real OCDS address** produces a legitimate, temporary disagreement: the
rollups take the address (address wins over the fill-missing override), the seats loader publishes
it, and the map keeps its now-superseded entry until `awarder_geo_map.ts` next runs and retires it.
If the address's ekatte differs from the override's, the gate fires without anything being wrong.

**Accepted deliberately, for three reasons.** It is rare — one occurrence in the ~2 weeks measured
(ЕИК `812117554`, `mon+oblast` → `ocds`), and it resolved to the **same** ekatte, so it would not
have fired. §2 records the true divergence at 0/2,174. And the remediation is **identical** in both
directions: re-run the map builder, rebuild, reload. A gate whose false positive and true positive
have the same fix is not really a false positive — it is a reminder to run a command that was owed
anyway.

⚠ **Do not "fix" this by filtering on `awarder_seats.source`.** §2 shows that column cannot
separate the two cases. The only filter that would work is reading `address` out of
`data/procurement/awarders/*.json`, which is **gitignored** — so the filter would silently disable
itself on any machine that has not run the ingest, which is the worst of both worlds.

## 5. Considered and rejected

- **A provenance stamp on the load** (`awarder_seats_coverage(map_sha256, loaded_at)`, following the
  repo's `*_coverage` convention). Attractive: prod becomes one query instead of 2,174 rows. Rejected
  because **the stamp would lie.** The seats loader does not read the map — it reads the *rollups*,
  which had the map baked in by a previous `rebuild_from_cache`. Hashing the map file at load time
  therefore records the map on disk **now**, not the map encoded in the rows being loaded, and the
  two differ in precisely the situation the gate exists for. Making it honest means threading a sha
  from `buildRollups` → rollups → loader, which is three files of new coupling to avoid dumping
  2,174 tiny rows. Revisit only if the map grows by an order of magnitude.
- **A test that connects to Cloud SQL.** It would skip whenever the proxy is down — which is most of
  the time, and always in CI — so it would be vacuous exactly when relied upon, while *looking* like
  prod coverage. A script an operator runs deliberately is honest about being manual; a test that
  silently skips is not.
- **Widening the §6.2 `lastFreshAt` ratchet to cover this.** Different quantity. That ratchet ages a
  tier's last *resolution*; this is about whether a *published table* matches a *committed file*. A
  map can be perfectly fresh and wholly unpublished — which is the 2026-08-24 state exactly.

## 6. What this does NOT cover — state it, do not let it be assumed

- **It does not make the cloud check automatic.** §3.3 is a command someone runs. Nothing in this
  repo runs a `:cloud` verification on a schedule, and this spec does not change that.
- **It does not gate the middle hop.** `data/procurement/awarders/*.json` is gitignored, so a map
  rebuilt without `rebuild_from_cache` is caught only transitively, once the seats loader runs.
- **It says nothing about whether a placement is CORRECT** — only that the three copies agree. A
  wrong override that is faithfully published passes.

## 7. Test plan

Unit (`awarder_geo_merge.test.ts`, no DB): agreement → empty drift; a differing ekatte → one
`disagreeing` entry with all three fields; a map ЕИК absent from seats → one `missing`; a seats row
outside the map → ignored; empty seats → `checked` 0 (so the data test's arm 3 is meaningful).

Data (`awarder_seats_freshness.data.test.ts`): the three assertions of §3.2, plus a **mutation
check** in the style this repo already uses — inside a rolled-back transaction, `UPDATE
awarder_seats SET ekatte = '00000' WHERE eik = (one map ЕИК)` and assert the gate now reports
exactly one disagreement. Without it, "0 disagreements" is satisfied by any query that returns
nothing, which is the failure mode arm 3 exists for.

## 8. Effort and sequencing

Small: one pure function (~25 lines), one data test (~60), one CLI (~50), two `package.json` entries,
one SKILL.md line. No migration, no schema change, no new table, nothing to deploy — the CLI is
read-only and the test needs no fixtures. Half a day including the mutation checks.

Sequence: pure function + unit tests → data test (verify it is green on today's corpus, §2) →
mutation check → CLI → wire into the skill. The gate can land before anyone decides §7 of the
Tier B plan.
