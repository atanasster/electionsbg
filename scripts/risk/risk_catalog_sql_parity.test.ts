// TS ↔ SQL parity for the risk-flag CATALOGUE — the drift gate SQL cannot get
// from an import.
//
// The TypeScript consumers (the two scorers, the mask decoder, the chip ledger,
// the offline derived builders) read src/lib/riskFlagCatalog.ts directly, so they
// cannot drift from it. SQL cannot import, so 033, 041 and 112 keep their own
// literals — three of the six copies the catalogue exists to collapse. This file
// parses them and fails when any one disagrees.
//
// WHY A GATE RATHER THAN A GENERATOR. These migrations are APPLIED artifacts with
// deploy semantics — 112 rides a ~90-minute contracts reload or apply_functions.ts
// plus a full rebuild_contract_risk_cache(), 041 rides db:load:tr:pg — so
// mechanically rewriting a file that is already live on Cloud SQL risks
// reformatting a served function body while buying nothing over failing the build
// on divergence. The catalogue is still the single source: a hand-edit to a SQL
// literal that disagrees with it fails here.
//
// ⚠️ HOW THIS FILE IS ALLOWED TO FAIL, AND WHY IT IS WRITTEN THE WAY IT IS.
// A drift gate that stops matching reports success for ever, including on a real
// drift — worse than no gate, because it also removes the suspicion. The first cut
// was mutation-tested against deliberately corrupted copies of the real migrations
// and **eleven realistic single-value drifts passed**:
//
//   - `toContain("0.3")` is a PREFIX match, so 0.3 → 0.35 passed. So did
//     0.5 → 0.55, 0.8 → 0.85, and 100000 → 1000000 (a 10× move on the
//     concentration floor). Every numeric check now goes through `hasNumber`,
//     which anchors both ends.
//   - 041 compared the SET of weights, so SWAPPING connection (0.35) and
//     singleBid (0.15) — the 2026-07-18 EC-Scoreboard rebalance run backwards —
//     passed all four assertions. Weights are now matched to their COMPONENT.
//   - `not.toMatch(/upheld/i)` was satisfied by a surviving parameter name, so
//     deleting the buyer's whole upheld-appeal arm passed. The arm is now proven
//     by its weight→parameter binding.
//   - 112's alias lists were checked by COUNT, so duplicating one alias while
//     omitting another (nkidMismatch silently absent from both masks) passed.
//     Every alias site is now asserted to cover each flag exactly once.
//   - 033's APPLIED `HAVING SUM(amount_eur) >= 100000` was unchecked — only the
//     payload literal that advertises it. Drift there would make the served
//     payload and the published handbook state a floor the code did not apply.
//
// Keep that property. When adding an assertion here, add its mutation to the
// "the gate discriminates" block below: an assertion nobody has watched fail is
// an assertion nobody knows works.
//
// This is DIFFERENT from scripts/procurement/risk_parity.harness.ts, which
// compares COMPUTED OUTPUT over real contracts and needs a populated database.
// Both are necessary: this file cannot catch a predicate that applies the right
// number the wrong way round, and the harness cannot run where there is no
// Postgres — nor can it see a check that is unavailable on every row.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  AWARDER_EXPOSURE_LIST,
  CONCENTRATION_MIN_AWARDER_TOTAL_EUR,
  CONTRACT_FLAGS,
  LEGALLY_SINGLE_SOURCE_CPV_PREFIX,
  RISK_MASK_BITS,
  SUPPLIER_EXPOSURE_LIST,
  type RiskComponentKey,
  contractFlag,
  contractThreshold,
} from "../../src/lib/riskFlagCatalog";

const ROOT = path.resolve(__dirname, "../..");
const sql = (file: string): string =>
  fs.readFileSync(path.join(ROOT, "scripts/db/schema/pg", file), "utf8");

/** Strip `--` line comments so a number MENTIONED in prose is not mistaken for a
 *  literal the code applies — and so a stale comment cannot satisfy a gate the
 *  code itself would fail. */
const code = (s: string): string =>
  s
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");

const CODE_112 = code(sql("112_contract_risk_cache.sql"));
const CODE_041 = code(sql("041_procurement_risk_grade.sql"));
const CODE_033 = code(sql("033_procurement_risk_indexes.sql"));

