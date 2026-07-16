# Procurement parity audit: Наясно vs СИГМА (sigma.midt.bg)

**Date:** 2026-07-16
**Scope:** contracts, awarders (institutions), contractors (companies). Tenders excluded — SIGMA has no tender-stage corpus.
**Method:** pulled SIGMA's per-entity contract CSVs (`/contracts.csv?bidder=<eik>` and `?authority=<eik>`) and per-contract JSON (`/contracts/<id>.json`), joined row-by-row against our Postgres `contracts` table scoped to the SIGMA window (award date 2020-01-01 … 2026-07-15). 4 contractors + 1 authority sampled, plus the corpus headline.

SIGMA is a read-only re-aggregation of the same АОП / ЦАИС ЕОП open data we ingest, EUR @ 1.95583, grain = contract/lot, window 2020–2026. It is not a new primary source.

---

## TL;DR

The two platforms **agree exactly on the at-signing value of every contract they both hold** — our `amount_eur` equals SIGMA's `signingEur` to the cent, proving our EUR conversion and per-lot split math are correct. Every headline difference decomposes cleanly into **five methodology/coverage mechanisms**, four of which are defensible presentation choices and **one of which is a genuine, actionable coverage gap**:

| # | Mechanism | Nature | Direction | Action |
|---|-----------|--------|-----------|--------|
| 1 | Value basis: **at-signing** (ours) vs **current/post-annex** (SIGMA) | Methodology | both | Product decision (P3) |
| 2 | Consortium: **partner-split** (ours) vs **union "и др." entity** (SIGMA) | Methodology | ours higher per-company | Document / add view (P4) |
| 3 | Scope: **award date** (ours) vs **procedure year** (SIGMA) | Methodology | ours higher | Document (P5) |
| 4 | **storage.eop.bg contracts missing for already-covered buyers** | **Coverage gap** | **SIGMA higher** | **FIXED 2026-07-16** — see Resolution |
| 5 | **UNP key not canonicalized** to ЦАИС УНП | Data quality | ~net zero | Fix — P2 |

The one number to act on: **АПИ alone was missing ≥ €956M** of major consortium road contracts (mechanism 4). **Resolved 2026-07-16** — see below.

---

## Headline corpus comparison

| Metric | Наясно (2020+, by award date, at-signing) | СИГМА (2020–2026, by procedure year, current value) |
|---|---|---|
| Contracts + lots | 199,020 | 196,156 |
| Total value | €49.29bn | €52.3bn |
| Institutions | 3,879 | 4,456 |
| Companies | 14,825 | 17,597 |

The value gap (SIGMA +€3.0bn) is mechanism 1 (current vs signing) net of mechanisms 3/4. The institution/company count gaps are the known storage.eop.bg schools coverage (~€169M, 0.23%) plus SIGMA's messier keys (13-digit branches kept separate) — see the [SIGMA platform reference](../CLAUDE.md) notes; low materiality.

## Sampled entities (2020+ window)

| Entity | EIK | Ours rows | Ours € | SIGMA rows | SIGMA € | Δ (ours−sigma) |
|---|---|--:|--:|--:|--:|--:|
| "Автомагистрали" ЕАД (contractor) | 831646048 | 15 | 787.2M | 15 | 760.9M | +26.3M |
| Нивел Строй ЕООД (contractor) | 113580690 | 151 | 344.4M | 110 | 176.5M | +167.9M |
| ГБС-Инфраструктурно строителство (contractor) | 130131711 | 41 | 336.4M | 33 | 193.0M | +143.4M |
| "Софарма Трейдинг" АД (contractor) | 103267194 | 3,785 | 1,427.0M | 3,172 | 1,285.3M | +141.7M |
| Агенция "Пътна инфраструктура" (authority) | 000695089 | 1,183 | 4,272.0M | 711 | 4,590.0M | −318.0M |

---

## The five mechanisms, with evidence

