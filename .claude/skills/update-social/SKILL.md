---
name: update-social
description: Refresh the social-assistance data behind /sector/social — the АСП benefit-disbursement series (data/social/benefits.json — child allowances, disability support, targeted heating aid, guaranteed minimum income) parsed/verified from the Агенция за социално подпомагане (АСП) годишен отчет за дейността, and the Eurostat poverty-reduction-of-transfers series (data/social/poverty_impact.json — ilc_li10 before vs ilc_li02 after transfers). Both are small static JSON (no Postgres). Use when the daily watch report flags `asp_benefits` as changed (a new АСП annual report landed), when the user asks to refresh social assistance / социално подпомагане / АСП / детски надбавки / помощи за отопление / бедност data, when the Eurostat SILC release updates the poverty series, or after a fresh git clone if data/social/benefits.json or data/social/poverty_impact.json is missing. NOTE: the МТСП budget-by-benefit rides update-budget and the group procurement renders off the live contracts corpus — neither is ingested here. Pensions (НОИ) are update-noi, not this skill.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
  - WebFetch
---

# Update Social (Социално подпомагане) skill

Refreshes the two small static artifacts behind `/sector/social`:

| Artifact | Source | Grain | Generator |
|---|---|---|---|
| `data/social/benefits.json` | АСП годишен отчет за дейността (PDF) | national · annual · per benefit | curated + `scripts/social/fetch_asp_benefits.ts` (verifier) |
| `data/social/poverty_impact.json` | Eurostat EU-SILC (`ilc_li10`/`ilc_li02`) | national · annual · BG+peers | `scripts/social/fetch_poverty_impact.ts` (auto) |

⚠ **Why АСП benefits are curated, not auto-scraped.** АСП publishes benefit statistics only in the annual
report PDFs, and the figures live in year-varying **narrative prose** (not clean tables), so a blind
multi-year regex parser is fragile and could silently mis-extract. The committed `benefits.json` is
therefore a **curated, source-verified** baseline (like the defense mega-programs), and the fetch script is
a **verifier** that re-downloads the latest report, `pdftotext`-extracts three stable anchors (heating
households, child children, disability recipients) and flags drift. There is **no per-oblast data** anywhere
(АСП's РДСП breakdowns are internal/FOI-only) — the tiles are national. See
`docs/plans/social-assistance-view-v1.md` §2.1.

## When to run

| Trigger | Action |
|---|---|
| Watcher: `asp_benefits` describe-line says "нов годишен отчет на АСП…" (a new report landed) | §1 — verify + update `benefits.json` |
| User asks to refresh social-assistance / АСП / benefit data | §1 |
| Fresh clone, `data/social/benefits.json` missing | §1 (restore from git or re-curate from the reports) |
| Eurostat SILC release (the `eurostat` watcher's poverty rows) OR poverty series looks stale | §2 — regenerate `poverty_impact.json` |
| Fresh clone, `data/social/poverty_impact.json` missing | §2 |

## §1. Verify + update the АСП benefits (`benefits.json`)

```bash
npx tsx scripts/social/fetch_asp_benefits.ts            # verify the latest report
npx tsx scripts/social/fetch_asp_benefits.ts --year 2025  # a specific year's report
```

The verifier downloads the newest report from
`asp.government.bg/bg/za-agentsiyata/misiya-i-tseli/otcheti-i-dokladi/`, runs `pdftotext -layout`, and
checks three anchored figures against the curated `data/social/benefits.json`:

- **`✓ …matches curated`** on all three → nothing to do; the curated data is current.
- **`✗ …UPDATE benefits.json`** → the report changed a figure. Open the report PDF, read the affected
  benefit's section, and update the matching `series[]` entry in `data/social/benefits.json` (BGN amounts
  only — EUR is computed at load from `eurRate`; keep `recipients`/`households`, `amountBgn`, and any
  `perHouseholdMonthlyBgn`/`meansTestBgn`). Add a NEW `{year: …}` series point when a fresh year lands; bump
  `latestYear` and add the report URL to `source.reports`. Re-run the verifier until it's clean.
- **`⚠ …not found`** → the prose phrasing changed; confirm the number manually from the PDF and, if you
  want the anchor to keep working, adjust the regex in `fetch_asp_benefits.ts`.

Requires `pdftotext` (poppler) on PATH and Bulgarian-reachable egress.

## §2. Regenerate the poverty-impact series (`poverty_impact.json`)

```bash
npx tsx scripts/social/fetch_poverty_impact.ts
```

Fully automated — fetches Eurostat `ilc_li10` (AROP before transfers, pensions excluded) + `ilc_li02` (AROP
after) for BG + EU27 + RO/GR/HU/HR, pinned to the 60%-median headline (`statinfo=MED_EI`, `rskpovth=B_60`),
and writes the before/after series + the poverty-reduction effect (`pct`). Prints BG vs EU on completion
(e.g. BG −27% vs EU −33%). No manual step.

## Data shape (both static JSON — no Postgres, no changelog)

`benefits.json` → `{ latestYear, eurRate, source, families:[{id, label, law, recipientNoun, unit,
series:[{year|season, recipients|households, amountBgn, …}], note}] }`.
`poverty_impact.json` → `{ latestYear, geos, series:{geo:[{year, before, after}]}, latest:{geo:{…, pp,
pct}} }`.

Both feed `/sector/social` (SocialBenefitsTile, SocialHeatingAidTile, SocialPovertyImpactTile,
SocialValueForMoneyTile) and, once wired, the AI `socialBenefits`/`socialPovertyImpact` tools. They are
static reference JSON (`feedback_no_json_from_pg`) — no `recent_updates` Postgres changelog applies.

## Deploy

The `data/social/` tree serves from the GCS data bucket in production (like `data/cofog.json`). After an
update, push it: `npm run bucket:sync:paths -- social`.
