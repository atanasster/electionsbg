// Locks two contracts for the pre-2020 РОП tender backfill:
//   1. parseCasesHtml maps the fixed 10-column cases table onto RopCaseRow
//      (column order, УНП row-filter, currency default, EU-funded flag, date).
//   2. buildTenders honours the sourceUrl passthrough — a РОП record cites its
//      aop.bg cases-search page, while a live ЦАИС record (no sourceUrl) falls
//      back to the storage.eop.bg day bucket. This keeps citations correct after
//      the two corpora are merged in the same rebuild.
//
//   npx vitest run scripts/procurement/ingest_rop_tenders.test.ts

import { test } from "vitest";
import assert from "node:assert/strict";
import { parseCasesHtml } from "./normalize_rop_tender";
import { buildTenders } from "./normalize_eop_tender";
import { tendersDayUrl, type EopTenderRecord } from "./eop_tender_types";

// A minimal cases-search page: one layout/header row (skipped — no УНП), two
// data rows. The register wraps the date in a trailing "&nbsp;г." and pads cells
// with &nbsp;, both of which the parser must strip.
const FIXTURE = `<table>
<tr><td>№</td><td>Дата на публикуване</td><td>УНП</td><td>Възложител</td><td>Процедура</td><td>Обект</td><td>Предмет</td><td>Прогнозна стойност</td><td>Валута</td><td>Европейско финансиране</td></tr>
<tr>
  <td>1</td><td>15.05.2018&nbsp;г.&nbsp;</td><td>00754-2018-0001</td>
  <td>Община Борино</td><td>публично състезание</td><td>Строителство</td>
  <td>„Ремонт на обекти общинска собственост“</td><td>205644</td><td>BGN</td><td>Да</td>
</tr>
<tr>
  <td>2</td><td>15.05.2018&nbsp;г.&nbsp;</td><td>00123-2018-0013</td>
  <td>ТЕЦ "Варна" ЕАД</td><td>пряко договаряне</td><td>Доставки</td>
  <td>Доставка на масла</td><td>210000</td><td>&nbsp;</td><td>&nbsp;</td>
</tr>
</table>`;

test("parseCasesHtml maps the cases columns and skips non-data rows", () => {
  const rows = parseCasesHtml(FIXTURE);
  assert.equal(rows.length, 2, "header row is filtered out (no УНП)");

  const [a, b] = rows;
  assert.equal(a.unp, "00754-2018-0001");
  assert.equal(
    a.publishedDate,
    "2018-05-15",
    "date parsed past the trailing г.",
  );
  assert.equal(a.buyerName, "Община Борино");
  assert.equal(a.procedureType, "публично състезание");
  assert.equal(a.object, "Строителство");
  assert.equal(a.subject, "„Ремонт на обекти общинска собственост“");
  assert.equal(a.estimatedValue, "205644");
  assert.equal(a.currency, "BGN");
  assert.equal(a.isEuFunded, true);

  // Empty currency cell defaults to BGN (pre-2020 leva); blank EU column → false.
  assert.equal(b.currency, "BGN");
  assert.equal(b.isEuFunded, false);
});

test("buildTenders honours the РОП sourceUrl passthrough; ЦАИС falls back", () => {
  const ropUrl =
    "https://www.aop.bg/esearch_cases_from_to.php?mode=search&validated_on_from=15%2F05%2F2018&validated_on_to=15%2F05%2F2018";
  const rop: EopTenderRecord = {
    uniqueProcurementNumber: "00754-2018-0001",
    buyerRegistryNumber: "000024743",
    buyerName: "Община Борино",
    publicationDate: "2018-05-15",
    isLot: "Не",
    procedureType: "публично състезание",
    typeOfContract: "Строителство",
    subject: "Ремонт",
    estimatedValue: "205644",
    currency: "BGN",
    isEuFunded: "Да",
    sourceUrl: ropUrl,
  };
  // A live-ЦАИС-shaped record (no sourceUrl) for a different, 2025 procedure.
  const eop: EopTenderRecord = {
    uniqueProcurementNumber: "00044-2025-0125",
    buyerRegistryNumber: "000695089",
    buyerName: "АПИ",
    publicationDate: "2025-03-10",
    isLot: "Не",
    typeOfContract: "Строителство",
    subject: "Магистрала",
    estimatedValue: "1000000",
    currency: "EUR",
  };

  const { tenders } = buildTenders([
    { day: "2018-05-15", rec: rop },
    { day: "2025-03-10", rec: eop },
  ]);
  const byUnp = new Map(tenders.map((t) => [t.unp, t]));

  const rt = byUnp.get("00754-2018-0001");
  assert.ok(rt, "the РОП procedure normalized");
  assert.equal(rt.sourceUrl, ropUrl, "РОП tender cites its aop.bg cases page");
  assert.equal(rt.buyerEik, "000024743");
  assert.equal(rt.contractType, "works", "Строителство → works");
  assert.equal(rt.isEuFunded, true);
  // BGN estimate converts at the locked peg (1 EUR = 1.95583 BGN).
  assert.ok(
    rt.estimatedValueEur != null &&
      Math.abs(rt.estimatedValueEur - 205644 / 1.95583) < 0.01,
  );
  assert.equal(rt.ocid, undefined, "no numeric tenderId → no ocds ocid");

  const et = byUnp.get("00044-2025-0125");
  assert.ok(et);
  assert.equal(
    et.sourceUrl,
    tendersDayUrl("2025-03-10"),
    "ЦАИС tender falls back to the storage.eop.bg day bucket",
  );
});
