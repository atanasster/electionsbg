// Behavioural regression harness for the ex-ante per-PROCEDURE risk scorer
// (src/data/procurement/computeTenderRisk.ts). Locks the calibrated logic from
// docs/plans/procurement-risk-v2.md §6b-results — above all the TIER-CONDITIONAL
// rushed-deadline rule, which is the whole point of the base-rate calibration:
// a short submission window is a red flag on a competitive procedure but the
// statutory norm on a low-value / non-open one, so it must NOT fire there.
//
// Pure logic, no DB. Run: npx tsx scripts/procurement/tender_risk.harness.ts
import { computeTenderRisk } from "@/data/procurement/computeTenderRisk";
import type { Tender } from "@/lib/tenderTypes";
import type { TenderAward } from "@/data/procurement/useTender";

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "✓" : "✗"} ${name}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures += 1;
};

// A minimal tender. Overrides layer the scenario on top.
const base = (over: Partial<Tender>): Tender =>
  ({
    unp: "00000-2024-0001",
    publicationDate: "2024-01-01",
    buyerEik: "BUY",
    buyerName: "Buyer",
    subject: "Subject",
    isCancelled: false,
    lots: [],
    ...over,
  }) as unknown as Tender;

const award = (dateSigned: string | null): TenderAward => ({
  key: "k",
  contractorEik: "CT",
  contractorName: "Contractor",
  amountEur: 1000,
  dateSigned,
  tag: "contract",
  title: "t",
});

const comp = (t: Tender, awards: TenderAward[] = []) => {
  const r = computeTenderRisk(t, awards);
  const by = (k: string) => r.components.find((c) => c.key === k);
  return { r, by };
};

console.log(
  "tender risk scorer — non-open + tier-conditional window + decision",
);

// 1. Non-open procedure fires the hero flag.
{
  const { by } = comp(base({ procedureType: "Пряко договаряне" }));
  check(
    "non-open procedure → nonOpenProcedure fires",
    by("nonOpenProcedure")?.fired === true,
  );
}

// 2. Open procedure is NOT non-open.
{
  const { by } = comp(base({ procedureType: "Открита процедура" }));
  check(
    "open procedure → nonOpenProcedure available but not fired",
    by("nonOpenProcedure")?.available === true &&
      by("nonOpenProcedure")?.fired === false,
  );
}

// 3. Competitive tier + short window (5 days) → rushedDeadline fires.
{
  const { by } = comp(
    base({
      procedureType: "Открита процедура",
      submissionDeadline: "2024-01-06",
    }),
  );
  check(
    "competitive + 5d window → rushedDeadline fires",
    by("rushedDeadline")?.fired === true,
  );
}

// 4. ⭐ Non-competitive tier + 1-day window → rushedDeadline UNAVAILABLE (the
//    calibration guard: a short window is the norm on direct negotiation).
{
  const { by } = comp(
    base({
      procedureType: "Пряко договаряне",
      submissionDeadline: "2024-01-02",
    }),
  );
  check(
    "non-competitive + 1d window → rushedDeadline is UNAVAILABLE (not fired)",
    by("rushedDeadline")?.available === false &&
      by("rushedDeadline")?.fired === false,
  );
}

// 5. Competitive tier + normal window (30 days), no awards → nothing fires.
{
  const { r } = comp(
    base({
      procedureType: "Открита процедура",
      submissionDeadline: "2024-01-31",
    }),
  );
  check("competitive + 30d window, no awards → 0 fired", r.firedCount === 0);
}

// 6. Decision period: awarded 3 days after the deadline → shortDecisionPeriod fires.
{
  const { by } = comp(
    base({
      procedureType: "Открита процедура",
      submissionDeadline: "2024-01-20",
    }),
    [award("2024-01-23")],
  );
  check(
    "award 3d after deadline → shortDecisionPeriod fires",
    by("shortDecisionPeriod")?.fired === true,
  );
}

// 7. Decision period unavailable when the procedure is not yet awarded.
{
  const { by } = comp(
    base({
      procedureType: "Открита процедура",
      submissionDeadline: "2024-01-20",
    }),
  );
  check(
    "no awards → shortDecisionPeriod UNAVAILABLE",
    by("shortDecisionPeriod")?.available === false,
  );
}

// 8. cri = round(100 * fired / available), excluding unavailable checks.
{
  const { r } = comp(
    base({
      procedureType: "Пряко договаряне",
      submissionDeadline: "2024-01-02",
    }),
  );
  // available: nonOpen (fires) + shortDecision(unavailable, no award) + rushed(unavailable).
  // → 1 fired of 1 available → cri 100.
  check(
    "cri = round(100 * fired/available), unavailable excluded",
    r.availableCount === 1 && r.firedCount === 1 && r.cri === 100,
    `fired=${r.firedCount}/${r.availableCount} cri=${r.cri}`,
  );
}

console.log(
  `\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — tender risk scorer`,
);
process.exit(failures === 0 ? 0 : 1);
