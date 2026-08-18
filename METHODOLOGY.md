# Methodology

Every number this project publishes comes from a documented method. This file is the index
to those methods — where each one is specified, and how to cite it.

The project is licensed in two halves: code and specifications under MIT, republished public
data under each source's own terms. See [LICENSE](LICENSE) for the boundary, stated by path.

---

## Procurement risk — the red-flag catalogue

The flag definitions, thresholds, legal bases, weights and reconciliation rules behind the
contract risk index (CRI), the per-contract grade and the buyer/supplier exposure grades.

| Artifact | Where |
|---|---|
| The handbook (how to read a flag, per-flag reference, legal thresholds, known limits) | [docs/methodology/procurement-risk-flags.md](docs/methodology/procurement-risk-flags.md) |
| The machine-readable catalogue | [`public/risk-flags.json`](public/risk-flags.json) |
| The single source it is generated from | [`src/lib/riskFlagCatalog.ts`](src/lib/riskFlagCatalog.ts) |
| The implementation | `src/data/procurement/computeProcurementRisk.ts`, `computeTenderRisk.ts`, `scripts/db/schema/pg/112_contract_risk_cache.sql`, `041_procurement_risk_grade.sql` |
| Why it is published at all | [docs/plans/procurement-risk-open-source-v1.md](docs/plans/procurement-risk-open-source-v1.md) |
| The methodology it implements | [docs/plans/procurement-risk-v2.md](docs/plans/procurement-risk-v2.md) |

> **Status — read this before following the links above.** The licence and this index shipped
> first, deliberately: an unlicensed spec is not reusable however well written. Everything in
> the table except the last three rows is **forthcoming** — `riskFlagCatalog.ts`, the handbook,
> `risk-flags.json`, the `npm run gen:risk` generator, its drift gate and the
> `/procurement/methodology` page all land together. Until they do, the authoritative
> definitions are the implementation files in the "The implementation" row, and the plan
> describes what is being extracted from them.

Once shipped, the handbook and `risk-flags.json` will be **generated** — `npm run gen:risk` —
so the published spec cannot drift from the code that computes the flags, with a vitest gate
failing the build if it does. Neither the script nor the gate exists yet.

### Citing it

The catalogue carries a semantic version, bumped on any flag addition, rename, reweight or
threshold change, with a per-version changelog beside it. Cite the version, not the date:

> Наясно / electionsbg.com, *Bulgarian procurement red-flag catalogue*, flag set vX.Y.Z.
> https://electionsbg.com/procurement/methodology

(That URL is not live yet — it ships with the page named in the Status note above. Until then
cite this file and the repository.)

⚠️ **Cite the version the MASKS were computed under, not the one in the bundle.** The served
flags come from `contract_risk_cache`, rebuilt on its own schedule; the page and the JSON
report the version stamped into `contract_risk_meta` at that rebuild, together with its
timestamp. If a surface reports "not stamped", the database predates version stamping and the
flags it served cannot be attributed to a catalogue version at all.

### What a flag is not

A fired flag is not an accusation. See [LICENSE](LICENSE) §3 and the handbook's opening
section — the framing is load-bearing and travels with any reuse.

---

The rows below are **pages on the live site**, not files in this repository — prefix each with
`https://electionsbg.com` (or `/en` for English).

## Elections

| Method | Where |
|---|---|
| Section-level risk analysis | [electionsbg.com/risk-analysis/methodology](https://electionsbg.com/risk-analysis/methodology) |
| Risk score composition | [electionsbg.com/risk-score/methodology](https://electionsbg.com/risk-score/methodology) |
| Benford's-law digit tests | [electionsbg.com/benford/methodology](https://electionsbg.com/benford/methodology) |
| Vote-transfer estimation | [electionsbg.com/where-did-votes-go/methodology](https://electionsbg.com/where-did-votes-go/methodology) |

## Public money

| Method | Where |
|---|---|
| State budget — sources, processing, scope | [electionsbg.com/budget/methodology](https://electionsbg.com/budget/methodology) |
| Sector unit costs | [electionsbg.com/governance/sectors/methodology](https://electionsbg.com/governance/sectors/methodology) |

## Data provenance

Every dataset, its upstream source, its refresh cadence and its reuse terms are listed in the
"Data sources" section of [README.md](README.md), and mapped visually at
[electionsbg.com/data](https://electionsbg.com/data).
