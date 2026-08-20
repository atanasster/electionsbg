# ТР full-database access — what it costs, how to apply, and what it probably is not

**Status: NOT APPLIED FOR as of 2026-08-21.** Nothing below has been purchased or
requested; it is the desk research that decides whether to.

This file exists because `docs/plans/gfo-ingest-spike.md` has cited it since 2026-07-02
— „the paid full-DB export (~100 BGN/yr, incl. act documents — see
docs/tr-full-db-access-request.md)" — and it had never been written. The price in that
citation is right. **The „incl. act documents" half is unverified and the evidence is
against it**, which matters, because that half is the only reason to buy.

Context: `docs/plans/gfo-ocr-engine-v1.md` §11g, §12.16.

---

## 1. The fee, verbatim

**Чл. 16д** от Тарифата за държавните такси, събирани от Агенцията по вписванията
(нов — ДВ бр. 105/2006; изм. ДВ бр. 65/2008; изм. ДВ бр. 106/2014; доп. ДВ бр. 99/2017,
в сила от 01.01.2018):

> „За предоставяне на **цялата база данни от търговския регистър и регистъра на
> юридическите лица с нестопанска цел** и за актуализация на обстоятелствата в нея се
> събира **годишна такса в размер 100 лв.**"

- **100 лв./год. = €51.13** at the locked peg. The tariff PDF still prints лв; Bulgaria
  is on EUR since 2026-01-01, so expect the payable amount in euro.
- **The 2017 amendment is why sources disagree.** Older copies of the tariff quote
  **10,000 лв.** for the same article — a hit you will get from a plain web search. The
  figure in force since 01.01.2018 is 100 лв.
- **For scale, in the same tariff:** БУЛСТАТ's whole national database is **5,000 лв.**
  (чл. 14, plus 0.10 лв. per subject to update) and the Централен регистър на особените
  залози is **2,600 лв./год.** (чл. 16н). The Commerce Register is the cheap one by two
  orders of magnitude — which is itself a hint about what it contains.

**Documents have a SEPARATE line, and it is not a bulk one.** Чл. 16е ал. 3:

> „За **абонамент за автоматизирано подаване на информация** за вписани обстоятелства,
> заличени вписвания и **обявени актове по фирменото дело на определен търговец** или
> юридическо лице с нестопанска цел се събира такса в размер **0,40 лв. за всяко
> вписване, заличаване и обявяване**."

Per company and per event. Also чл. 16е ал. 2: „Минималният предплатен лимит за
използване на услуга по ал. 1 е в размер 100 лв."

---

## 2. ⚠️ What it probably does NOT include

The decision turns entirely on whether „цялата база данни" carries the **files** of
обявени актове — the scanned ГФО PDFs — or only the structured вписани обстоятелства.
No published page says. Three pieces of evidence point the same way:

- **Чл. 16д's own wording is „актуализация на ОБСТОЯТЕЛСТВАТА в нея".** Обстоятелства
  are the structured layer. „Обявени актове" is a different noun, and the article does
  not use it.
- **The acts are priced elsewhere, per company, per event** (чл. 16е ал. 3 above). A
  bulk product that already contained them would not need that line.
- **We already ingest the structured database, free.** `raw_data/tr/daily` is the
  Agency's own export as published on data.egov.bg — 1,666 files, 15 GB, 2021-01-01 →
  2026-08-07. Measured 2026-08-21 over a full daily file (48,704 deeds): **97 distinct
  attribute keys and not one financial field**; the ГФО act node carries exactly nine
  attributes (`RecordIncomingNumber, RecordID, GroupID, ActModeText, ActModeValue,
Description, ActDate, ActYear, ActID`) — an index entry pointing at a document, not the
  document. If „цялата база данни" is this, the 100 лв. buys a paid copy of what we hold.

**So the realistic outcome is that it removes nothing.** Not the OCR — the documents are
scans either way (0 of 16 sampled ГФО had a usable text layer). And not even the fetch,
if the files are not in it.

**The subscription arm is worse than the free crawl.** At 0.40 лв. per обявяване, the
~9,600 ГФО announcements of the top-1,000 tier are **3,840 лв. ≈ €1,963**, against
`/CR/api/Documents/{ActID}`, which is free and measured at 1,772 documents/hour
(`gfo-ocr-engine-v1.md` §11b.1). It is also per-trader, so it presumes a target list we
would have to build anyway.

