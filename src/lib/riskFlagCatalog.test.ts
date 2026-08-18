// Gates over the flag catalogue itself — the invariants that make it safe to be
// the single source, and safe to publish.
//
// The SQL side is held to the same values by
// scripts/risk/risk_catalog_sql_parity.test.ts; this file covers the properties
// that live entirely in TypeScript.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  AWARDER_EXPOSURE_COMPONENTS,
  CATALOG_VERSION,
  CONTRACT_DISPLAY_ORDER,
  CONTRACT_FLAGS,
  CONTRACT_FLAG_LIST,
  NEUTRAL_DISCLOSURES,
  RISK_MASK_BITS,
  SUPPLIER_EXPOSURE_COMPONENTS,
  SUPPLIER_EXPOSURE_LIST,
  AWARDER_EXPOSURE_LIST,
  TENDER_FLAG_LIST,
  contractFlag,
  contractThreshold,
  tenderThreshold,
} from "@/lib/riskFlagCatalog";

const ROOT = path.resolve(__dirname, "../..");

/** The committed bit order. APPEND-ONLY: a new check goes at the END of this
 *  list and nowhere else.
 *
 *  Asserted against a literal rather than diffed against the previous commit,
 *  because a test that needs git history fails in the environments that have
 *  none. The cost of a renumber is not a wrong label — it is that every
 *  available_mask / fired_mask already stored in contract_risk_cache silently
 *  re-maps to different checks, on 400k+ rows, with no error anywhere. */
const COMMITTED_BIT_ORDER = [
  "debarred",
  "mpConnected",
  "pepConnected",
  "awarderConcentration",
  "amendment",
  "annexGrowth",
  "newFirmWinner",
  "splitPurchase",
  "appealUpheld",
  "weakCompetition",
  "directAward",
  "shortTenderPeriod",
  "nkidMismatch",
] as const;

const locale = (lang: "bg" | "en"): Record<string, string> =>
  JSON.parse(
    fs.readFileSync(
      path.join(ROOT, "src/locales", lang, "translation.json"),
      "utf8",
    ),
  ) as Record<string, string>;

describe("bit order is append-only", () => {
  test("matches the committed order exactly", () => {
    expect(RISK_MASK_BITS).toEqual([...COMMITTED_BIT_ORDER]);
  });

  test("a new flag may only be appended", () => {
    // Prefix equality is the actual rule: growth at the end is fine, any change
    // to an existing position is not.
    expect(RISK_MASK_BITS.slice(0, COMMITTED_BIT_ORDER.length)).toEqual([
      ...COMMITTED_BIT_ORDER,
    ]);
  });

  test("bits are dense, unique and zero-based", () => {
    const bits = CONTRACT_FLAGS.map((f) => f.bit).sort((a, b) => a - b);
    expect(bits).toEqual(CONTRACT_FLAGS.map((_, i) => i));
  });

  test("bit count stays inside a 32-bit int mask", () => {
    // available_mask / fired_mask are `int` in 112. At 31 flags the shift
    // overflows and the failure is silent corruption of every historic mask.
    expect(CONTRACT_FLAGS.length).toBeLessThanOrEqual(31);
  });
});

