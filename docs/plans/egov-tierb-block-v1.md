# Tier B (МОН open-data register) has been dark since 2026-08-06 — v1

**Status:** investigated 2026-08-24. Tier B **re-run and restamped `ok` the same day** (§2i) —
the block was intermittent and has cleared. The durable problem (nobody could tell for 16 days) is
**still open**: §6.2 and §6.3 are unimplemented. Carries one decision for a human (§7).

## 1. The symptom

The 2026-08-22 `/process-watch-report` run reported:

```
Tier B unavailable — МОН register fetch failed: POST getResourceData → 403 Forbidden
merge: 92 carried over (mon+oblast 57, mon 35), 0 retired, 0 vanished, 0 dropped, 0 malformed
✓ wrote data/procurement/awarder_geo_overrides.json — 2174 entries (was 2170)
```

and the committed artifact records `tiers.mon = { status: "unavailable", lastFreshAt:
"2026-08-09T07:05:01.281Z" }` while every other tier stamped `2026-08-22`.

**The merge machinery did exactly what it was built to do.** Nothing in §5 proposes changing it.
The problem is that a tier stopped resolving for over two weeks and the only trace was one stderr
line and a field in a committed JSON nobody reads.

## 2. Evidence

All figures measured **2026-08-24** from this host (macOS, egress `92.247.49.124`) against the
committed corpus at `7cc349a84c`. Replay scripts were read-only; nothing in the repo was written.

### 2a. The block is intermittent, and it is NOT a geo-block

| probe | result |
|---|---|
| `POST data.egov.bg/api/getResourceData` (resource `cac4d569`, Tier B's own call) | **HTTP 200, 2,219,861 bytes, 1.38 s** |
| `GET data.egov.bg/data?org[0]=502&page=1` (the `--discover` call that died) | **HTTP 200** |
| header returned | `["№","Обаст","Община","Населено място","Код по НЕИСПУО","Име на училище/детска градина","Вид на училището","Адрес"]` — 4,512 rows, no ЕИК column, exactly as documented |

**The egress IP is already Bulgarian residential** — `92.247.49.124`, Sofia, **A1 Bulgaria EAD
(AS29580)**. So `reference_egov_api_endpoints`'s "a BG residential IP is the documented
workaround" does not explain this outage: we were on one throughout. The 403 is reputation- or
rate-based against this specific address (or a transient WAF state), not a geography check. **The
BG VPN is therefore not the lever here** — it would swap one BG residential IP for another — and
the `reference_watch_vpn_source_split` trade-off (VPN breaks parliament / МО / CIK) does not need
to be paid. That memory note should be amended rather than acted on.

### 2b. The staleness is worse than the artifact says — 16 days, not 13

`lastFreshAt` is stamped `ok ? generatedAt : (prior.tiers?.[key]?.lastFreshAt ?? prior.generatedAt)`
(`awarder_geo_map.ts`). The merge machinery landed 2026-08-10; the prior file (2026-08-09,
`02daaf37e`) had **no `tiers` block**, so `mon.lastFreshAt` bootstrapped from that file's
`generatedAt` — and that build's own note reads:

> `"mon/mon+oblast tiers carried over from the previous build: data.egov.bg returned 403 (egress-IP block) on 2026-08-09"`

So the seed date is a build in which **Tier B was already down**. The last genuinely fresh Tier B
resolution is `2026-08-06T21:22:19Z` (`f4b608948`, `mon 38 + monOblast 59`, no note).

| measured from | to the 2026-08-22 build | to 2026-08-24 |
|---|---|---|
| stamped `lastFreshAt` 2026-08-09 | 13.5 d | 15.7 d |
| **true last-fresh 2026-08-06** | **15.9 d** | **17.1 d** |

A one-off, non-recurring 3-day optimism (it only ever fires on the bootstrap), but any age-based
alarm inherits it — worth knowing before tuning a threshold.

### 2c. Tier R does NOT cover these buyers — it is a schools crosswalk in practice

Cross-checking the 92 carried EIKs against `derived/mon_ri_eik_crosswalk.json` (2,667 entries,
crawled 2026-07-18):

**0 of 92 are present.** Not one.

The reason is structural, and it generalises:

| awarder-name class | in corpus | in RI crosswalk | coverage |
|---|---|---|---|
| school-named (`УЧИЛИЩЕ`/`СУ`/`ОУ`/`ПГ`/`ГИМНАЗИЯ`) | 1,956 | 1,933 | **98.8%** |
| kindergarten-named (`ДЕТСКА ГРАДИНА`/`ДГ`/`ЦДГ`/`ОДЗ`) | 480 | 2 | **0.4%** |

**91 of the 92 carried entries are kindergartens.** `mon_ri_crawl.ts` lists institutions with
`{"isRIActive":1}` and keeps a card only `if (d.bulstat && d.settlementTown != null)`, which
yields 2,667 of the register's 4,512 institutions — the shortfall is essentially the
kindergarten population. So Tier R "supersedes Tier S" (secondary schools) exactly as documented
and **does not supersede Tier B**, whose surviving contribution is almost entirely kindergartens
that Tier R structurally cannot see today.

### 2d. All 92 carried placements are still correct — verified, not assumed

A faithful read-only replay of Tier B's logic (`nameCore` → register index → global-uniqueness or
Tier-D oblast pin → `resolver.resolve({locality, region})`, identical to `awarder_geo_map.ts`)
against the register fetched **today**:

```
=== faithful Tier-B replay of the 92 carried entries, TODAY's register ===
{ AGREE: 92 }
```

**92/92 resolve to the identical EKATTE under the identical source label.** Zero disagreements,
zero relabels, and **zero name-cores absent from the register** — so none of the 91 kindergartens
has been closed, merged or delisted. The "ЕИК↔EKATTE is stable, an institution does not move"
justification for carrying holds for these specific 92, empirically and not just in principle.

A second, independent corroboration arrived on its own. Between the 2026-08-18 and 2026-08-20
builds one entry left the mon family:

```
812117554  „Детска Градина Надежда"   mon+oblast → ocds,  EKATTE 07079 → 07079
```

Tier E (the buyer's **own declared OCDS address**) picked it up and produced the **same EKATTE** a
carried Tier-B name-match had asserted. That is the merge working as designed (rank `ocds`=3 beats
stale `mon`=4) *and* a third-party confirmation of a carried placement.

### 2e. The block cost no placements — but see §2i, it did cost one *correction*

Replaying Tier B over **every** current override candidate (2,761 awarders with no OCDS address),
counting only those no tier resolved this run:

```
=== NEW placements a fresh Tier B would add TODAY ===
count: 0 | EUR 0 | contracts 0
```

A fresh Tier B run adds **no new awarder** to the map. The carry-forward absorbed that half of the
outage completely, and this is the number that decides the urgency in §4.

⚠ **This measurement has a blind spot, and the re-run in §2i walked straight into it.** The replay
skips any awarder already in the map (`if (ov.awarders[a.eik]) continue`), so it can only see
Tier B *adding* a placement — never Tier B **outranking a lower tier that had covered for it**.
Tier B is rank 4 and Tier A (`name` / `name+oblast`) is rank 5, so while Tier B is down, Tier A
silently answers for buyers Tier B would have claimed. Those buyers stay in the map at the right
count and the wrong tier, and §2e cannot see them. Read this section as *"no buyer went unplaced"*,
never as *"nothing changed"*.

### 2f. Tier B's contribution is decaying, and the mechanism is known

From the artifact's own git history (`mon` + `monOblast`/`mon+oblast`):

| build | mon-family entries | note |
|---|---|---|
| 2026-07-18 (`2374980df`) | **306** | before Tier R existed |
| 2026-07-18 (`593937f8f`) | **104** | Tier R lands (`ri: 1285`) and absorbs 202 |
| 2026-08-06 (`f4b608948`) | 97 | last genuinely fresh Tier B run |
| 2026-08-09 (`02daaf37e`) | 93 | already carried — first 403 |
| 2026-08-22 (`7cc349a84`) | **92** | 8 consecutive carried builds |

Attrition since Tier R is ~1 entry per fortnight, via Tier E absorbing a buyer as it publishes an
OCDS обявление with an address (§2d). At that rate the residual 92 would take **years** to reach
zero, and only for buyers that keep procuring.

### 2g. What the 92 are worth

€17,945,021 across 776 contracts, spanning **38 settlements / 32 municipalities / 20 oblasti**.
Largest concentrations: София €4.50m, Варна €2.36m, Добрич €2.10m, Маринка €2.10m, Шумен €0.97m.

### 2h. ⚠ Retiring the tier would NOT drop the 92 — it would fossilise them

Worth stating because the intuition runs the other way. `mergeGeoOverrides` carries an
**unrecognised** prior label (`SOURCE_RANK[p.source] === undefined` → `producible.has()` false →
`stale` → carried), and `awarder_geo_merge.test.ts:296` pins that behaviour. So deleting Tier B
from `TIER_LABELS`/`SOURCE_RANK` leaves the 92 in the map **permanently, with no tier able to
re-verify them ever again** — carried forever by the very rule written to protect a temporarily
down tier.

It would not be silent, though: `awarder_geo_overrides.test.ts`'s *"carries no entry from an
unrecognised tier"* gate goes **red** the moment Tier B is removed. That gate is what converts a
quiet retirement into an explicit decision — see §7.

### 2i. The re-run — Tier B restamped `ok`, and corrected a placement

Executed 2026-08-24, `npx tsx scripts/procurement/awarder_geo_map.ts` (dry-run first, then write):

```
  Tier B: МОН register indexed 4424 institution(s) under 1855 name-core(s)
  this run resolved 2174/2761 (RI 1291, TR 107, school 1, МОН 38, МОН+oblast 57,
                               OCDS 334, name 266, name+oblast 80); 587 unresolved
  merge: 0 carried over, 0 retired, 0 vanished, 0 dropped, 0 malformed,
         1 re-resolved to a different EKATTE
✓ wrote data/procurement/awarder_geo_overrides.json — 2174 entries (was 2174)
```

All seven tiers now `status: "ok"`, `lastFreshAt: "2026-08-24T18:36:32.199Z"`, `carriedOver: {}`,
no `notes`. `run.unresolved` fell 679 → 587 — the `sources`-vs-`run` divergence that §1 describes
as the signal, closing.

**Map diff: 0 added, 0 removed, 3 changed.** All three are kindergartens, and none is a regression:

| eik | before | after | verdict |
|---|---|---|---|
| `106633686` ДГ „Слънчице" с филиал с. Дърманци | `name+oblast` **24668 Дърманци** | `mon` **47714 Мездра** | ⭐ **correction** |
| `115837652` ДГ „Незабравка" — гр. Кричим | `name+oblast` 39921 | `mon` 39921 | relabel only |
| `176148209` ДГ „Ралица" — гр. Кричим | `name+oblast` 39921 | `mon` 39921 | relabel only |

The one that moved is the interesting one, and it was verified against the register directly:

```
обл. Враца | общ. Мездра | нас.място Мездра | НЕИСПУО 609161
„Детска градина „Слънчице"  с филиал с. Дърманци" | адрес: ул."Дунав" №1
```

— and **no register row for Дърманци exists at all**; the филиал is not a separate institution.
Tier A had parsed the branch-village token `с.ДЪРМАНЦИ` out of the awarder's own name and placed
the buyer in the **branch**; Tier B matches the institution and places it at its **registered
seat**, Мездра. The legal entity that signs the contract sits in Мездра, so Tier B is right, and
the tier ordering (`mon` 4 beats `name` 5) exists precisely for this.

**So the block did have a cost, just not the one §2e measured**: for 16 days one buyer's €71,341
was attributed to a village of ~700 people instead of the town its kindergarten is registered in.
The class is *branch-vs-seat* — awarder names carrying `филиал` / `изнесена група` / a second
settlement token — and Tier B is the only tier that resolves it, because it is the only one that
matches the **institution** rather than the **string**.

⚠ **This is not yet live.** The builder writes the override map; `by_settlement` and the place /
My-Area tiles only move on `npm run procurement:ingest` — and per the update-procurement skill a
plain ingest resets `amountEur` to the signing value, so the current-value fold chain
(`anexi_current_value --apply` → `backfill_unp --apply` → `reconcile_cross_source --apply` →
`rebuild_from_cache` → `rebuild_derived`) and then `db:load:pg` + `db:load:annexes:pg` must follow
it. For a three-entry change that is an operator decision about timing, not an automatic
consequence — fold it into the next scheduled procurement ingest rather than running the chain for
this alone.

## 3. Why the signal was missed — and the finding that reframes the fix

**A watcher already probes Tier B's exact endpoint.** `scripts/watch/sources/mon_ri_register.ts`
calls `getResourceData("cac4d569-529c-4209-b797-1cf5f69901f5")` — the same resource, via the same
`egov_api` helper, as `fetchMonSchoolMap()` in `awarder_geo_map.ts`. When data.egov.bg 403s, that
source **throws**, and `renderReport` puts it under `## Errors` in the daily report.

`state/watch/mon_ri_register.json` is frozen at `lastChecked 2026-08-08`, and its state commits run
weekly — 07-19, 07-25, 08-01, **08-08, then nothing**. A failed fetch writes no state, so the two
missing weekly probes (≈08-15, ≈08-22) are the block, recorded.

So the signal existed and fired. Three things stopped it landing:

1. **It is labelled for the wrong downstream.** Its `describe()` ends
   `"— re-crawl mon_ri_crawl to refresh the ЕИК→EKATTE crosswalk"`, i.e. it names **Tier R**. Its
   header comment frames the resource purely as a *proxy* for ri.mon.bg. Nothing connects it to
   Tier B, which consumes that resource **directly** and is the thing that actually broke.
2. **Weekly cadence.** Correct for detecting school openings; too coarse for an outage — it could
   report at most twice across 16 days.
3. **An error line is transient.** It says "the upstream was down today", never "our committed
   artifact has been riding a stale vintage for 16 days". Nothing was watching the *artifact*.

## 4. Assessment

| question | verdict | basis |
|---|---|---|
| **Repairable?** | **Already working.** Nothing to repair — HTTP 200 today (§2a). | §2a |
| **Workaroundable?** | **N/A, and the documented workaround is a red herring.** Already on BG residential egress; the VPN is not the lever and its cost need not be paid. | §2a |
| **Retirable?** | **No — not today**, for two reasons. It exclusively holds 92 placements (€17.9m, 776 contracts, 38 settlements) no other tier can produce (Tier R covers 0.4% of kindergartens); and it is the only tier that resolves **branch-vs-seat** names, where Tier A silently mis-places the buyer in a филиал's village. | §2c, §2g, §2i |
| **Urgent?** | **Low, not nil.** A fresh run adds **0 new placements** — but it also corrected one buyer that Tier A had mis-placed for the whole outage. Re-run promptly; no emergency. | §2e, §2i |
| **Trending toward retirement?** | **Yes, slowly.** 306 → 92 since Tier R; ~1/fortnight via Tier E. Years away. | §2f |

**In one sentence:** Tier B is a small, decaying, currently-healthy tier that is still the sole
source for 91 kindergartens' placements *and* the only corrector of branch-vs-seat mis-parses — so
the work is not repair and not retirement, it is making its silence audible and re-running it.

## 5. Options

Constraints honoured throughout: the >5% shrink guard is untouched; `readTierJson`'s
absent/unparseable/shape-drifted/**empty** ⇒ unavailable rule is untouched; no shrunk map is
committed.

### Option 1 — Re-run `awarder_geo_map.ts` now (restamp) — ✅ **DONE 2026-08-24, see §2i**
The endpoint was up; the run restamped all seven tiers `ok` and cleared `carriedOver`.

⚠ **This option predicted "a no-op on content" and was wrong** — 3 entries changed, one of them a
real EKATTE correction (§2i). The prediction came from §2e, whose replay is blind to Tier B
*outranking* Tier A rather than adding a row. The instruction that caught it — *verify the
`sources` block rather than assuming it comes back unchanged* — is the part worth keeping: it is
what turned a wrong prediction into a finding instead of a silent commit. Keep it for the next
tier that comes back up.

### Option 2 — Ratchet the artifact's own staleness (**the durable fix**)
Add one assertion to `scripts/procurement/awarder_geo_overrides.test.ts`: **no tier may sit
`unavailable` with a `lastFreshAt` older than N days.**

The precedent is exact — `scripts/macro/degraded.test.ts` solves the identical defect class (a
carried-forward vintage marker that outlives its outage and is invisible) with
`MAX_DEGRADED_DAYS = 14`, measured from the artifact's own timestamp, and an error message naming
the re-run command. Copy its shape, its tone and its generosity.

⚠ **One adaptation is load-bearing and inverts the precedent.** `degraded.test.ts` ages from
`fetchedAt` — the run's own timestamp — deliberately, "so re-running during a prolonged outage
resets the clock". **Here that would be exactly wrong**, and demonstrably so: this artifact was
rebuilt **8 times in 13 days** with a fresh `generatedAt` every time while Tier B stayed dark. The
ratchet must read **`tiers[key].lastFreshAt`**, never `generatedAt`. Naively porting the
precedent produces a gate that can never fire on the case it was written for.

Two further notes for whoever implements it:
- It inherits the §2b 3-day optimism. A 14-day threshold therefore fires at ~17 real days once,
  and correctly thereafter.
- It is deliberately time-dependent, which `docs/testing-standards.md` §Determinism otherwise
  forbids. `degraded.test.ts` is the sanctioned exception for precisely this purpose; the new
  assertion should carry the same "why this is a ratchet, not a unit test" comment so the next
  reader does not delete it as non-deterministic.

### Option 3 — Point the existing watcher at Tier B too (cheap, complementary)
`mon_ri_register` already fetches the right resource (§3). Two edits, no new source, no new
network call:
- extend `describe()` to name **both** downstreams — `mon_ri_crawl` (Tier R) *and*
  `awarder_geo_map.ts` (Tier B, which reads this resource directly);
- consider `cadence: "daily"`. It is one 2.2 MB POST; the current weekly cadence is tuned to
  school openings, and `cadence.test.ts` enforces only a *floor* (sample at least twice per
  publication period), so tightening is permitted. Daily makes an outage visible the next morning
  instead of up to a week later.

### Option 4 — Widen Tier R to cover kindergartens (removes the need for Tier B)
The register lists 4,512 institutions; the crawl yields 2,667, dropping cards without
`bulstat`/`settlementTown` (§2c). If the missing ~1,845 are recoverable — untested — Tier R could
absorb the kindergartens and make Tier B genuinely retirable via §5.5 rather than by fiat.

Not proposed as work now: it is a headed-Playwright crawl against a Cloudflare-walled SPA, the
payoff is 92 already-correct entries, and the diagnosis (are those cards missing `bulstat`, or
missing from `isRIActive:1`?) has not been done. Recorded so the option is not re-discovered.

### Option 5 — Retire Tier B
Rejected for now (§4). If it is ever taken, it is **not** a deletion: §2h shows the 92 would be
carried forever as unrecognised labels, and the committed-artifact gate would go red. A real
retirement means deciding what happens to those 92 placements — see §7.

## 6. Recommendation

1. ✅ **Re-run `awarder_geo_map.ts`** (Option 1) — done 2026-08-24; `mon` restamped `ok`, and the
   run corrected one placement (§2i). The map change is written but **not yet applied to
   `by_settlement`**; fold `npm run procurement:ingest` + the current-value chain into the next
   scheduled procurement ingest.
2. **Add the `lastFreshAt` ratchet** (Option 2) to `awarder_geo_overrides.test.ts`, aged from
   `tiers[key].lastFreshAt`, threshold ~14 days, modelled on `degraded.test.ts`. This is the piece
   that makes the next outage announce itself, and it covers **every** tier, not just Tier B.
3. **Relabel the watcher** (Option 3) so the daily `## Errors` line names the downstream that
   actually broke; tighten to daily if the extra request is acceptable.
4. **Do not** retire Tier B, chase the VPN, or touch the merge, the shrink guard or `readTierJson`.
5. Amend `reference_egov_api_endpoints` in memory: a 403 from data.egov.bg is **not** proof of a
   foreign egress IP — this host was on A1 Bulgaria residential throughout.

Steps 2 and 3 are the actual deliverable and **remain open** — step 1 fixed today's instance, not
the blindness that let it run for 16 days. The next outage is silent again until the ratchet lands.

## 7. ⚠ The decision that belongs to a human, not to this plan

**Retiring a geo tier changes which buyers appear on `/procurement/by-settlement` and the place /
My-Area tiles.** Concretely, retiring Tier B puts 92 placements — €17.9m across 776 contracts, 91
kindergartens, 38 settlements in 20 oblasti — into one of two states, and **neither is neutral**:

- **carried as unrecognised labels forever** (what happens by default, §2h): the buyers stay on
  the map, permanently unverifiable, with a red gate in `awarder_geo_overrides.test.ts`; or
- **dropped**: 91 kindergartens leave `by_settlement` and the place tiles — the same class of
  regression as the 2026-08-10 incident that produced the merge machinery, only deliberate.

This plan recommends neither. It recommends keeping Tier B (§6) precisely so the choice does not
have to be made now, and records the two outcomes so that if it is made later it is made with the
consequences visible rather than as a tidy-up.

## 8. Gates that must stay green

- `scripts/procurement/awarder_geo_merge.test.ts` — merge rule, tier-availability relation, shrink
  verdict. **Unchanged by every option above.**
- `scripts/procurement/awarder_geo_overrides.test.ts` — committed-artifact invariants. Option 2
  adds one assertion here; the existing *"carries no entry from an unrecognised tier"* check is
  what would catch a Tier B retirement (§2h) and must not be relaxed to accommodate one.

## 9. Reproduction

The three read-only replays behind §2c–§2e are not committed (they import `resolve_ekatte` and
`school_name_match` and write only to a scratch dir). To redo any of them:

```bash
curl -s -X POST 'https://data.egov.bg/api/getResourceData' \
  -H 'Content-Type: application/json' \
  --data '{"resource_uri":"cac4d569-529c-4209-b797-1cf5f69901f5"}' > /tmp/mon.json
```

then index `data[1..]` by `nameCore(row[5])` → `{settlement: row[3], oblast: row[1]}` and apply the
Tier B rule from `awarder_geo_map.ts` (unique name-core, or Tier-D `buyer_oblast_map` pin, then
`resolver.resolve({locality, region: oblastToNuts(oblast)})`). Compare against the `mon` /
`mon+oblast` entries in `data/procurement/awarder_geo_overrides.json`.