---

## 3. The question to ask

This is the whole point of writing. Put it in the request; no page answers it:

> Включва ли предоставянето по чл. 16д от Тарифата файловете на обявените актове
> (например годишните финансови отчети), или само вписаните обстоятелства? Ако включва
> актовете — в какъв формат и по какъв ред се предоставят, и за целия исторически период
> ли?

---

## 4. How to apply

There is **no form** — the Agency's own page says „Подаване на искане до Агенция по
вписванията в свободен текст".

1. Send the free-text request (§5) to **registri@registryagency.bg**.
2. The Agency drafts a contract and sends it back.
3. Sign, and transfer the fee within the stated deadline.
4. Access is provisioned — either „автоматизирано подаване на информация, чрез интерфейси
   и стандарти за пренос на информация", or „на технически носител въз основа на сключено
   споразумение".

**Contacts:** +359 2 9486 194 · +359 2 9486 166 · registri@registryagency.bg

**Legal basis for the service** (the служебен-достъп sibling page cites it): чл. 12, ал. 4
от Закона за търговския регистър и Наредбата за реда и начина на осъществяване на достъп
до търговския регистър по служебен път. Note that route is the FREE one and is limited to
държавни органи, органи на местното самоуправление и лица, осъществяващи публични функции
— it is not available here.

---

## 5. Draft request

```
До Агенция по вписванията
registri@registryagency.bg

ОТНОСНО: Искане за предоставяне на цялата база данни от търговския регистър
по чл. 16д от Тарифата за държавните такси, събирани от Агенцията по вписванията

УВАЖАЕМИ ГОСПОЖИ И ГОСПОДА,

Моля да ми бъде предоставен достъп до цялата база данни от търговския регистър
и регистъра на юридическите лица с нестопанска цел, срещу дължимата годишна
държавна такса по чл. 16д от Тарифата.

Данните ще се използват за некомерсиален анализ на публичните разходи и ще се
публикуват в обобщен вид на electionsbg.com.

Моля да уточните:
1. Включва ли предоставянето файловете на обявените актове (в частност годишните
   финансови отчети), или само вписаните обстоятелства.
2. Ако актовете се включват - в какъв формат, по какъв ред и за какъв исторически
   период се предоставят.
3. Начина на предоставяне - автоматизирано подаване чрез интерфейс или на
   технически носител.

Моля да ми изпратите проект на договор.

С уважение,
[име, ЕГН/ЕИК, адрес, телефон, e-mail]
```

---

## 6. Recommendation

**Send it, but as a question rather than a purchase, and do not hold tier 1 for the
answer.** €51 and an email is nothing against the 4.2-day crawl the full tier costs
(`gfo-ocr-engine-v1.md` §11b.1), so it is worth resolving before the FULL tier is
authorised. Tier 1 is 5.4 hours of fetching and should not wait.

**Record the answer here when it arrives** — whichever way it goes, it closes
`gfo-ocr-engine-v1.md` §12.16 and it is the kind of fact that is expensive to re-derive.

| date       | action                    | outcome                                                                                  |
| ---------- | ------------------------- | ---------------------------------------------------------------------------------------- |
| 2026-08-21 | desk research (this file) | fee confirmed at 100 лв./год. (чл. 16д); document inclusion unresolved, evidence against |
|            | request sent              |                                                                                          |
|            | Agency reply              |                                                                                          |

---

## 7. Sources

- [Предоставяне срещу заплащане на цялата база данни на Търговския регистър](https://www.registryagency.bg/bg/registri/targovski-registar/predostavyane-sreshtu-zaplashtane-na-cyalata-baza-danni/)
- [Предоставяне на достъп до базата данни на Търговския регистър за служебни цели](https://www.registryagency.bg/bg/registri/targovski-registar/predostavyane-na-dostap-do-bazata-danni-na-targovskiya-registar/)
- [Тарифа за държавните такси, събирани от Агенцията по вписванията (PDF, 2024)](https://www.registryagency.bg/media/filer_public/2024/05/27/tarifa_za_drzhavnite_taksi_sbirani_ot_agentsiia_po_vpisvaniiata.pdf)