/** A numeric literal, anchored at BOTH ends.
 *
 *  `toContain("0.5")` matches inside "0.55" and "100000" matches inside
 *  "1000000" — the whole class of drift a prefix match cannot see. The lookarounds
 *  reject a longer number on either side. */
const numberRe = (n: number, flags = ""): RegExp =>
  new RegExp(`(?<![\\d.])${String(n).replace(/\./g, "\\.")}(?![\\d])`, flags);

const hasNumber = (haystack: string, n: number): boolean =>
  numberRe(n).test(haystack);

/** Text between two markers. Fails loudly rather than returning "" when either
 *  marker is gone, so a rename cannot silently empty an assertion. */
const between = (s: string, from: string, to: string): string => {
  const a = s.indexOf(from);
  expect(a, `marker not found: ${from}`).toBeGreaterThan(-1);
  const b = s.indexOf(to, a + from.length);
  expect(b, `marker not found: ${to}`).toBeGreaterThan(a);
  return s.slice(a + from.length, b);
};

/** The body of one SQL function: its CREATE header to the dollar-quote that
 *  closes it.
 *
 *  Slicing to end-of-file instead is how the first cut passed a "supplier" body
 *  that actually contained three later functions. The closing tag is READ from
 *  the opening one rather than assumed to be `$$` — 112's plpgsql functions use
 *  `$fn$`, and hard-coding `$$` made every assertion against them throw rather
 *  than fail informatively. */
const fnBody = (source: string, name: string): string => {
  const at = source.indexOf(`FUNCTION ${name}`);
  expect(at, `${name} not found`).toBeGreaterThan(-1);
  const rest = source.slice(at);
  const open = rest.match(/\$([A-Za-z_]*)\$/);
  expect(open, `${name} has no dollar-quoted body`).toBeTruthy();
  const tag = open![0];
  const bodyStart = open!.index! + tag.length;
  const close = rest.indexOf(tag, bodyStart);
  expect(close, `${name} has no closing ${tag}`).toBeGreaterThan(-1);
  return rest.slice(0, close);
};

/** 112 abbreviates the flag ids into column aliases. Declared, not derived: the
 *  abbreviations are arbitrary, and a derivation that guessed wrong would make
 *  the parse skip a flag rather than fail. */
const ALIAS_TO_ID: Record<string, RiskComponentKey> = {
  debarred: "debarred",
  mp: "mpConnected",
  pep: "pepConnected",
  conc: "awarderConcentration",
  amend: "amendment",
  annex: "annexGrowth",
  newfirm: "newFirmWinner",
  split: "splitPurchase",
  appeal: "appealUpheld",
  weak: "weakCompetition",
  direct: "directAward",
  short: "shortTenderPeriod",
  nkid: "nkidMismatch",
};

const ALL_IDS = CONTRACT_FLAGS.map((f) => f.id)
  .slice()
  .sort();

/** Assert a list of 112 aliases covers every flag EXACTLY once.
 *
 *  Comparing the whole sorted list — rather than its length — is what rejects
 *  duplicate-and-omission, where one alias appears twice and another not at all.
 *  The count is right and a check has silently vanished from the mask. */
const expectCoversEveryFlagOnce = (aliases: string[], site: string): void => {
  const ids = aliases.map((a) => {
    const id = ALIAS_TO_ID[a];
    expect(id, `${site}: unknown alias '${a}'`).toBeTruthy();
    return id;
  });
  expect(
    ids.slice().sort(),
    `${site}: must cover every flag exactly once`,
  ).toEqual(ALL_IDS);
};

