# СЕБРА payments — located (v1)

Status: **located, not built** (deferred-followups-verification-fixes-v1, T4.11). Measured
2026-10-21.

## The plan's assumption was wrong in the useful direction

The plan said: locate the minfin.bg СЕБРА page, which sits behind Cloudflare, so the files would
be an operator download. minfin.bg does still serve an interactive Turnstile challenge to
automated clients (and the Wayback Machine has only captured that 403 page since 2026), but **both
СЕБРА feeds are also on data.egov.bg, reachable through its API with no challenge**:

| dataset (data.egov.bg)                                                                                                     | what it is                                                                            | resources                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `01293990-7330-49c6-92a2-cc73db73ec24` „Плащания в СЕБРА и други плащания в БНБ"                                           | the **national daily** report (Наредба чл. 2): one file per working day               | 2,809 upload entries = 2,797 distinct dates, 2015-05-22 … 2026-10-20 (posted the next working day); names drift (`СЕБРА-`, `СЕБРA-` with a Latin A, one malformed `-08-017`), duplicate uploads exist, one entry („Плащания") is not a day |
| `57f1e2e7-b235-45e8-94c4-4d69f0b1a690` „Списък с извършените за съответното календарно тримесечие индивидуални плащания …" | the **quarterly list of individual payments** (Наредба чл. 12, from ПМС 76/2024), МЕУ | 13 entries = 11 periods (2 duplicate ZIPs): 01.07.2022–31.12.2023 as one, then every quarter to Q2 2026                                                                                                                                    |
| `6f3d3e61-…` „… за всеки работен ден - Министерство на финансите" (and siblings per body)                                  | one first-level system's own daily file (чл. 4/9) — МФ here                           | 2,440 entries from 2016-11-30, with repeats                                                                                                                                                                                                |

The wider catalogue is thin: a keyword search returns 437 СЕБРА datasets from 15 publishers, 406
of them last touched in 2018. Under чл. 9 each body publishes its daily file on its own site, so their absence here is expected;
only the national two above are complete series.

## Legal basis

Наредба за определяне на реда, начина, сроковете и обхвата на подлежащата на публикуване
информация от СЕБРА (ПМС 299/2016), as amended by **ПМС 76 of 2 April 2024** (ДВ бр. 30/2024):

- чл. 2–3, 10: МФ publishes (deadline: by the end of the next working day, чл. 10) each working
  day's payments in three
  groups — by first-level system (state budget, НОИ, НЗОК, БНТ/БНР/БТА, БАН, state universities,
  Национален фонд, ДФЗ EU accounts …), transfers to municipalities, and other payments (debt
  service, EU contribution, subsidies to enterprises and NGOs) — by payment-type code.
- чл. 12–14 (new): МЕУ publishes **quarterly** every individual payment initiated with a budget
  payment request, codes 10–90, **of 5,000 лв or more** (€2,556.46 at the peg — the threshold is
  in лева, not euro), on the open-data portal, kept 5 years.
  Excluded: security and intelligence services and the anti-corruption commission, НАП and Агенция
  „Митници", foreign-funds systems (with the exceptions in ал. 7), payments into НАП/Митници collection accounts, and anything
  marked classified. Natural persons' names, ЕГН/ЛНЧ and IBANs are anonymised (ал. 8). §4: the
  01.07.2022–31.12.2023 backlog published in one batch.

## What the files contain

