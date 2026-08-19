# Consortium visibility across sector pages — v1

Follow-on from `sector-administration-audit-v1.md` (re-audit T6/T7). That step shipped
a consortium note on `SectorTopContractorsTile` gated on the `obed-` key prefix, and
its own review found the gate under-covers. This plan closes it properly.

Decided 2026-08-19 with the user: **A and B in one pass**, with the row-level
attribution carried through `ProcurementContract`.

## Status

| tier / step                                                                  | state   |
| ---------------------------------------------------------------------------- | ------- |
| T1 · 061 projects the consortium € into `sup`                                | ⏳ open |
| T2 · `AwarderSupplier.consortiumEur` from BOTH producers + member-row parity | ⏳ open |
| T3 · both tiles read the share                                               | ⏳ open |
| T4 · tests                                                                   | ⏳ open |

## What is wrong

**Gap A — `obed-` is not „every consortium".** A consortium reaches the corpus in two
forms: a synthetic `obed-` carrier (no legal identity) and a REGISTERED ДЗЗД holding
its own 9-digit EIK, indistinguishable from an ordinary company by key alone.
Corpus-wide, `tag='contract'` (measured 2026-08-19):

| `consortium_role` | `obed-` rows | other rows | `obed-` €      | other €            |
| ----------------- | ------------ | ---------- | -------------- | ------------------ |
| `carrier`         | 2,670        | **1,344**  | €6,213,224,953 | **€5,629,956,314** |
| `member`          | 0            | 11,331     | —              | **€0**             |

So the shipped note misses **47.5% of all consortium money**. On `/sector/administration`
the missed row is Консорциум СисТел ДЗЗД at €31.5M — the group's #2 contractor.

**Gap B — `VikContractorHhiTile`** renders the same `AwarderModel.suppliers` rows and
carries no consortium note at all.

## ⚠ The finding that decides the DESIGN — a boolean would be false

The obvious fix (project `consortium_role`, chip the row) is wrong, and the measurement
is what shows it. Grouping every contractor by the roles its rows carry:

| supplier kind                     | n       |
| --------------------------------- | ------- |
| solo only                         | 27,247  |
| carrier only                      | 2,206   |
| **MIXED — carrier AND solo rows** | **162** |

The 162 hold **€1,518,403,969 on carrier rows and €988,860,870 on solo rows**, and
**every one of them is a real EIK — zero `obed-` keys** (the synthetic namespace is
carrier-only by construction, since a key is minted per consortium). Examples:

| supplier                        | as carrier   | solo        |
| ------------------------------- | ------------ | ----------- |
| ДЗЗД ХЕМУС-16320                | €448,160,168 | €61,245,098 |
| Консорциум капш трафик солюшънс | €125,408,960 | €76,692,248 |
| Дружество по ЗЗД „2021"         | €119,712,388 | €22,219,052 |

So the population the current predicate misses is EXACTLY the population for which
„is this a consortium?" has no single answer. `bool_or` labels ХЕМУС's own €61.2M of
solo work as consortium work; `bool_and` strips the label from a €448M consortium
leader. Either way the page publishes a false statement about a named company.

**Therefore the projection is a € SHARE, never a flag.** `consortiumEur` beside
`totalEur` lets a tile say what is true of a mixed supplier, and makes the note
self-documenting instead of asking the reader to parse „Обединение:" out of a name.

## ⚠ A pre-existing parity defect this work must fix

`061`'s `sup` CTE excludes `consortium_role = 'member'`; the client-side
`buildAwarderModel` does not — `isSpendRow` filters on `tag` alone. So the two
producers of the SAME type disagree about who the suppliers are.

Measured: 11,331 member rows over 3,215 distinct keys, of which **1,164 keys appear
ONLY as members**. On the client-fold path those are phantom suppliers — €0 entries
counted in `supplierCount` and listed in `suppliers`. (HHI is unaffected: the shares
are €0. The COUNTS are not.)

This is why the parity test in T4 is the real gate rather than a formality.

## Tier 1 — 061 projects the consortium €

`sup` already reads `consortium_role` in `base`. Add, inside the same aggregate:

```sql
ROUND(SUM(amount_eur) FILTER (WHERE consortium_role = 'carrier'))::double precision
  AS "consortiumEur",
```

Nothing else in 061 changes. It is `CREATE OR REPLACE` on a function, so no matview
is dropped and no page blanks while it applies.

## Tier 2 — `consortiumEur` on the model, from both producers

1. `AwarderSupplier.consortiumEur?: number | null` in `src/lib/awarderModel.ts`.
2. `buildAwarderModelFromAggregates` maps the SQL field — and maps an ABSENT field to
   **`null`, never `0`**. A database predating T1 cannot know, and „unknown" must not
   render as „this supplier won nothing in consortium". Same rule as `appealUpheld`.
3. `buildAwarderModel` (client fold) accumulates it from
   `row.consortiumRole === 'carrier'`. The field is already on `ProcurementContract`
   and already served (`functions/db_routes.js` CONTRACT_COLS, and `consortium_role`
   is a declared `db_table.js` column) — **no payload widening is needed.**
4. **Parity fix**: exclude `consortiumRole === 'member'` from the client fold's
   SUPPLIER accumulator only — mirroring 061, which keeps member rows in `base` (so
   row and money counts still match) and drops them from `sup`. Do NOT change
   `isSpendRow`: it is shared with money paths, and 061 does not filter there either.

## Tier 3 — both tiles read the share

`SectorTopContractorsTile` and `VikContractorHhiTile`:

- detect a consortium row as `consortiumEur != null && consortiumEur > 0`, **falling
  back to `isConsortiumCarrierKey(eik)` when `consortiumEur` is `null`**;
- keep the visible-rows gate (`rows.some(...)`, top-8) both tiles' siblings already use;
- keep LABELLING and never filtering — the row stays in the list and in every total.

⚠ **The fallback is load-bearing during the deploy window, not defensive padding.**
The bundle can reach readers before 061 is re-applied to Cloud SQL; without it the
note silently disappears for every sector in between.

⚠ **Do not delete `isConsortiumCarrierKey`.** It stops being the primary signal and
becomes the degrade path, and its header's `ph-`/`np-` warning is still the reason it
is not `!isLinkableCompanyKey`.

## Tier 4 — tests

- **The parity gate** (data test): for a fixed EIK set and window, build the model via
  `awarder_group_model` and via the row path, and assert the supplier SETS and
  `supplierCount` agree. This is what catches the member-row divergence, and it fails
  today.
- 061 returns `consortiumEur`, and Σ over suppliers equals the group's
  `consortium_role='carrier'` sum for the same window.
- A MIXED supplier keeps BOTH figures distinct (`consortiumEur < totalEur`) — pinned by
  EIK on one of the three named above, so a `bool_or`-style regression fails.
- `consortiumEur: null` (absent field) renders NO claim — the tile falls back to the
  key prefix rather than reporting „none".
- The registered-ДЗЗД blind-spot arm in
  `sector_stats_administration.data.test.ts` flips meaning: it currently asserts the
  gap is small; once T3 lands the note covers those rows, so it becomes a
  „the note now reaches them" assertion instead. Update it in the same step.
- `VikContractorHhiTile` gets the both-directions note test its sibling has.

## Deploy

Engine change, so hosting alone is not enough:

```bash
DATABASE_URL=<cloud> npx tsx scripts/db/apply_functions.ts 061_awarder_group_model.sql
npm run deploy:db
npm run deploy
```

061 is `CREATE OR REPLACE` on a function — no matview drop, no page blanks. The T3
fallback means an out-of-order deploy degrades to the current behaviour rather than
breaking.