### 1. Value basis — at-signing (ours) vs current/post-annex (SIGMA) — PROVEN

SIGMA's per-contract JSON carries a `value` object: `estimatedEur`, `signingEur`, `currentEur`, `deltaPct`. Its lists and headlines default to **`currentEur`** ("текуща (изчистена) стойност" — value after annexes). We store the **at-signing** value.

The two agree exactly on signing value:

| UNP | Our `amount_eur` | SIGMA `signingEur` | SIGMA `currentEur` (listed) | Δ% |
|---|--:|--:|--:|--:|
| 00044-2024-0047 | €69,832,372.96 | €69,832,372.96 | €53,557,088.01 | −23.3% (annex reduced scope) |
| 00044-2022-0099 | €16,129,931.54 | €16,129,931.54 | €36,292,345.96 | +125% (annex increased) |

This single mechanism explains every solo-contractor delta in **both** directions: annex reductions make SIGMA lower, annex increases make SIGMA higher. It is a genuine methodology choice, not a bug. Our EUR conversion is identical to SIGMA's.

### 2. Consortium attribution — partner-split (ours) vs union entity (SIGMA) — PROVEN

For ДЗЗД/консорциум awards, SIGMA books the full contract under a combined union pseudo-entity ("…**и др.**"), excluded from any named member's profile. We split the lot value across the named partners and fold each share into that company's rollup.

Example — the €101.8M ГБС rail lot `00233-2024-0095` (Видин–София modernization) is OURS-ONLY under ГБС; in SIGMA it lives under **"ДЗЗД ЖП Медковец-Срацимир и др." (€305.5M full value)**. This is the bulk of the ГБС (€143M) and Нивел (€168M) per-company gaps. Both conventions are defensible: ours shows a company's real footprint including joint work; SIGMA's shows solo-attributed wins.

### 3. Scope basis — award date (ours) vs procedure year (SIGMA) — PROVEN

We scope by contract **award date**; SIGMA appears to scope by **procedure/УНП year**. On АПИ, our 282 ours-only UNPs total €768.6M, of which **94% (€719.2M) is pre-2020 procedures** (2018 UNP €499M, 2019 UNP €220M) that were *awarded* in 2020+ (e.g. `00044-2018-0080`, €255.6M, signed 2023-05-12). SIGMA excludes them by procedure year; we include them by award date. Our basis is arguably more complete for "money committed in-window."

### 4. Coverage gap — storage.eop.bg contracts missing for already-covered buyers — GENUINE, ACTIONABLE — **FIXED 2026-07-16**

SIGMA loads `storage.eop.bg` directly (broader than the АОП OCDS bundles we ingest). Our `ingest_eop` gap-fill only ingests buyers **entirely absent** from our corpus (the existing-buyer guard that prevents a documented double-count). Consequence: for a heavily-covered buyer like АПИ, its storage.eop.bg-**only** records are never picked up.

Verified genuinely missing from our corpus (no record under any tag/date/key):

| UNP | What | SIGMA current value | Signed |
|---|---|--:|---|
| 00044-2020-0085 | Русе–Бяла road, 2 ДЗЗД lots (ПЪТИНЖЕНЕРИНГСТРОЙ-Т €448.2M + ВОДНО СТРОИТЕЛСТВО €337.7M) | €785.8M | 2022-10/11 |
| 00044-2021-0018 | АМ строителство (ЕВРОПА-2022 ДЗЗД) | €170.6M | 2021-12-22 |

**≥ €956M for АПИ alone.** These are exactly the kind of large consortium infrastructure contracts our users care about. This almost certainly recurs for НКЖИ and other big infra buyers.

#### Resolution (2026-07-16)

Fixed via a **scoped, content-deduped gap-fill** over the six top state-infrastructure buyers, not a blanket relaxation of the existing-buyer guard (which still protects the ~€120bn `--include-existing-buyers` double-count invariant everywhere else). Two changes to `scripts/procurement/`:

1. **`normalize_eop.ts` — multi-buyer parsing** (`resolvePrimaryBuyer`). The `buyerRegistryNumber` on these mega-contracts is a semicolon list — a control body (e.g. the АДФИ, `175076479999`) listed *alongside* the real authority (`175076479999; 000695089` = АДФИ; АПИ), which the old single-EIK `canonicalEik` rejected outright, dropping the record. The general feed still skips multi-buyer records (no attribution guessing); only a caller-supplied `preferBuyers` whitelist recovers the record under the whitelisted authority, taking its positionally-aligned name. The incremental path is byte-for-byte unchanged.
2. **`ingest_eop.ts` — `--only-buyers <eik,…>` whitelist**. Restricts output to a list of already-covered authorities and **requires `--cross-source-dedup`** (throws otherwise), so every recovered row is content-deduped (УНП+supplier+€ / buyer+supplier+contract-no+date / buyer+supplier+date+€) against the on-disk corpus and can never double-count what we already hold.

Run (offline, all 2,387 daily buckets already cached):

```bash
npx tsx scripts/procurement/ingest_eop.ts --from 2020-01-01 --to 2026-07-14 --backfill \
  --cross-source-dedup --only-buyers 000695089,130823243,175201304,175203478,000632256,000649348 --apply
npx tsx scripts/procurement/rebuild_from_cache.ts    # rollups / by_settlement / by-id / index
npx tsx scripts/procurement/rebuild_derived.ts       # cross-reference derived WITH the TR-namesake filter (do NOT use rebuild_from_cache's derived — it lacks the filter and inflates the MP set 45→123)
npx tsx scripts/procurement/contract_index.ts        # faceted-browser shards
npm run db:load:pg && npm run db:gen-hub-stats && npm run db:gen-sector-stats
```

**Recovered: 1,247 rows / €1,988,942,746 at-signing**, deduped against 573,172 existing content keys (dropped 6,768 already-held rows). Per buyer: АПИ €1,202.75M (247), Булгартрансгаз €403.24M (62), НКЖИ €155.21M (124), Метрополитен €140.13M (14), ЕСО €81.88M (775), НЕК €5.73M (25). Both target contracts now under `awarder_eik=000695089`: `00044-2020-0085` €785.83M (2 lots, matches SIGMA to the cent), `00044-2021-0018` €113.75M at-signing (SIGMA current €170.6M = a later annex, mechanism 1). Corpus headline moved by exactly the recovered amount (€87.14bn → €89.13bn PG raw-sum basis; `index.json` €81.20bn → €83.19bn). Zero true double-counts: only 9 of 1,247 rows shared (buyer, supplier, rounded €) with a prior row, all confirmed distinct (no matching contract number in the corpus). `test:data` all green (contract keys unique, no legacy -x twins, rollups reconcile, PG lossless). MP crossReference held at baseline (45 MPs / €1,673M); officials rose €479M → €535M (regional road firms linked to local officials — legitimate).

**Scope note:** only the six state-infrastructure authorities were whitelisted. Large **municipalities** were deliberately deferred — the semicolon-list `buyerRegistryNumber` on the municipal tier is far more often a genuine multi-authority joint procurement (not a control body), so attributing to one lead needs its own review. A future pass can extend the whitelist once that attribution is validated.

### 5. UNP key not canonicalized — data quality — PROVEN

Same contract appears under different keys on each side because we keep source-synthetic keys instead of canonicalizing to the ЦАИС УНП:

| Ours | SIGMA | Value (both) |
|---|---|--:|
| `aop-legacy-2023-412573` | `T310235` | €152,608 |
| `ocds-e82gsb-546273` | `T546273` | €1,616,106 |
| `eop-T78923` | `T78923` | €461,440,923 |

