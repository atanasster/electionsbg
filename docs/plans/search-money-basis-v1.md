# Search money vs company-page money — one number, two windows

Status: PLAN · 2026-09-02 · measured against local Postgres (`electionsbg`, contracts
410,144 rows / `contractor_search` 45,842 pairs on 29,689 EIKs).

Reported: the home search box shows „Клет България" (EIK 130878827) at **€22,4 млн.**;
`/company/130878827` shows **€4 млн.** under „Общо възложени" on both „Този парламент"
and „2026", and €22.4M appears nowhere on the page. A second, near-identical row
„Клет българия" ООД (EIK **103795327**) sits under it at €2,2 млн.

Two independent defects. §1–§4 are the missing €22.4M; §5 is the duplicate row, which is
a different and sharper problem.

---

## 1. What each number is — both are arithmetically correct

Measured on 130878827:

| figure | where | SQL basis | value |
| ------ | ----- | --------- | ----- |
| €22,424,885 | search dropdown | `search_contractors()` → `sum(amount_eur) WHERE contractor_eik = eik AND tag='contract'` — **no date bound** | all-time |
| €3,969,914 | company page, default scope | `company_procurement(eik, '2026-04-19', NULL)` | this parliament |
| €4,004,441 | company page, `?pscope=y:2026` | `company_procurement(eik, '2026-01-01','2026-12-31')` | calendar 2026 |

```
company_procurement('130878827', NULL, NULL)         → 22 424 885.34 / 1 860 contracts
company_procurement('130878827','2026-04-19', NULL)  →  3 969 914.24 /   291 contracts
```

So **the search figure IS on the page — at `/company/130878827?pscope=all`** — and
nothing anywhere links there or says so. `search_contractors` has no scope by
construction (the search box is global and has no `?pscope`), while the destination
defaults to `ns`.

**This is not an edge case, it is the normal case.** Corpus-wide, only **3.8 % of all
contract money** falls inside the current default `ns` window (2026-04-19 →), and only
**3,647 of 29,667 contractors (12.3 %)** have any contract in it at all. So for
**87.7 % of contractors** the search advertises a euro figure and the destination page
renders

```
Няма договори за избрания период.
```

with no all-time figure and no way back — `CompanyDbScreen.tsx:1564`. The awarder side
is worse in magnitude: МБАЛ „Княгиня Клементина" (000689061) is €62.6M all-time against
**€685,098** in the default window — a 91× gap.

### 1a. The repo has already diagnosed this — for the *see-all* link only

`src/screens/home/homeSearch.ts:314` builds the „Виж всички фирми" link as

```
/procurement/contractors?q=…&pscope=all
```

> ⚠️ `pscope=all`: the table defaults to the selected parliament's window, so a company
> whose contracts predate it would land on zero rows.

