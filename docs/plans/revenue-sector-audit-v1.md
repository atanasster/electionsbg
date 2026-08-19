# Revenue (НАП) sector audit — v1

Audit of `/governance/sectors` tile `revenue` + the `/sector/revenue` dashboard
(NapPack on `/awarder/131063188`), run 2026-08-19 via `/audit-sectors`.

## What reconciled (no action)

- **Headline.** `sector_stats.json[*].revenue` = `data/budget/agencies/nap.json`
  `expenditure.amountEur` exactly, at all 30 scopes: 2023 €184,619,829 / 2024
  €221,790,391 / 2025 €259,458,116, `basis:'budget'`, `note:'adjusted'`,
  `unavailable` correctly set on y:2011–2022 and y:2026.
- **EIK-set.** НАП is ONE legal person in the corpus (2,532 contracts,
  €192.4M all-time). No territorial directorate (ТД на НАП, ГДО) holds its own
  awarder EIK, so nothing is missing. The `%НАП%` sweep returns only substring
  noise — Напоителни системи (€212.7M), НЧ „Напредък", Направление „Социални
  услуги", НАПОО — all correctly excluded. Three copies (SECTOR_DASHBOARDS,
  SECTOR_BROWSE_PACKS, SECTOR_PACKS) all import `NAP_EIK`; the generator has no
  `SECTOR_EIKS.revenue` because the basis is budget, which is correct.
- **Beneficiaries.** Top contractor Информационно обслужване АД at 11.3% — a
  spread leaderboard, no single-row story. 0 self-deals, 0 NULL EIKs, 0 NULL
  amounts, 31 consortium rows. Largest single-bid awards are in-house / Чл. 79,
  ал. 1, т. 3, б. „в" exclusive-rights, not competition failures.
- **TAX_GAP.** Internally consistent to 0.05%: 8.6% of VTTL with a €781M gap
  implies €8.300bn collected; КФП 2023 ДДС is €8.296bn.
- **VAT-by-sector (2024).** Σ(sectors) = €5,979,200,643 vs the file's
  `declaredNetEur` €5,979,200,646 — €3 of rounding. Σ(share) = 1.0000.

## Findings

### F1 — `TAX_REVENUE_GROUP` admits НЕданъчни приходи (real bug)

`TAX_REVENUE_GROUP = /данъчни приходи/i` (`src/lib/napReferenceData.ts`)
**substring-matches „Неданъчни приходи"**. The КФП revenue section carries
exactly two group labels and the filter admits both, so five NON-TAX lines enter
`buildComposition` — приходи и доходи от собственост, превишение на приходите на
БНБ, приходи от такси, глоби/санкции/лихви, други неданъчни приходи. None
matches a `TAX_TYPES` regex, so all of them land in the bucket rendered as
**„Други данъци" / "Other taxes"**.

Measured, every year in `kfp.json`:

| year | headline shown | true tax | overstated | „Други данъци" shown | true | non-tax share of that bucket |
|---|---|---|---|---|---|---|
| 2026 (H1) | €12.76bn | €11.43bn | +11.7% | €1.48bn | €0.150bn | 90% |
| 2025 | €26.13bn | €22.77bn | +14.7% | €3.59bn | €0.234bn | 93% |
| 2024 | €22.23bn | €19.72bn | +12.7% | €2.72bn | €0.207bn | 92% |
| 2023 | €20.34bn | €17.56bn | +15.8% | €3.06bn | €0.284bn | 91% |
| 2022 | €17.87bn | €16.20bn | +10.3% | €1.86bn | €0.191bn | 90% |
| 2021 | €15.58bn | €13.98bn | +11.5% | €1.72bn | €0.122bn | 93% |

So the residual segment is **15× too large and 93% not a tax**, on a card whose
own caption says „данъчни приходи · без осигуровки". Verified live at
`/sector/revenue`.

This is the SAME substring trap the file already documents one constant above
(the `-та` definite-article note on the ДДС bucket) — caught in one place, missed
in the other.

**Fix:** anchor to `/^\s*данъчни приходи\s*$/i`. Verified: matches „Данъчни
приходи" and not „Неданъчни приходи", and reproduces the `true` column above at
all six years.

### F2 — a third of the card is Митници's collection (decided: re-caption)

Of the 2025 card's €26.13bn, **€7.42bn (28.4%) is collected by Агенция
„Митници", not НАП**:

| line | on the НАП card | Митници's own file |
|---|---|---|
| Акцизи | €3.796bn | `excise_total` €3.796bn |
| Мита и митнически такси | €0.204bn | `customs_duties_total` €0.204bn |
| (inside ДДС €11.029bn) | — | `import_vat_total` €3.418bn |

The first two match **to the euro**, and that same €7.428bn `total_collected` is
the ENTIRE headline of the `/sector/customs` pack — so two sector pages claim the
same money while the НАП card is headed „Данъчни приходи **(НАП)**". The caption
already excludes the НОИ/НЗОК contributions НАП collects, so one collector
boundary was drawn deliberately and this one was not.

**Decided 2026-08-19 (operator): RE-CAPTION, keep all the money.** Excluding the
lines was rejected because it is only partly implementable — the КФП ДДС line is
a single number, so the €3.418bn import-VAT component cannot be separated from it
except by joining `revenue_breakdown/customs/*.json`, which exists for 2022-2025
only; pre-2022 years would stay overstated with nothing marking it. Marking the
segments inside the bar was rejected as a heavier change to
`RevenueCompositionBar`, which the customs pack shares.

### F3 — no coverage, and a caption typo

Nothing tests `buildComposition`, `TAX_REVENUE_GROUP` or the revenue headline —
`revenue` appears nowhere in `sector_stats.data.test.ts`. Separately, the BG
source line renders „…, 2025 г.**..** Осигуровките" (the template appends `г.`
and the sentence continues with `.`).

## Plan

### Step 1 — anchor the tax-group filter (F1)

`src/lib/napReferenceData.ts`: change `TAX_REVENUE_GROUP` to
`/^\s*данъчни приходи\s*$/i` and replace its comment with one naming the
„Неданъчни приходи" substring trap and the size of what it admitted, so the
anchor cannot be "simplified" back. Nothing else changes — `buildComposition`
already uses the constant.

### Step 2 — re-caption the composition card (F2, F3 typo)

`src/screens/components/procurement/nap/NapPack.tsx`:

- Band-1 heading „Данъчни приходи (НАП)" → „Данъчни приходи" /
  "Tax revenue" with the sub-line naming the basis as the консолидирана фискална
  програма, dropping the (НАП) collection claim.
- Extend the existing source footnote with the Митници sentence + a `<Link>` to
  `/sector/customs`, next to the existing НОИ/НЗОК exclusion sentence — the two
  belong together, both being "who actually collects this".
- Fix the `г..` double period.
- Update the file header comment (it currently describes band 1 as НАП's).

Keep the inline `bg ? … : …` convention this pack uses — it takes no i18n keys,
so `scripts/i18n/key_usage.test.ts` is unaffected.

### Step 3 — regression net (F3)

Two files, following the `sector_stats_social` / `_environment` convention:

1. `src/data/procurement/useNap.test.ts` — a pure unit test over
   `buildComposition` with a synthetic КФП snapshot carrying BOTH group labels.
   Asserts the non-tax lines are excluded, the „other" bucket holds only real
   residual taxes, and — as a MUTATION check — that the same fixture folded
   through the OLD unanchored regex produces a different (larger) total, so the
   assertion cannot be satisfied by an implementation that dropped the filter
   entirely.
2. `scripts/db/tests/sector_stats_revenue.data.test.ts` —
   - BASIS: `basis === 'budget'`, `note === 'adjusted'`, and an EXACT reconcile
     against `agencies/nap.json` on value + year + `unavailable` across all 30
     scopes (a €-band on one scope misses a wrong year — the environment
     precedent).
   - EIK-SET: lockstep across the three copies, `NAP_EIK` is a real awarder with
     € above a floor, and an ANTI-allowlist pinning that the МФ ЦЗФД directorate
     (`000695406`, €897.9M) and Напоителни системи (`831160078`, €212.7M) are
     NOT members — the two bodies a name sweep would have pulled in.
   - COMPOSITION: over the REAL `kfp.json`, every year's picked leaves carry
     `groupLabelBg === 'Данъчни приходи'` exactly, and the non-tax lines are
     absent. This is the gate that actually holds F1 on live data.
   - BENEFICIARY: top contractor SHARE ceiling (currently 11.3%; assert < 40%),
     never a rank or an absolute €.

### Not doing

- No change to `sector_stats.json` — F1/F2 are both in the PACK, not the
  generator, and the headline is budget-basis. **No regeneration needed**, so
  nothing to bucket-sync.
- No change to the EIK set, the registry, or the basis.
- Не excluding Митници's lines (see F2).
