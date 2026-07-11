---
name: update-culture
description: Refresh the Култура (culture) data behind /culture — the НФЦ (Национален филмов център) film-subsidy corpus in data/culture/films.json + overview.json, parsed from the per-year .xls registers of financed films/series at nfc.bg, plus НФК grant success rates, the artistic-commission compositions ("кой решава"), and the Sofia + читалища municipal streams. Use when the daily watch report flags `nfc_film_register`, `ncf_grant_results`, or `nfc_commissions` as changed, when the user asks to refresh culture / кино / филмови субсидии / НФЦ / комисии data, or after a fresh git clone if data/culture/*.json is missing.
---

# update-culture

Refreshes the culture-spending data served at `/culture` (the dedicated dashboard)
and read by the `cultureOverview` / `topCultureGrantees` / `filmSubsidyForProducer`
AI tools. Phase 1 covers the **НФЦ film-subsidy register**; НФК grants, the pack on
`/awarder/000695160`, and the jury-transparency tile are later phases (see
`docs/plans/kultura-view-v1.md`).

## Source

The НФЦ **Единен публичен регистър** of financed films/series — one `.xls` per year
(2014–2025), all under `nfc.bg/wp-content/uploads/2022/07/…`. Filenames are NOT
uniform across years, so the explicit map lives in `scripts/culture/sources.ts`.
No WAF/login. Amounts are historical BGN → EUR at the fixed rate 1 EUR = 1.95583 BGN.

Two format families the parser handles (see `scripts/culture/ingest.ts`):
- **2022–2025**: `Вид · Наименование · Рег.№ · Продуцент · Субсидия лв · Бюджет лв ·
  Протокол на ФК`, with "Игрално кино:" section rows.
- **2014–2021**: `№ · Филм · Рег.№ · Продуцент · Държавно финансиране лв · Заповед`,
  multi-sheet, discipline embedded in the reg-number / title.

Discipline is classified from the **reg-number letter** (И=игрално, Д=документално,
А=анимационно) — reliable across both families — with a title-prefix fallback.

## Run

```bash
npx tsx scripts/culture/ingest.ts          # НФЦ films → films.json + overview.json
npx tsx scripts/culture/ingest.ts --force  # re-download every year's .xls
npx tsx scripts/culture/ncf_grants.ts      # НФК grant results → grants.json (needs pdftotext)
npx tsx scripts/culture/build_oblast.ts    # state institutes by oblast (needs Postgres)
npx tsx scripts/culture/enrich_producers.ts # link top producers → EIK (needs Postgres; run AFTER ingest.ts)
npx tsx scripts/culture/write_commissions.ts # НФЦ artistic-commission compositions → commissions.json
npx tsx scripts/culture/sofia_program.ts   # Sofia Програма „Култура" + читалища → municipal.json (needs pdftotext)
```

`enrich_producers.ts` resolves the top producers' names to a company EIK — but ONLY
where a name matches exactly one Commerce-Registry company (unique match). Ambiguous
names ("Клас", "АРС") and no-matches are left unlinked rather than guessed (plan §6).
It rewrites `data/culture/overview.json` in place, so run it AFTER `ingest.ts` (which
overwrites overview.json and drops the eik).

The **НФК grants** ingest (`ncf_grants.ts`) parses the класиране PDFs listed in the
curated `NCF_RESULTS` map into `data/culture/grants.json` — the applied-vs-funded
success rate per art discipline. Results URLs are scattered across ncf.bg news posts
(no clean index), so add each new session's PDF URL to `NCF_RESULTS` before running.
Requires `pdftotext` (poppler). The **oblast** build (`build_oblast.ts`) needs Postgres
(`awarder_seats` + `contracts_list`) and is stable (the institute allowlist rarely
changes).

The **commission** compositions (`write_commissions.ts`) are HAND-KEYED from the НФЦ
executive-director appointment order ("Назначаване съставите на НХК…"), which changes
each ~6-month mandate. When the `nfc_commissions` watch flags a new order, download the
newest one from the nfc.bg „Заповеди" page, read it (`pdftotext -layout`), and update the
mandate window + 21 members in the generator. The **municipal** streams (`sofia_program.ts`)
parse the Столична програma „Култура" класиране PDF (dropped at `raw_data/culture/sofia_spk_<year>.pdf`)
and carry the hand-keyed читалища national figures.

Writes `data/culture/films.json` (per-film corpus) and `data/culture/overview.json`
(precomputed dashboard blob: totals, by-year, by-discipline, top producers,
top-10 concentration). The script **self-verifies** (plan §9): it asserts every
year parses > 0 rows and that the flat total reconciles to the per-year sum, and
refuses to write a partial artifact on failure.

## After a successful run

1. Eyeball the printed per-year counts + the Σ line (`~944 films · €94.9M · 324
   producers · top-10 22%` for the 2014–2025 baseline, after de-duping the 5
   identical rows the register ships).
2. Commit `data/culture/*.json` and `bucket:sync data/culture/`
   (`cp -Z` — GCS serves identity; avoid `gsutil -m` on macOS).
3. Stamp the ingest state:
   ```bash
   npx tsx scripts/stamp-ingest.ts update-culture --summary "НФЦ film register: <N> films, €<X>M, <P> producers, <first>–<last>"
   ```

## Notes

- Recipients are keyed by **producer name** (the register has no EIK) — grouped by a
  normalised `producerFold`. One name may span related companies; never assert a
  person↔company link on a name alone (plan §6).
- The one-off nature of the .xls set means a full re-download is cheap; there is no
  incremental backfill flag beyond `--force`.