and `ProcurementSearchTile.tsx:125-142` says the same („'See all' must mean all-time")
for its own see-all. **The row links directly above those see-alls do not.** They are
plain `react-router` `<Link to={"/company/" + eik}>` (`EntitySearchTile.tsx:11`), so they
navigate with an empty search string — dropping any inherited `pscope` and landing on
the `ns` default every time.

That inconsistency — the group's footer knows the destination is narrow, the group's rows
do not — is the whole bug.

## 2. The page contains the all-time total already, twice, and renders neither

`/api/db/company` returns both:

- `summary.contracts_eur` — `db_routes.js:1149`, `sum(amount_eur) FILTER (tag='contract')`,
  unscoped = **22,424,885**. Used only as a denominator inside `CabinetTimelineTile`
  (`CompanyDbScreen.tsx:1750`); never displayed.
- `supplierRiskGrade.totalEur` — `supplier_risk_grade()` (041) = **22,424,885**,
  `contractCount` = **1,860**. `EntityRiskGradeCard` renders the count and drops the euro.

So the risk card at the top of the page prints **„по 1860 договора"** — an all-time count,
unlabelled — directly above a KPI band reading **„Договори 291"**. Two counts of the same
thing, 6× apart, on one screen, neither naming its window. A reader who notices this
concludes the page is broken; they are only half wrong.

The **awarder** side already has the right pattern and a deliberate all-time probe
(`db_routes.js`, „DELIBERATELY UNSCOPED: is this an awarder at all, in any period?"),
rendered at `CompanyDbScreen.tsx:1434` as

> За всички периоди: **2 772** договора на стойност **€62,6 млн.** · [Виж всички периоди]

…but **only when the window is empty**. A window that is merely a 1 % slice gets nothing.
The contractor side has no such probe and no such line at all.

## 3. `amountEur` is one slot with eight different bases

`SearchItem.amountEur` (`src/ux/search/EntitySearchTile.tsx:207`) renders a bare
`formatEurCompact` with no label, no unit, no window, no `title`. Its producers:

| group | what the number is |
| ----- | ------------------ |
| Институции / Фирми | **all-time** procurement total for the EIK |
| Договори по ЗОП | that one contract's value |
| Процедури по ЗОП | that one procedure's **estimate** |
| Проекти по еврофондове | that one ИСУН project's total |
| Interreg | the **Bulgarian partners'** share |
| Публични лица | `public_money_eur` (the broad contracts ∪ subsidies ∪ funds basis) |
| Продукти | `current_min_eur` — a shelf **price** |

Per-row groups are self-evident from context. The three aggregate ones are not, and the
first two are the ones the reader is about to click.

---

## Tier 1 — make the clicked number reachable (fixes the report)

**T1.1 — entity rows carry `pscope=all`, exactly as their own see-all already does.**
In `procurementSearchSource.ts` (`fetchProcurementAwarders`, `fetchProcurementCompanies`)
and the duplicate mappers in `ProcurementSearchTile.tsx:155-180`, build
`/company/:eik?pscope=all` and `/awarder/:eik?pscope=all`.

Justification is the existing one, one link up: the figure on the row is all-time, so the
destination must be. Blast radius is the same as the see-all's — `pscope` is in
`usePreserveParams`' allowlist (`src/ux/usePreserveParams.tsx:20`), so the scope then rides
onward on `@/ux/Link` navigation. That is already true of every see-all in the box today.

⚠️ Do **not** instead scope the search figure to `?pscope`. The box is global, has no
scope of its own, and a scoped search value would change the same company's number
depending on which page the reader searched from.

**T1.2 — contractor-side all-time reference line.** Mirror the awarder block
(`CompanyDbScreen.tsx:1421-1462`) on the contractor side, and widen the condition from
„empty window" to „scope ≠ all and the all-time total differs":

- rendered under „Общо възложени" when `rollup.contractCount > 0`;
- replacing the bare „Няма договори за избрания период." when it is 0.

Copy: „За всички периоди: €22,4 млн. · **Виж всички периоди**", the button calling
`setScope("all")`. Read the euro from `summary.contracts_eur` (unscoped, tag-filtered).

⚠️ Do **not** take the count from `summary.contracts` in the same sentence — that column
is `count(*)` over **all tags** (1,864 here) while `contracts_eur` filters `tag='contract'`
(1,860). Either publish money only, or add a tag-filtered count to the route rather than
mixing the two bases in one line. `summary.contracts` also gates `hasProcurement`, so do
not re-define it in place.

**T1.3 — same line on the awarder side**, from the `awarderAllTime` probe that is already
fetched, on the non-empty branch too.

## Tier 2 — name the basis

**T2.1 — `SearchGroup` gains an optional `basisNote`**, rendered once in the group header
(not per row — every row in a group shares the basis). „общо по договори, всички години"
/ "total contract value, all years" for Институции and Фирми; „оценка" for Процедури;
„цена" for Продукти. Per-group rather than per-row keeps it one string per group and
covers all eight producers.

**T2.2 — `EntityRiskGradeCard` names its window**: „по 1860 договора · всички периоди".
The card is all-time by design (`CompanyDbScreen.tsx:1017-1021` says so in a comment
nobody reading the page can see). Optionally render its `totalEur`, which is already in
the payload and equals the search figure exactly.

**T2.3 — the „Обществени поръчки" KPI band names its scope** in the section subhead, so
„Общо възложени €4 млн." cannot be read as all-time.

## Tier 3 — gates

- Component test: a company with all-time money and zero rows in the selected window
  renders the all-time line **and** the „Виж всички периоди" action — not the bare
  „Няма договори за избрания период.".
- `homeSearch` / `procurementSearchSource` tests: every entity-row `to` carries
  `pscope=all`. Assert it on the ROW, since the see-all already has it and a test that
  only checks the group footer passes on today's broken code.
- Data test (`scripts/db/tests/`): for a sampled contractor,
  `search_contractors(name).contracts_eur` equals
  `(company_procurement(eik, NULL, NULL)).totalEur` — pinning that the search basis is
  all-time, so a future scoping of either side fails loudly instead of re-opening this.

---

## 5. The duplicate „Клет България" — a different and sharper defect

The two rows are **not** two spellings of one company:

```
130878827  КЛЕТ БЪЛГАРИЯ    (tr_companies, София)   1 860 contracts   €22 424 885
103795327  БИТ И ТЕХНИКА    (tr_companies, Варна)   1 101 contracts   € 2 214 873
```

EIK 103795327 **is БИТ И ТЕХНИКА**. It carries exactly **one** contract row
(€6,036, 2021-04-26) whose `contractor_name` was filed as „Клет българия" ООД — a buyer
typed one company's name against another company's ЕИК.

`search_contractors` then takes the **name from a row** and the **money from the EIK**:

```sql
SELECT s.eik, s.name,
       (SELECT sum(k.amount_eur) FROM contracts k
         WHERE k.contractor_eik = s.eik AND k.tag='contract')   -- per EIK
FROM contractor_search s ...                                     -- per (eik, name)
```

So the dropdown publishes **БИТ И ТЕХНИКА's entire €2.2M under Клет България's name**,
of which €6,036 (0.27 %, 1 of 1,101 rows) actually carries that name. That is a false
claim about a named company, not a cosmetic duplicate — and clicking it lands on
`/company/103795327`, a page headed БИТ И ТЕХНИКА.

### Measured scope

Over all `contractor_search` pairs, own-name money share vs the EIK's total:

- **2,886** pairs carry <1 % of their EIK's money; 5,061 carry <5 %.
- Of those, **109** are pairs whose name is *another EIK's dominant name*:
  - **20 cross-company** (the Клет class — a different firm's name on this EIK).
    Worst-money example: „ГБС - Пловдив АД" filed on **130131711**, which TR names
    **ГБС - ИНФРАСТРУКТУРНО СТРОИТЕЛСТВО** (€500M) — ГБС - Пловдив is 115345761.
  - **89 same-name-different-EIK**, i.e. a **single-digit ЕИК typo**:
    203283626↔**203283623** (Фьоникс Фарма, €1.13bn), 831609043↔**831609046**
    (Топлофикация София), 834496285↔**831496285** (Петрол), 121265117↔**121265177**
    (ОЗК), 040306507↔**040336507** (Томбоу).
- **282 folded names sit on more than one EIK** (600 (eik, name) combinations), which is
  what makes the dropdown show apparent duplicates.
- **21** contractor EIKs are absent from `tr_companies`, hold ≤3 contracts, and share a
  folded name with a TR-registered EIK — the tight, high-precision typo signature.
  €1,568,318 behind them.

⚠️ **Most low-share aliases are legitimate and must not be touched.** ЧЕЗ Трейд
България → Електрохолд Трейд and Медекс's „/Старо наименование/" variants are genuine
renames on the *same* EIK: finding a company by its former name and landing on its
current page is the feature, not the bug. A similarity-based filter alone captures 362
pairs, most of them these. The discriminating signal is „this name is the **dominant**
name of a **different** EIK", not „this name is unlike the dominant one".

### Tier 4 — proposed fix (needs a decision on 4.3)

**T4.1 — the row's money must match the row's name.** Return the per-`(eik, name)`
figure beside the per-EIK one and render the pair honestly, or suppress the money on a
minority alias. Minimum viable: `search_contractors` also returns `own_name_eur`, and
`fetchProcurementCompanies` drops `amountEur` when `own_name_eur < 0.05 * contracts_eur`.
Under-labelling a rare spelling is a far smaller harm than attributing €2.2M to the wrong
firm.

**T4.2 — fold the spelling variants, keep the distinct EIKs.** `dedupByEik` already keeps
one row per EIK; add a second fold on the *display* name so the two rows read
„Клет България · 130878827" and „БИТ И ТЕХНИКА · 103795327" — i.e. show each EIK under its
**dominant** corpus name (or its `tr_companies` name), never under a one-row minority
alias. This alone removes the reported duplicate and is the cheapest correct fix.

**T4.3 — DECISION NEEDED: do we correct the source rows?** Two options, and this is the
user's call, not mine:

- **(a) Display-only** (T4.1 + T4.2). The mis-keyed contract stays on БИТ И ТЕХНИКА's
  page. Nothing in the corpus moves; no re-key, no `/contract/:key` churn.
- **(b) Curated re-key overrides** — a `data/procurement/contractor_eik_overrides.json`
  in the shape of `awarderNameOverrides.ts` / `amount_overrides.ts`, applied at ingest.
  ⚠️ This **moves `/contract/:key` URLs**: the key is
  `hash(releaseId::contractId::contractorEik::tag)`, so re-keying a supplier changes the
  contract's identity — see CLAUDE.md, „Supplier identity". It also requires the
  `db:load:annexes:pg` re-resolve afterwards. Small blast radius here (109 pairs) but it
  is a corpus edit against what the buyer actually filed, and the register's own record
  is arguably the thing to publish.

Recommendation: **(a) now**, and open (b) separately with the 21 high-confidence typo
EIKs only (absent from TR, ≤3 contracts, folded name identical to a TR-registered EIK),
where „the buyer mistyped one digit" is not a judgement call.

**T4.4 — gate.** A data test asserting no `contractor_search` row is served with a money
figure whose own-name share is under the floor, with the Клет pair (130878827 /
103795327) as a named fixture, plus a mutation check — the assertion must fail when the
share filter is removed.
