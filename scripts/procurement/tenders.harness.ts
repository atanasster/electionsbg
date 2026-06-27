// Lot-aggregation invariants for the tender normalizer (buildTenders).
// Run: npx tsx scripts/procurement/tenders.harness.ts
//
// These lock the rules that keep the QUARANTINE honest — the headline a
// procedure shows must be a single consistent forecast, never a double count:
//   1. Lot-only procedure (no parent row): estimatedValueEur === Σ lots.
//   2. Parent WITH its own estimate: that estimate stands; lots are NOT summed
//      on top of it (no double count of the same money).
//   3. A lot row with the currency token missing inherits the parent's currency
//      so its value still converts at the peg instead of being dropped.
//   4. Lot rows with no id (tenderId / lotIdentifier) dedupe by CONTENT, so a
//      re-published identical lot doesn't inflate the lot list.

import { buildTenders, type DatedTenderRecord } from "./normalize_eop_tender";
import { BGN_PER_EUR } from "@/lib/currency";
import type { EopTenderRecord } from "./eop_tender_types";

const EIK = "000695089"; // a valid 9-digit authority EIK
const DAY = "2025-09-23";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}`);
  }
};
const approx = (a: number | undefined, b: number): boolean =>
  a != null && Math.abs(a - b) < 0.5;

const rec = (r: Partial<EopTenderRecord>): EopTenderRecord => ({
  publicationDate: `${DAY}T05:00:00`,
  buyerRegistryNumber: EIK,
  buyerName: "Тест Възложител",
  currency: "EUR",
  ...r,
});
const dated = (recs: EopTenderRecord[]): DatedTenderRecord[] =>
  recs.map((r) => ({ day: DAY, rec: r }));

// 1) Lot-only procedure → estimate is the SUM of the lots ------------------
{
  const { tenders, stats } = buildTenders(
    dated([
      rec({
        uniqueProcurementNumber: "T-LOTONLY",
        tenderId: 1001,
        isLot: "Да",
        lotIdentifier: "1",
        estimatedValue: "100000",
      }),
      rec({
        uniqueProcurementNumber: "T-LOTONLY",
        tenderId: 1002,
        isLot: "Да",
        lotIdentifier: "2",
        estimatedValue: "200000",
      }),
      rec({
        uniqueProcurementNumber: "T-LOTONLY",
        tenderId: 1003,
        isLot: "Да",
        lotIdentifier: "3",
        estimatedValue: "300000",
      }),
    ]),
  );
  const t = tenders.find((x) => x.unp === "T-LOTONLY");
  const lotSum = (t?.lots ?? []).reduce(
    (s, l) => s + (l.estimatedValueEur ?? 0),
    0,
  );
  check("lot-only: one tender emitted with 3 lots", t?.lots.length === 3);
  check(
    "lot-only: counted as proceduresFromLot",
    stats.proceduresFromLot === 1,
    `got ${stats.proceduresFromLot}`,
  );
  check(
    "lot-only: estimatedValueEur === Σ lots (600,000)",
    approx(t?.estimatedValueEur, 600000) && approx(lotSum, 600000),
    `headline=${t?.estimatedValueEur} Σlots=${lotSum}`,
  );
}

// 2) Parent with its OWN estimate → lots are NOT summed on top -------------
{
  const { tenders, stats } = buildTenders(
    dated([
      rec({
        uniqueProcurementNumber: "T-PARENT",
        tenderId: 2000,
        isLot: "Не",
        estimatedValue: "1000000",
      }),
      rec({
        uniqueProcurementNumber: "T-PARENT",
        tenderId: 2001,
        isLot: "Да",
        lotIdentifier: "1",
        estimatedValue: "100000",
      }),
      rec({
        uniqueProcurementNumber: "T-PARENT",
        tenderId: 2002,
        isLot: "Да",
        lotIdentifier: "2",
        estimatedValue: "200000",
      }),
    ]),
  );
  const t = tenders.find((x) => x.unp === "T-PARENT");
  check(
    "parent estimate: headline is the parent's 1,000,000 (not the 300,000 lot sum)",
    approx(t?.estimatedValueEur, 1000000),
    `got ${t?.estimatedValueEur}`,
  );
  check(
    "parent estimate: NOT counted as proceduresFromLot",
    stats.proceduresFromLot === 0,
    `got ${stats.proceduresFromLot}`,
  );
}

// 3) Lot with missing currency inherits the parent's (BGN) -----------------
{
  const { tenders } = buildTenders(
    dated([
      rec({
        uniqueProcurementNumber: "T-CUR",
        tenderId: 3000,
        isLot: "Не",
        currency: "BGN",
        estimatedValue: "1955830", // = 1,000,000 € at the peg
      }),
      rec({
        uniqueProcurementNumber: "T-CUR",
        tenderId: 3001,
        isLot: "Да",
        lotIdentifier: "1",
        currency: "", // missing → inherit BGN
        estimatedValue: "1955830",
      }),
    ]),
  );
  const t = tenders.find((x) => x.unp === "T-CUR");
  const lot = t?.lots[0];
  check(
    "currency inheritance: empty-currency lot converts at the BGN peg",
    approx(lot?.estimatedValueEur, 1955830 / BGN_PER_EUR),
    `lot.eur=${lot?.estimatedValueEur} expected=${1955830 / BGN_PER_EUR}`,
  );
}

// 4) Id-less lots dedupe by content (name + value) -------------------------
{
  const { tenders } = buildTenders(
    dated([
      rec({
        uniqueProcurementNumber: "T-DEDUP",
        tenderId: 4000,
        isLot: "Не",
        estimatedValue: "500000",
      }),
      rec({
        uniqueProcurementNumber: "T-DEDUP",
        isLot: "Да",
        lotIdentifier: null,
        lotTenderName: "Доставка на материали",
        estimatedValue: "120000",
      }),
      rec({
        // identical content, republished → same content key, must collapse
        uniqueProcurementNumber: "T-DEDUP",
        isLot: "Да",
        lotIdentifier: null,
        lotTenderName: "Доставка на материали",
        estimatedValue: "120000",
      }),
    ]),
  );
  const t = tenders.find((x) => x.unp === "T-DEDUP");
  check(
    "content dedup: two identical id-less lot rows collapse to 1",
    t?.lots.length === 1,
    `got ${t?.lots.length}`,
  );
}

// 5) parseBgNumber edge cases (через buildTenders → estimatedValueNative) -----
// The feed numbers arrive Bulgarian-formatted; a parse miss would silently drop
// the headline. Asserted on observable output rather than the private helper.
{
  const cases: { unp: string; raw: string; expect: number }[] = [
    { unp: "T-N1", raw: "1 234 567,89", expect: 1234567.89 },
    { unp: "T-N2", raw: "960000000,00", expect: 960000000 },
    { unp: "T-N3", raw: "1.234.567", expect: 1234567 }, // dot-grouped, no decimal
  ];
  const { tenders } = buildTenders(
    dated(
      cases.map((c) =>
        rec({
          uniqueProcurementNumber: c.unp,
          tenderId: 5000,
          isLot: "Не",
          estimatedValue: c.raw,
        }),
      ),
    ),
  );
  for (const c of cases) {
    const t = tenders.find((x) => x.unp === c.unp);
    check(
      `parseBgNumber: "${c.raw}" → ${c.expect}`,
      approx(t?.estimatedValueNative, c.expect),
      `got ${t?.estimatedValueNative}`,
    );
  }
}

// 6) isCancelled: "Да" → true, "Не" / "" → false (never undefined) -----------
{
  const { tenders } = buildTenders(
    dated([
      rec({ uniqueProcurementNumber: "T-C1", isLot: "Не", isCancelled: "Да" }),
      rec({ uniqueProcurementNumber: "T-C2", isLot: "Не", isCancelled: "Не" }),
      rec({ uniqueProcurementNumber: "T-C3", isLot: "Не", isCancelled: "" }),
    ]),
  );
  const at = (u: string) => tenders.find((x) => x.unp === u);
  check("isCancelled: 'Да' → true", at("T-C1")?.isCancelled === true);
  check("isCancelled: 'Не' → false", at("T-C2")?.isCancelled === false);
  check(
    "isCancelled: '' → false (a real boolean, not undefined)",
    at("T-C3")?.isCancelled === false,
  );
}

// 7) Duplicate УНП across notices: latest publicationDate wins ----------------
{
  const { tenders } = buildTenders(
    dated([
      rec({
        uniqueProcurementNumber: "T-DUP",
        tenderId: 7000,
        isLot: "Не",
        publicationDate: "2025-03-01T05:00:00",
        subject: "Първоначално обявление",
      }),
      rec({
        uniqueProcurementNumber: "T-DUP",
        tenderId: 7000,
        isLot: "Не",
        publicationDate: "2025-08-15T05:00:00",
        subject: "Изменено обявление",
      }),
    ]),
  );
  const matching = tenders.filter((x) => x.unp === "T-DUP");
  const t = matching[0];
  check("duplicate УНП: collapses to one tender", matching.length === 1);
  check(
    "duplicate УНП: latest notice wins (subject + date)",
    t?.subject === "Изменено обявление" && t?.publicationDate === "2025-08-15",
    `subject=${t?.subject} date=${t?.publicationDate}`,
  );
}

console.log(
  `\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — tender normalizer invariants`,
);
process.exit(failures === 0 ? 0 : 1);