describe("every flag is fully declared", () => {
  test("ids are unique", () => {
    const ids = CONTRACT_FLAGS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("display order is a permutation of the flag set", () => {
    // Not the same list as bit order, deliberately — but it must cover every
    // flag exactly once, or the ledger silently drops a check whose entire job
    // is to say what was and was not evaluated.
    expect([...CONTRACT_DISPLAY_ORDER].sort()).toEqual(
      CONTRACT_FLAGS.map((f) => f.id).sort(),
    );
  });

  test("every threshold carries its provenance", () => {
    // A bare number in a published spec is unfalsifiable. This is the gate that
    // kills the "14 days is the EU legal minimum, not our risk threshold" class
    // of drift (risk-v2 §6a).
    const bare: string[] = [];
    for (const f of [...CONTRACT_FLAG_LIST, ...TENDER_FLAG_LIST])
      if (f.threshold && !f.threshold.basis?.trim()) bare.push(f.id);
    expect(bare, "thresholds with no stated basis").toEqual([]);
  });

  test("every flag states when it is unavailable", () => {
    // The CRI's denominator is the availability rule. A flag that does not state
    // one cannot be published honestly, because a reader cannot tell "passed"
    // from "not checked".
    const missing = [...CONTRACT_FLAG_LIST, ...TENDER_FLAG_LIST]
      .filter((f) => !f.availability?.trim())
      .map((f) => f.id);
    expect(missing).toEqual([]);
  });

  test("legacy weights are positive integers", () => {
    for (const f of CONTRACT_FLAGS) {
      expect(Number.isInteger(f.legacyWeight), f.id).toBe(true);
      expect(f.legacyWeight, f.id).toBeGreaterThan(0);
    }
  });
});

describe("i18n keys resolve in BOTH corpora", () => {
  // A missing key does not throw — i18next returns the key itself, so the chip
  // renders "risk_flag_nkid_long" to a reader. And the keys are irregular
  // (newFirmWinner → risk_flag_new_firm_long), so they cannot be derived and
  // must be checked.
  const bg = locale("bg");
  const en = locale("en");

  test.each(CONTRACT_FLAGS.map((f) => [f.id, f] as const))("%s", (_id, f) => {
    for (const [lang, corpus] of [
      ["bg", bg],
      ["en", en],
    ] as const)
      for (const key of [f.labelKey, f.whyKey, f.naReasonKey])
        expect(corpus[key], `${lang}: ${key}`).toBeTruthy();
  });
});

describe("the two exposure weight sets stay distinct", () => {
  // They look like one rule and are two (041). The failure this guards is a
  // future "consolidation" that gives the supplier grade the buyer's weights —
  // which would publish the EC-Scoreboard rebalance as applying to a grade that
  // never received it, on the surface a COMPANY reads about itself.
  test("the buyer arm has five components including the appeal arm", () => {
    expect(AWARDER_EXPOSURE_COMPONENTS.map((c) => c.key)).toEqual([
      "connection",
      "singleBid",
      "direct",
      "concentration",
      "upheldAppeal",
    ]);
  });

  test("the supplier arm has four and NO appeal arm", () => {
    const keys = SUPPLIER_EXPOSURE_COMPONENTS.map((c) => c.key);
    expect(keys).toEqual([
      "connectedSelf",
      "singleBid",
      "direct",
      "buyerConcentration",
    ]);
    expect(keys).not.toContain("upheldAppeal");
  });

  test("the supplier arm keeps its PRE-rebalance direct/singleBid weights", () => {
    // risk-v2 §8 moved the buyer arm only. If this ever changes it must be a
    // decision with the handbook updated, not a tidy-up.
    const by = Object.fromEntries(
      SUPPLIER_EXPOSURE_COMPONENTS.map((c) => [c.key, c.weight]),
    );
    expect(by.direct).toBe(0.2);
    expect(by.singleBid).toBe(0.25);

    const buyer = Object.fromEntries(
      AWARDER_EXPOSURE_COMPONENTS.map((c) => [c.key, c.weight]),
    );
    expect(buyer.direct).toBe(0.3);
    expect(buyer.singleBid).toBe(0.15);
  });

  test("only the supplier's own political link is unconditionally available", () => {
    expect(
      SUPPLIER_EXPOSURE_LIST.filter((c) => c.alwaysAvailable).map((c) => c.key),
    ).toEqual(["connectedSelf"]);
    expect(AWARDER_EXPOSURE_LIST.filter((c) => c.alwaysAvailable)).toEqual([]);
  });

  test("the buyer weights still total 1.30 — the score scale risk-v2 §8 preserved", () => {
    const total = AWARDER_EXPOSURE_COMPONENTS.reduce((s, c) => s + c.weight, 0);
    expect(total).toBeCloseTo(1.3, 10);
  });
});

describe("accessors fail loudly rather than defaulting", () => {
  test("an unknown flag throws", () => {
    // @ts-expect-error — deliberately outside the union
    expect(() => contractFlag("notAFlag")).toThrow(/unknown contract flag/);
  });

  test("a flag with no numeric threshold throws rather than returning 0", () => {
    // A silent 0 here would be a scorer running on a number nobody declared —
    // and 0 is the value most likely to make a check fire on everything.
    expect(() => contractThreshold("debarred")).toThrow(/no numeric threshold/);
  });

  test("declared thresholds come back", () => {
    expect(contractThreshold("annexGrowth")).toBe(0.5);
    expect(contractThreshold("newFirmWinner")).toBe(12);
    expect(contractThreshold("shortTenderPeriod")).toBe(14);
    expect(contractThreshold("weakCompetition")).toBe(0.8);
    expect(contractThreshold("awarderConcentration")).toBe(0.3);
    expect(tenderThreshold("rushedDeadline")).toBe(12);
    expect(tenderThreshold("shortDecisionPeriod")).toBe(4);
    expect(tenderThreshold("awardOverEstimate")).toBe(1.1);
  });

  test("the two rushed-window thresholds are NOT the same number", () => {
    // The contract check sits on the EU legal minimum (14d); the tender check is
    // tier-conditional at 12d because on low-value tiers a short window is
    // statutory. Collapsing them would either flag the statute or miss the
    // signal, and both read as "one threshold, simplified".
    expect(contractThreshold("shortTenderPeriod")).not.toBe(
      tenderThreshold("rushedDeadline"),
    );
  });
});

describe("the neutral disclosure stays unscored", () => {
  test("ngoForeignFunded is declared and marked unscored", () => {
    const ngo = NEUTRAL_DISCLOSURES.find((d) => d.id === "ngoForeignFunded");
    expect(ngo?.scored).toBe(false);
  });

  test("it is not a flag", () => {
    // If it ever became one, the CRI denominator would change on every contract
    // and a lawful disclosure would start reading as a red flag.
    expect(CONTRACT_FLAGS.map((f) => f.id)).not.toContain("ngoForeignFunded");
  });
});

describe("version", () => {
  test("is semver", () => {
    expect(CATALOG_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
