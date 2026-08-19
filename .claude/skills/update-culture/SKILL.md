---
name: update-culture
description: Refresh the Култура (culture) data behind /culture — the НФЦ (Национален филмов център) film-subsidy corpus in data/culture/films.json + overview.json, parsed from the per-year .xls registers of financed films/series at nfc.bg, plus НФК grant success rates, the artistic-commission compositions ("кой решава"), and the Sofia + читалища municipal streams. Also refreshes the МК ДКИ register (data/culture/dki_register.json) — the ministry's own listing of the държавни културни институти it is the principal of, with each institute's director and seat, reconciled against the four-list culture allowlist. Use when the daily watch report flags `nfc_film_register`, `ncf_grant_results`, `nfc_commissions`, or `mc_dki_register` as changed, when the user asks to refresh culture / кино / филмови субсидии / НФЦ / комисии data, or after a fresh git clone if data/culture/*.json is missing.
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

### The МК ДКИ register (`mc_dki_register`)

A SECOND, unrelated source: МК's own three listings of the **държавни културни
институти** it is the principal of — `направление Музика и танц` (opera,
philharmonic, symphonietta), `направление Театър` (drama + puppet) and
`направление Художествено образование` (the art schools). URLs in
`scripts/culture/dki/sources.ts`.

Three things about it decide how it may be used:

- **It carries NO ЕИК.** Every id in the artifact is resolved by NAME against
  `contracts` ∪ `tenders` (`scripts/culture/dki/resolve.ts`), which REFUSES an
  ambiguous name rather than grading a guess — two register names are too
  generic to identify and stay unresolved on purpose.
- **It is not the whole of МК.** ~103 second-level spending units, ~74 of them
  ДКИ; these three pages list 70, and the national museums, galleries and
  library are on no ДКИ page at all. The museums register at
  `/документи/регистри-1/` is deliberately NOT folded in, and the reason is
  sharper than „mostly municipal": its `Форма на собственост` column shows
  `държавен` **spans principals** — of the 17 state-owned museums, 5 of the 10
  that resolve to an EIK are МО or БАН. Folding it in wholesale would import
  those into a culture roll-up. It is a ~17-row hand-classified follow-up, not a
  permanent boundary.
- **It never becomes the allowlist.** `src/lib/kulturaReferenceData.ts` stays
  hand-classified by principal. This is the independent evidence it is checked
  against, and each source sees what the other structurally cannot: the corpus
  sweep is blind to a ДКИ that never ran a ЗОП procedure, and the register is
  blind to everything МК does not list.

mc.government.bg serves an **incomplete certificate chain**, so both the ingest
and the watcher pass `insecureTls` — curl and browsers accept it, Node's CA list
does not. Read-only public pages.

## Run

```bash
npx tsx scripts/culture/ingest.ts          # НФЦ films → films.json + overview.json (start local Postgres FIRST: npm run db:pg:up)
npx tsx scripts/culture/ingest.ts --force  # re-download every year's .xls
npx tsx scripts/culture/ncf_grants.ts      # НФК grant results → grants.json (needs pdftotext)
npx tsx scripts/culture/build_oblast.ts    # state institutes by oblast (needs Postgres)
npx tsx scripts/culture/write_commissions.ts # НФЦ artistic-commission compositions → commissions.json
npx tsx scripts/culture/sofia_program.ts   # Sofia Програма „Култура" + читалища → municipal.json (needs pdftotext)

npm run culture:dki                        # МК ДКИ register → dki_register.json (DRY RUN; needs Postgres)
npm run culture:dki -- --apply             # …and write it
npm run culture:dki -- --apply --offline   # re-parse the cached HTML, no fetch
npx vitest run scripts/culture/dki/        # the parser + reconciliation gates — ALWAYS after --apply

npx tsx scripts/culture/enrich_producers.ts # REPAIR ONLY — re-link top producers → EIK (needs Postgres)
```

**The producer→EIK links are part of the ingest, not a step you can forget.** The НФЦ
register has no EIK, so the `/company/:eik` link on every top-producer row comes from
`scripts/culture/producer_eik.ts`, which resolves a producer name to a company EIK ONLY
where it matches exactly one Commerce-Registry company (unique match); ambiguous names
("Клас", "АРС") and no-matches are left unlinked rather than guessed (plan §6). `ingest.ts`
calls it **before** it writes `overview.json`, so a refresh can never leave the file
EIK-less — which it did on 2026-07-31, when the linking was a separate script and every
producer link went dead with nothing failing.

That linking needs **local Postgres** (`tr_companies`), so bring it up before the ingest:

```bash
npm run db:pg:up
```

Without it the ingest still succeeds (the parse is Postgres-free) but prints a loud
`⚠ producer→EIK linking SKIPPED` and carries the previous `overview.json`'s EIKs forward.
`enrich_producers.ts` is then the repair: start Postgres and run it to re-link in place.
Its other use is after a TR reload, when the company corpus has moved but the films
have not.

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
2. Check the EIK line (`18/25 top producers linked to a unique EIK` — never a
   `⚠ … SKIPPED`) and confirm the link count did not fall. Compare COUNTS, not the
   diff: `topProducers` is sorted by `eur`, so any rank change rewrites those blocks
   and a `grep '^-.*"eik"'` over the diff reports losses that did not happen.
   ```bash
   echo "was $(git show HEAD:data/culture/overview.json | grep -c '"eik"') → now $(grep -c '"eik"' data/culture/overview.json)"
   ```
3. Commit `data/culture/*.json` and `bucket:sync data/culture/`
   (`cp -Z` — GCS serves identity; avoid `gsutil -m` on macOS).
4. Stamp the ingest state:
   ```bash
   npx tsx scripts/stamp-ingest.ts update-culture --summary "НФЦ film register: <N> films, €<X>M, <P> producers, <first>–<last>"
   ```

## Notes

- Recipients are keyed by **producer name** (the register has no EIK) — grouped by a
  normalised `producerFold`. One name may span related companies; never assert a
  person↔company link on a name alone (plan §6).
- The one-off nature of the .xls set means a full re-download is cheap; there is no
  incremental backfill flag beyond `--force`.