describe("112 — the mask contract", () => {
  test("contract_risk_checks() decodes the catalogue's names, in bit order", () => {
    const m = CODE_112.match(
      /contract_risk_checks[\s\S]*?unnest\(ARRAY\[([\s\S]*?)\]\)/,
    );
    expect(m, "contract_risk_checks() ARRAY[...] not found").toBeTruthy();
    const names = [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect(names).toEqual([...RISK_MASK_BITS]);
  });

  test("the available_mask shift order matches the catalogue", () => {
    const shifts = [...CODE_112.matchAll(/a\.a_([a-z]+)::int\s*<<\s*(\d+)/g)];
    expectCoversEveryFlagOnce(
      shifts.map((m) => m[1]),
      "available_mask shifts",
    );
    for (const m of shifts)
      expect(contractFlag(ALIAS_TO_ID[m[1]]).bit, `a_${m[1]}`).toBe(
        Number(m[2]),
      );
  });

  test("the fired_mask shift order matches the available_mask order", () => {
    const fired = [...CODE_112.matchAll(/a\.f_([a-z]+)::int\s*<<\s*(\d+)/g)];
    expectCoversEveryFlagOnce(
      fired.map((m) => m[1]),
      "fired_mask shifts",
    );
    expect(fired.map((m) => `${m[1]}:${m[2]}`)).toEqual(
      [...CODE_112.matchAll(/a\.a_([a-z]+)::int\s*<<\s*(\d+)/g)].map(
        (m) => `${m[1]}:${m[2]}`,
      ),
    );
  });

  test("the available/fired COUNT sums cover every flag too", () => {
    // A fourth and fifth copy of the alias list, independent of the masks: the
    // counts are what the CRI divides, so a flag missing HERE changes every
    // published ratio while both masks stay correct.
    expectCoversEveryFlagOnce(
      [
        ...between(CODE_112, "SELECT f.*,", "AS available").matchAll(
          /f\.a_([a-z]+)::int/g,
        ),
      ].map((m) => m[1]),
      "available count sum",
    );
    expectCoversEveryFlagOnce(
      [
        ...between(CODE_112, "AS available,", "AS fired").matchAll(
          /f\.f_([a-z]+)::int/g,
        ),
      ].map((m) => m[1]),
      "fired count sum",
    );
  });

  test("the legacy score weights match the catalogue, per flag", () => {
    const scoreExpr = between(CODE_112, "LEAST(100,", "AS score");
    const weights = [...scoreExpr.matchAll(/f\.f_([a-z]+)::int\s*\*\s*(\d+)/g)];
    expectCoversEveryFlagOnce(
      weights.map((m) => m[1]),
      "score weights",
    );
    for (const m of weights)
      expect(contractFlag(ALIAS_TO_ID[m[1]]).legacyWeight, `f_${m[1]}`).toBe(
        Number(m[2]),
      );
  });

  test("the thresholds inside the predicates match the catalogue", () => {
    expect(
      hasNumber(CODE_112, contractThreshold("annexGrowth")),
      "annexGrowth cumulative cap (ЗОП чл.116 ал.2)",
    ).toBe(true);

    expect(
      new RegExp(`<\\s*${contractThreshold("newFirmWinner")}(?![\\d])`).test(
        CODE_112,
      ),
      "newFirmWinner month window",
    ).toBe(true);

    expect(
      new RegExp(
        `<\\s*${contractThreshold("shortTenderPeriod")}(?![\\d])`,
      ).test(CODE_112),
      "shortTenderPeriod day window",
    ).toBe(true);

    expect(CODE_112).toContain(`'${LEGALLY_SINGLE_SOURCE_CPV_PREFIX}%'`);
  });

  test("BOTH weakCompetition arms carry the structural suppression", () => {
    // The single-bid arm and the below-median arm each suppress on the same
    // 2-digit-division share. Requiring only one would let the other keep
    // flagging a structurally single-bid market — the false positive the
    // suppression exists to remove.
    const t = contractThreshold("weakCompetition");
    const arms = [
      ...CODE_112.matchAll(
        new RegExp(`single_bid_share\\s*>=\\s*${t}(?![\\d])`, "g"),
      ),
    ];
    expect(arms.length, "structural single-bid suppression arms").toBe(2);
  });
});

describe("041 — the two exposure weight sets", () => {
  /** Weight → component, parsed from the expression rather than collected as a
   *  set. A set comparison passes when two components SWAP weights, which is the
   *  EC-Scoreboard rebalance run backwards. */
  const AWARDER_PARAM_TO_KEY: Record<string, string> = {
    connection: "connection",
    single: "singleBid",
    direct: "direct",
    conc: "concentration",
    upheld: "upheldAppeal",
  };
  const SUPPLIER_VAR_TO_KEY: Record<string, string> = {
    connected_share: "connectedSelf",
    single_share: "singleBid",
    direct_share: "direct",
    conc_share: "buyerConcentration",
  };

  test("awarder_risk_grade_frac() binds each buyer weight to its own component", () => {
    const body = fnBody(CODE_041, "awarder_risk_grade_frac");
    const num = [...body.matchAll(/([\d.]+)\s*\*\s*COALESCE\(p_(\w+)/g)].map(
      (m) => [AWARDER_PARAM_TO_KEY[m[2]], Number(m[1])] as const,
    );
    const den = [
      ...body.matchAll(/([\d.]+)\s*\*\s*\(p_(\w+)\s+IS NOT NULL/g),
    ].map((m) => [AWARDER_PARAM_TO_KEY[m[2]], Number(m[1])] as const);

    expect(num.length, "numerator terms").toBe(AWARDER_EXPOSURE_LIST.length);
    expect(den.length, "availability denominator terms").toBe(
      AWARDER_EXPOSURE_LIST.length,
    );

    for (const c of AWARDER_EXPOSURE_LIST) {
      expect(num.find(([k]) => k === c.key)?.[1], `numerator: ${c.key}`).toBe(
        c.weight,
      );
      expect(den.find(([k]) => k === c.key)?.[1], `denominator: ${c.key}`).toBe(
        c.weight,
      );
    }
  });

  test("supplier_risk_grade() binds the DIFFERENT supplier weights", () => {
    const body = fnBody(CODE_041, "supplier_risk_grade");
    const num = [
      ...body.matchAll(/([\d.]+)\s*\*\s*(?:COALESCE\()?(\w+_share)/g),
    ].map((m) => [SUPPLIER_VAR_TO_KEY[m[2]], Number(m[1])] as const);

    expect(num.length, "supplier numerator terms").toBe(
      SUPPLIER_EXPOSURE_LIST.length,
    );
    for (const c of SUPPLIER_EXPOSURE_LIST)
      expect(num.find(([k]) => k === c.key)?.[1], `supplier: ${c.key}`).toBe(
        c.weight,
      );
  });

  test("the supplier arm has NO upheld-appeal component", () => {
    const body = fnBody(CODE_041, "supplier_risk_grade");
    expect(body).not.toMatch(/upheld/i);
    expect(
      SUPPLIER_EXPOSURE_LIST.some((c) => c.key === "upheldAppeal"),
      "catalogue and SQL must agree the supplier arm has no appeal component",
    ).toBe(false);
  });

  test("the two sets really are different", () => {
    // Guards the gate itself: identical lists in the catalogue would satisfy both
    // assertions above while the spec described one grade as two.
    expect(AWARDER_EXPOSURE_LIST.map((c) => c.weight).join(",")).not.toBe(
      SUPPLIER_EXPOSURE_LIST.map((c) => c.weight).join(","),
    );
  });

  test("the buyer weights live ONLY inside the frac helper", () => {
    // risk-v2 §0a extracted them so a reweight is a one-line change. A 0.35
    // outside that body means they have been re-inlined.
    const all = [...CODE_041.matchAll(numberRe(0.35, "g"))].length;
    const inFrac = [
      ...fnBody(CODE_041, "awarder_risk_grade_frac").matchAll(
        numberRe(0.35, "g"),
      ),
    ].length;
    expect(all, "0.35 appears outside awarder_risk_grade_frac()").toBe(inFrac);
  });
});

describe("033 — the concentration rule", () => {
  test("the APPLIED pair-share threshold matches the catalogue", () => {
    // The HAVING that actually filters, not the payload that advertises it.
    const t = contractThreshold("awarderConcentration");
    expect(
      new RegExp(`NULLIF\\(awtot\\.total, 0\\)\\s*>=\\s*${t}(?![\\d])`).test(
        CODE_033,
      ),
      "applied HAVING share >= threshold",
    ).toBe(true);
  });

  test("the APPLIED minimum buyer total matches the catalogue", () => {
    // Previously unchecked: only the payload literal was. A drift here makes the
    // served payload and the published handbook state a floor the code did not
    // apply.
    expect(
      new RegExp(
        `HAVING SUM\\(amount_eur\\)\\s*>=\\s*${CONCENTRATION_MIN_AWARDER_TOTAL_EUR}(?![\\d])`,
      ).test(CODE_033),
      "applied HAVING SUM(amount_eur) >= minimum",
    ).toBe(true);
  });

  test("the ADVERTISED thresholds match the applied ones", () => {
    const t = contractThreshold("awarderConcentration");
    expect(new RegExp(`'thresholdPct',\\s*${t}(?![\\d])`).test(CODE_033)).toBe(
      true,
    );
    expect(
      new RegExp(
        `'minAwarderTotalEur',\\s*${CONCENTRATION_MIN_AWARDER_TOTAL_EUR}(?![\\d])`,
      ).test(CODE_033),
    ).toBe(true);
  });
});

describe("112 — the version stamp is wired", () => {
  // Static half of contract_risk_meta.data.test.ts. That gate proves the stamp
  // BEHAVES; this one proves both rebuild overloads still call it, which is
  // cheap to check and expensive to notice missing — a rebuild that stopped
  // stamping would leave the methodology page citing a version the served masks
  // were not computed under, with nothing failing.
  test("both rebuild overloads stamp", () => {
    const zeroArg = fnBody(CODE_112, "rebuild_contract_risk_cache()");
    const oneArg = fnBody(
      CODE_112,
      "rebuild_contract_risk_cache(p_catalog_version",
    );
    expect(zeroArg, "the no-arg rebuild must clear the version").toMatch(
      /contract_risk_stamp\(\s*NULL/,
    );
    expect(oneArg, "the stamped rebuild must record its argument").toMatch(
      /contract_risk_stamp\(\s*p_catalog_version/,
    );
  });

  test("contract_risk_stamp normalises a blank version to NULL", () => {
    // '' would render as a version-shaped nothing on the page rather than taking
    // the "not stamped" branch.
    expect(fnBody(CODE_112, "contract_risk_stamp")).toMatch(
      /nullif\(btrim\(p_version\), ''\)/,
    );
  });

  test("the stamp is the ONLY writer of contract_risk_meta", () => {
    // Two writers is how the "absence is honest, a stale stamp is a false claim"
    // rule gets half-applied.
    const writes = [
      ...CODE_112.matchAll(/(INSERT INTO|UPDATE)\s+contract_risk_meta/g),
    ];
    expect(writes.length, "writers of contract_risk_meta in 112").toBe(1);
  });
});

describe("the gate discriminates", () => {
  // Each case mutates the value an assertion above reads and proves the check
  // FAILS. Without these, an assertion whose regex stopped matching would report
  // success for ever — the specific way a drift gate rots.

  test("anchored numbers reject a longer literal", () => {
    expect(hasNumber("x >= 0.55", 0.5)).toBe(false);
    expect(hasNumber("x >= 0.5", 0.5)).toBe(true);
    expect(hasNumber(">= 1000000", 100000)).toBe(false);
    expect(hasNumber(">= 100000", 100000)).toBe(true);
    expect(hasNumber("10.5", 0.5)).toBe(false);
  });

  test("alias coverage rejects duplicate-and-omission", () => {
    const mutated = Object.keys(ALIAS_TO_ID).filter((a) => a !== "nkid");
    mutated.push("debarred"); // right count, one flag silently gone
    expect(() => expectCoversEveryFlagOnce(mutated, "mutation")).toThrow();
  });

  test("weight→component binding rejects a swap", () => {
    const swapped =
      "( 0.15 * COALESCE(p_connection, 0) + 0.35 * COALESCE(p_single, 0) )";
    const parsed = [
      ...swapped.matchAll(/([\d.]+)\s*\*\s*COALESCE\(p_(\w+)/g),
    ].map((m) => [m[2], Number(m[1])] as const);
    expect(parsed.find(([k]) => k === "connection")?.[1]).not.toBe(0.35);
  });

  test("comment stripping removes prose but keeps code", () => {
    expect(code("SELECT 1; -- 0.99 is not a threshold")).not.toContain("0.99");
    expect(code("SELECT 1; -- comment")).toContain("SELECT 1;");
  });

  test("all three migrations were actually read", () => {
    for (const [name, s] of [
      ["112", CODE_112],
      ["041", CODE_041],
      ["033", CODE_033],
    ] as const)
      expect(s.length, `${name} looks empty`).toBeGreaterThan(2000);
  });
});
