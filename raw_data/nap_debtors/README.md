# НАП debtors ∩ contract winners — manual lookup checklist

The НАП public debtors register (чл.182 ДОПК) is a **per-EIK search protected by
reCAPTCHA** — it can't be queried in bulk programmatically (and shouldn't be). So
this is the legitimate path: a human checks the biggest contract winners by hand.

## The file
`contractors_top100.csv` — the **top 100 public-contract winners** by total awarded
value (from `contracts_list`, 27,020 distinct contractors; the top 100 ≈ 36% of the
whole €87.1bn corpus). One row per company, pre-filled with:

`rank, contractor_eik, contractor_name, total_awarded_eur, contract_count, first_year, last_year`

and **empty columns for you to fill**:

`is_debtor, debt_amount, debt_currency, checked_on, notes`

## How to fill it in
1. Open the register: <https://portal.nra.bg/embed/enf-app-list/main.html>
   (or via the portal: *Услуги със свободен достъп → Списък на длъжниците…*).
2. Criterion: select **„ЕИК по ЗТРРЮЛНЦ / ЕИК по БУЛСТАТ / Сл. номер на НАП“**.
3. Paste the row's `contractor_eik` into the field, solve the reCAPTCHA, click **Търси**.
4. Record the result:
   - **Found (is a debtor):** `is_debtor = yes`, `debt_amount = <the sum shown>`,
     `debt_currency = BGN` or `EUR` (whatever the portal shows), `checked_on = YYYY-MM-DD`.
   - **Not found:** `is_debtor = no`, `checked_on = YYYY-MM-DD`.
5. Save the CSV (keep it UTF-8).

You don't have to do all 100 — even the **top 20–50** (18–27% of all awarded value)
makes a strong band. Skip a row by leaving `is_debtor` blank.

## What I build from it
Hand the filled CSV back and I'll build the moat, honestly labelled **"as of
`<checked_on>`"**: a `tax_debtors` table + `--backfill` loader from this CSV + the
`contracts_list` join + `/api/db` serving + a НАП/Митници band
("най-големите изпълнители, които дължат на държавата", Top-N → see-all) + the
`taxDebtors` AI tool + changelog + SQL-perf pass.