**Daily** (`SEBRA-2026-10-20`, 544 rows): a formatted report, not a flat table — a header („ОБЩО
ПЛАЩАНИЯ ЗА ДЕНЯ (в евро)", „Период: 20.10.2026 - 20.10.2026"), section headings („I. ПЛАЩАНИЯ ОТ
БЮДЖЕТА, ИЗВЪРШЕНИ ЧРЕЗ СЕБРА, ПО ПЪРВОСТЕПЕННИ СИСТЕМИ" …), then `code | description | | amount`
lines (`01 xxxx` = salaries net, `02 xxxx` = withheld taxes …) and „Общо:" subtotals. Amounts in
**EUR** in 2026; the 2015–2025 files are presumably in лева and must be read per file, not assumed.
A parser therefore needs section-aware state and a subtotal reconciliation, like the КФП
workbooks.

**Quarterly individual list** (Q2 2026, 122,647 payments + a header row), a flat table:

`SETTLEMENT_DATE, CLIENT_RECEIVER_NAME, CLIENT_RECEIVER_ACC, CLIENT_RECEIVER_BIC, FIN_CODE,
FIN_NAME, AMOUNT, CURRENCY, REASON1, REASON2, REG_DATE, REG_NO, SEBRA_PAY_CODE, ORGANIZATION,
PRIMARY_ORGANIZATION, PRIMARY_ORG_CODE, CLIENT_NAME_HASH`

- `FIN_CODE`/`FIN_NAME` and `ORGANIZATION`/`PRIMARY_ORGANIZATION` are the **payer**; the receiver
  is a name and an account only. ⚠️ **There is no recipient ЕИК column**, although чл. 12, ал. 1
  lists ЕИК/БУЛСТАТ among the published fields. Any join to `tr_companies` or `contracts` is
  therefore by NAME, which this repo treats as a candidate, never an identity (see the person-layer
  rules in CLAUDE.md) — a payment can be shown beside a company only where the name is unique in
  the register, and must say so.
- ⚠️ **Natural persons are not anonymised the way ал. 8 reads.** In Q2 2026, 16,865 rows are
  natural persons. **15,093 (89%) carry a bare 9–10 digit number** in `CLIENT_RECEIVER_ACC` and
  only 964 the `**********` mask. The number is not an IBAN and its nature is unknown; 775 of the
  8,031 ten-digit values pass the ЕГН checksum, about the rate random digits give, so it does not
  look like ЕГН — but that is not proof of what it is. And the NAME is not always the bare phrase:
  223 distinct name strings contain „ФИЗИЧЕСКО ЛИЦЕ", some with a prefix („ЦАНК. ФИЗИЧЕСКО ЛИЦЕ")
  that may be a remnant of the real name (inference). Therefore a loader must:
  - recognise a natural person by the phrase **anywhere** in the name, never by equality;
  - **drop both the name and the account** of such rows at parse time and count them
    (`natural_persons_excluded`), the ИСУН clean-delivery precedent (`cleanEik()` in CLAUDE.md);
  - keep only the payer, amount, date, pay code and reasons for them.
- `CLIENT_NAME_HASH` hashes the published NAME STRING, not a person: company names map one-to-one
  to hashes, while all natural-person rows share 239 hashes and one hash spans 417 different
  payers. It cannot link payments to a person, and for companies it adds nothing the name does not.
- `AMOUNT` is in `CURRENCY` (EUR in 2026); older quarters must be read per row.
- `REASON1`/`REASON2` are free text („АВАНСОВО ПЛАЩАНЕ УСЛУГИ", an invoice number).

## Proposed shape (for a later build)

- `sebra_daily` — (pay_date, section, primary_system, pay_code) → amount_eur, from the daily
  report; reconciled to each file's „Общо:" lines, refusing a file that does not.
- `sebra_payment` — one row per quarterly-list payment: settlement date, payer codes and names,
  pay code, amount + currency + amount_eur, reasons, document reg number/date, `is_natural_person`;
  the receiver name, BIC and account **only** for non-natural-person rows (NULL otherwise — see
  above), plus a per-quarter `natural_persons_excluded` count.
- Optional, separate: a `sebra_payment_company_candidate` link by exact folded name with the same
  people-count refusal Bridge B uses — never a column on the payment.

The quarterly list is the valuable half: it is the only public record of who the state actually
paid, outside procurement, and it covers payments no contract register sees. The daily report is a
macro series (cash execution by code, per day) and would sit with the budget-execution corpus.