Nets to ~zero (no double-count observed) but breaks cross-referencing and inflates apparent "only on one side" diffs. On Софарма, €157.6M of our rows carry no canonical УНП (legacy/eop/ocds keys), mirroring €227.8M of SIGMA-only rows — largely the same contracts failing to join.

---

## АПИ full reconciliation (proves the decomposition)

Ours €4,272.0M − SIGMA €4,590.0M = **−€318.0M**, which reconciles exactly:

- − SIGMA-only (mech. 4 coverage gaps, mostly consortium road): **€1,062.7M** (≥€956M verified genuinely missing)
- + Ours-only (mech. 3 pre-2020 procedures awarded in-window): **€768.6M**
- + Common-UNP delta (mech. 1 net annex effect on АПИ frameworks): **−€23.8M**

−1,062.7 + 768.6 − 23.8 ≈ **−318 M.** ✓

The row-count gap (ours 1,183 vs SIGMA 711) is finer lot/split granularity on our side, not double-counting (common-UNP value delta is only −€24M).

---

## What is NOT a problem — do not chase

- **EUR conversion** — identical to the cent (1.95583). Confirmed on every shared contract.
- **Per-lot / multi-supplier split math** — correct (`signingEur` matches our split to the cent).
- **Institution/company head-count gaps** — SIGMA's messier keys + storage.eop.bg schools; known, €169M / 0.23% materiality.
- **Tenders** — SIGMA has no tender-stage corpus; our tenders view is a differentiator, no parity work needed.

---

## Recommendations (prioritized)

**P1 — Close the storage.eop.bg coverage gap for high-value covered buyers (mechanism 4). — DONE 2026-07-16.**
Fixed with a per-(buyer, УНП) content-deduped gap-fill scoped to a whitelist of top infrastructure buyers (АПИ + НКЖИ/ЕСО/Булгартрансгаз/Метрополитен/НЕК) via the new `ingest_eop --only-buyers … --cross-source-dedup`, plus a multi-buyer parsing fix in `normalize_eop`. Recovered €1.99bn at-signing (АПИ €1.20bn) with zero double-counts. See the Resolution under mechanism 4 for the full command, numbers, and verification. Municipalities deferred (see scope note).

**P2 — Canonicalize UNP keys (mechanism 5).**
Map `aop-legacy-*`, `ocds-*`, `eop-T*` synthetic keys to the canonical ЦАИС УНП where derivable. Improves cross-source dedup, cross-referencing, and removes false one-side-only diffs. Prerequisite for a clean re-audit. (Note: P1's content-key dedup already guards against the double-count P2 would otherwise risk, so P1 and P2 are independent.)

**P3 — Decide the headline value basis (mechanism 1).**
We show at-signing; SIGMA shows current (post-annex). Best-in-class and a differentiator: ingest the storage.eop.bg **Анекси** feed and show **both** (signed value + current value + Δ%) on the contract card, keeping totals on a stated basis. This is a feature, not a fix.

**P4 — Document / surface the consortium convention (mechanism 2).**
Our per-company total includes consortium shares. Either label it clearly on company pages or add an optional union/consortium view. Low urgency; mainly a transparency note.

**P5 — Document the scope basis (mechanism 3).**
State that we scope by award date (more complete for in-window commitments). Optionally offer a procedure-year filter for parity checks. Documentation only.

---

## Reproduce

SIGMA endpoints (public, CC-BY 4.0, no API but stable CSV/JSON):
- Company contracts CSV: `https://sigma.midt.bg/contracts.csv?bidder=<EIK>`
- Authority contracts CSV: `https://sigma.midt.bg/contracts.csv?authority=<EIK>`
- Per-contract JSON (all value fields): `https://sigma.midt.bg/contracts/<id>.json`

Our side: `contracts` table, `tag='contract'`, `date BETWEEN '2020-01-01' AND '2026-07-15'`, join on UNP after stripping the `eop-` prefix. `amount_eur` = at-signing EUR.
